// The optional Living Writing server: accounts, sessions, and one private vault per user, kept in SQLite.
// The browser app talks to it only when built with VITE_BACKEND=1; otherwise none of this is used.

import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { COLLECTIONS } from '../src/core/types.ts';

export interface ServerOptions {
  /** SQLite file, or ":memory:". */
  dbPath: string;
  allowSignup: boolean;
  /** Mark the session cookie Secure: set when the server sits behind HTTPS. */
  secureCookie: boolean;
  /** Built frontend to serve next to the API. */
  staticDir?: string;
  /**
   * The models behind the story agent (an OpenAI-style chat completions service); the writer picks one of `models`, and
   * the first is the default. Without it the agent is off.
   */
  agent?: { apiKey: string; baseUrl: string; models: string[] };
}

const AGENT_CALLS_PER_WINDOW = 120;
const AGENT_WINDOW_MS = 10 * 60 * 1000;
const AGENT_MAX_REQUEST_CHARS = 400_000;

const SESSION_COOKIE = 'lw_session';
const SESSION_MS = 30 * 24 * 3600 * 1000;
const MAX_FAILED_LOGINS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${(await scryptAsync(password, salt, 64)).toString('hex')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  return timingSafeEqual(await scryptAsync(password, Buffer.from(salt, 'hex'), expected.length), expected);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

interface Credentials {
  email: string;
  password: string;
}

/** Email and password arrive from the network; this is where they are checked, so the routes can trust them. */
function credentials(body: unknown): Credentials | null {
  const { email, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== 'string' || typeof password !== 'string') return null;
  const e = email.trim().toLowerCase();
  if (e.length > 254 || !/^[^@\s]+@[^@\s]+$/.test(e) || password.length < 8 || password.length > 256) return null;
  return { email: e, password };
}

interface VaultSave {
  baseRevision: number;
  schemaVersion: number;
  /** Throw away the user's stored rows first: used when the stored format is older than the client's. */
  replace: boolean;
  put: Record<string, { id: string }[]>;
  del: Record<string, string[]>;
}

/** A save arrives from the network; this is where its shape is checked, so the writing code can trust it. */
function vaultSave(body: unknown): VaultSave | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const { baseRevision, schemaVersion, replace, put, del } = b;
  if (!Number.isInteger(baseRevision) || !Number.isInteger(schemaVersion) || typeof replace !== 'boolean') return null;
  if (typeof put !== 'object' || put === null || typeof del !== 'object' || del === null) return null;
  const known = new Set<string>(COLLECTIONS);
  for (const [c, rows] of Object.entries(put)) {
    if (!known.has(c) || !Array.isArray(rows) || rows.some((r) => typeof r?.id !== 'string')) return null;
  }
  for (const [c, ids] of Object.entries(del)) {
    if (!known.has(c) || !Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) return null;
  }
  return b as unknown as VaultSave;
}

export async function buildApp(opts: ServerOptions) {
  const db = new DatabaseSync(opts.dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS vaults (user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, schema_version INTEGER NOT NULL, saved_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rows (user_id TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (user_id, collection, id)) WITHOUT ROWID;
  `);
  const q = {
    userByEmail: db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?'),
    insertUser: db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    sessionUser: db.prepare('SELECT users.id AS id, users.email AS email FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    vault: db.prepare('SELECT revision, schema_version FROM vaults WHERE user_id = ?'),
    upsertVault: db.prepare('INSERT INTO vaults (user_id, revision, schema_version, saved_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET revision = excluded.revision, schema_version = excluded.schema_version, saved_at = excluded.saved_at'),
    deleteVault: db.prepare('DELETE FROM vaults WHERE user_id = ?'),
    userRows: db.prepare('SELECT collection, json FROM rows WHERE user_id = ?'),
    putRow: db.prepare('INSERT OR REPLACE INTO rows (user_id, collection, id, json) VALUES (?, ?, ?, ?)'),
    deleteRow: db.prepare('DELETE FROM rows WHERE user_id = ? AND collection = ? AND id = ?'),
    deleteUserRows: db.prepare('DELETE FROM rows WHERE user_id = ?'),
  };
  const transaction = <T>(fn: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };

  const app = Fastify({ bodyLimit: 64 * 1024 * 1024 });
  await app.register(cookie);

  const failedLogins = new Map<string, { count: number; since: number }>();

  async function startSession(reply: FastifyReply, userId: string): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    q.insertSession.run(sha256(token), userId, Date.now() + SESSION_MS);
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: opts.secureCookie, path: '/', maxAge: SESSION_MS / 1000 });
  }

  function sessionUser(req: FastifyRequest): { id: string; email: string } | null {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return null;
    return (q.sessionUser.get(sha256(token), Date.now()) as { id: string; email: string } | undefined) ?? null;
  }

  app.post('/api/signup', async (req, reply) => {
    if (!opts.allowSignup) return reply.code(403).send({ error: 'Sign-up is closed on this server.' });
    const c = credentials(req.body);
    if (!c) return reply.code(400).send({ error: 'Enter an email address and a password of at least 8 characters.' });
    if (q.userByEmail.get(c.email)) return reply.code(409).send({ error: 'That email is already registered.' });
    const id = randomUUID();
    q.insertUser.run(id, c.email, await hashPassword(c.password), Date.now());
    await startSession(reply, id);
    return { email: c.email };
  });

  app.post('/api/login', async (req, reply) => {
    const attempt = failedLogins.get(req.ip);
    if (attempt && Date.now() - attempt.since < LOGIN_WINDOW_MS && attempt.count >= MAX_FAILED_LOGINS) {
      return reply.code(429).send({ error: 'Too many failed attempts. Try again in a few minutes.' });
    }
    const c = credentials(req.body);
    const user = c && (q.userByEmail.get(c.email) as { id: string; email: string; password_hash: string } | undefined);
    if (!c || !user || !(await passwordMatches(c.password, user.password_hash))) {
      const fresh = attempt && Date.now() - attempt.since < LOGIN_WINDOW_MS;
      failedLogins.set(req.ip, { count: fresh ? attempt.count + 1 : 1, since: fresh ? attempt.since : Date.now() });
      return reply.code(401).send({ error: 'Wrong email or password.' });
    }
    failedLogins.delete(req.ip);
    await startSession(reply, user.id);
    return { email: user.email };
  });

  app.post('/api/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) q.deleteSession.run(sha256(token));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return {};
  });

  app.get('/api/me', async (req, reply) => {
    const user = sessionUser(req);
    return user ? { email: user.email } : reply.code(401).send({ error: 'Not signed in.' });
  });

  app.get('/api/vault', async (req, reply) => {
    const user = sessionUser(req);
    if (!user) return reply.code(401).send({ error: 'Not signed in.' });
    const meta = q.vault.get(user.id) as { revision: number; schema_version: number } | undefined;
    if (!meta) return { revision: 0, schemaVersion: 0, rows: {} };
    const rows: Record<string, unknown[]> = {};
    for (const r of q.userRows.all(user.id) as { collection: string; json: string }[]) (rows[r.collection] ??= []).push(JSON.parse(r.json));
    return { revision: meta.revision, schemaVersion: meta.schema_version, rows };
  });

  app.put('/api/vault', async (req, reply) => {
    const user = sessionUser(req);
    if (!user) return reply.code(401).send({ error: 'Not signed in.' });
    const save = vaultSave(req.body);
    if (!save) return reply.code(400).send({ error: 'Malformed save.' });
    return transaction(() => {
      const current = ((q.vault.get(user.id) as { revision: number } | undefined)?.revision) ?? 0;
      if (save.baseRevision !== current) return reply.code(409).send({ error: 'This vault was changed on another device or tab. Reload to continue.', revision: current });
      if (save.replace) q.deleteUserRows.run(user.id);
      for (const [c, ids] of Object.entries(save.del)) for (const id of ids) q.deleteRow.run(user.id, c, id);
      for (const [c, rows] of Object.entries(save.put)) for (const row of rows) q.putRow.run(user.id, c, row.id, JSON.stringify(row));
      q.upsertVault.run(user.id, current + 1, save.schemaVersion, Date.now());
      return { revision: current + 1 };
    });
  });

  app.delete('/api/vault', async (req, reply) => {
    const user = sessionUser(req);
    if (!user) return reply.code(401).send({ error: 'Not signed in.' });
    transaction(() => {
      q.deleteUserRows.run(user.id);
      q.deleteVault.run(user.id);
    });
    return {};
  });

  // The story agent: the browser builds the prompt and applies the answer; the server only holds the key and relays one
  // chat call. It never touches the vault, so it cannot collide with the browser's own saves.
  const agentCalls = new Map<string, { count: number; since: number }>();

  app.get('/api/agent', async (req, reply) => {
    if (!sessionUser(req)) return reply.code(401).send({ error: 'Not signed in.' });
    return { enabled: !!opts.agent, models: opts.agent?.models ?? [] };
  });

  app.post('/api/agent/chat', async (req, reply) => {
    const user = sessionUser(req);
    if (!user) return reply.code(401).send({ error: 'Not signed in.' });
    if (!opts.agent) return reply.code(503).send({ error: 'The story agent is off: the server has no MODEL_API_KEY.' });
    const { messages, tools, model = opts.agent.models[0] } = (req.body ?? {}) as { messages?: unknown; tools?: unknown; model?: unknown };
    if (!Array.isArray(messages) || messages.length === 0 || (tools !== undefined && !Array.isArray(tools))) return reply.code(400).send({ error: 'Malformed agent request.' });
    if (typeof model !== 'string' || !opts.agent.models.includes(model)) return reply.code(400).send({ error: 'That model is not offered on this server.' });
    if (JSON.stringify(req.body).length > AGENT_MAX_REQUEST_CHARS) return reply.code(413).send({ error: 'That is too much text for one agent call.' });

    const now = Date.now();
    const seen = agentCalls.get(user.id);
    const used = seen && now - seen.since < AGENT_WINDOW_MS ? seen : { count: 0, since: now };
    if (used.count >= AGENT_CALLS_PER_WINDOW) return reply.code(429).send({ error: 'Too many agent calls. Try again in a few minutes.' });
    agentCalls.set(user.id, { count: used.count + 1, since: used.since });

    const { apiKey, baseUrl } = opts.agent;
    let upstream: Response;
    try {
      upstream = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, ...(tools ? { tools } : {}) }),
      });
    } catch {
      return reply.code(502).send({ error: 'The model service could not be reached.' });
    }
    if (!upstream.ok) return reply.code(502).send({ error: `The model service answered ${upstream.status}: ${(await upstream.text()).slice(0, 300)}` });
    const message = ((await upstream.json()) as { choices?: { message?: unknown }[] }).choices?.[0]?.message;
    if (!message) return reply.code(502).send({ error: 'The model service sent no answer.' });
    return { message, model };
  });

  if (opts.staticDir) await app.register(fastifyStatic, { root: opts.staticDir });
  app.addHook('onClose', async () => db.close());
  return app;
}
