import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp, type ServerOptions } from './app.ts';

type App = Awaited<ReturnType<typeof buildApp>>;
const apps: App[] = [];
const upstreams: Server[] = [];

async function newApp(allowSignup = true, agent?: ServerOptions['agent']): Promise<App> {
  const app = await buildApp({ dbPath: ':memory:', allowSignup, secureCookie: false, agent });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  await Promise.all(upstreams.splice(0).map((s) => new Promise((done) => s.close(done))));
});

/** One browser: keeps the session cookie between requests. */
function browser(app: App) {
  let cookie = '';
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) => {
    const res = await app.inject({ method, url, payload, headers: cookie ? { cookie } : {} });
    const set = res.cookies.find((c) => c.name === 'lw_session');
    if (set) cookie = `lw_session=${set.value}`;
    return { status: res.statusCode, body: res.json() as Record<string, unknown> };
  };
  return { call, sessionCookie: () => cookie };
}

const credentials = (email: string) => ({ email, password: 'correct horse' });
const save = (baseRevision: number, put: object = {}, del: object = {}) => ({ baseRevision, schemaVersion: 1, replace: false, put, del });

describe('vault storage', () => {
  it('returns exactly what was saved, including after rows are deleted', async () => {
    const b = browser(await newApp());
    await b.call('POST', '/api/signup', credentials('a@example.com'));
    expect((await b.call('GET', '/api/vault')).body.revision).toBe(0);

    await b.call('PUT', '/api/vault', save(0, { scenes: [{ id: 's1', title: 'One' }, { id: 's2', title: 'Two' }], stories: [{ id: 'st', name: 'Main' }] }));
    const second = await b.call('PUT', '/api/vault', save(1, { scenes: [{ id: 's1', title: 'One, revised' }] }, { scenes: ['s2'] }));
    expect(second.body.revision).toBe(2);

    expect((await b.call('GET', '/api/vault')).body.rows).toEqual({
      scenes: [{ id: 's1', title: 'One, revised' }],
      stories: [{ id: 'st', name: 'Main' }],
    });
  });

  it('keeps each account’s vault private', async () => {
    const app = await newApp();
    const a = browser(app);
    const b = browser(app);
    await a.call('POST', '/api/signup', credentials('a@example.com'));
    await b.call('POST', '/api/signup', credentials('b@example.com'));
    await a.call('PUT', '/api/vault', save(0, { scenes: [{ id: 's1' }] }));

    expect((await b.call('GET', '/api/vault')).body).toEqual({ revision: 0, schemaVersion: 0, rows: {} });
    // B's first save is not a conflict with A's vault, and does not touch it.
    await b.call('PUT', '/api/vault', save(0, { scenes: [{ id: 's1', title: 'B' }] }));
    expect((await a.call('GET', '/api/vault')).body.rows).toEqual({ scenes: [{ id: 's1' }] });
  });

  it('refuses a save made on top of an older revision and leaves the stored vault alone', async () => {
    const app = await newApp();
    const first = browser(app);
    await first.call('POST', '/api/signup', credentials('a@example.com'));
    const other = browser(app);
    await other.call('POST', '/api/login', credentials('a@example.com'));

    await first.call('PUT', '/api/vault', save(0, { scenes: [{ id: 's1', title: 'From the first tab' }] }));
    const stale = await other.call('PUT', '/api/vault', save(0, { scenes: [{ id: 's1', title: 'From the stale tab' }] }));

    expect(stale.status).toBe(409);
    expect((await first.call('GET', '/api/vault')).body.rows).toEqual({ scenes: [{ id: 's1', title: 'From the first tab' }] });
  });

  it('rejects a save naming a collection the app does not have', async () => {
    const b = browser(await newApp());
    await b.call('POST', '/api/signup', credentials('a@example.com'));
    expect((await b.call('PUT', '/api/vault', save(0, { notACollection: [{ id: 'x' }] }))).status).toBe(400);
  });
});

describe('accounts', () => {
  it('stops working for a session after logout, and for a wrong password', async () => {
    const app = await newApp();
    const b = browser(app);
    await b.call('POST', '/api/signup', credentials('a@example.com'));
    const stolen = b.sessionCookie();
    await b.call('POST', '/api/logout');

    const replay = await app.inject({ method: 'GET', url: '/api/vault', headers: { cookie: stolen } });
    expect(replay.statusCode).toBe(401);
    expect((await browser(app).call('POST', '/api/login', { email: 'a@example.com', password: 'wrong password' })).status).toBe(401);
  });

  it('refuses sign-up when the server is closed to new accounts', async () => {
    const res = await browser(await newApp(false)).call('POST', '/api/signup', credentials('a@example.com'));
    expect(res.status).toBe(403);
  });

  it('treats emails as case-insensitive and refuses a duplicate', async () => {
    const app = await newApp();
    await browser(app).call('POST', '/api/signup', credentials('Alice@Example.com'));
    expect((await browser(app).call('POST', '/api/signup', credentials('alice@example.com'))).status).toBe(409);
    expect((await browser(app).call('POST', '/api/login', credentials('ALICE@example.com'))).status).toBe(200);
  });
});

describe('the story agent relay', () => {
  /** A stand-in for the model service: records what it was sent and answers with `status`. */
  async function fakeModel(status = 200) {
    const seen: { auth?: string; body?: { model: string; messages: unknown[] } } = {};
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        seen.auth = req.headers.authorization;
        seen.body = JSON.parse(raw);
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(status === 200 ? { choices: [{ message: { role: 'assistant', content: '{}' } }] } : { error: 'nope' }));
      });
    });
    upstreams.push(server);
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    const { port } = server.address() as { port: number };
    return { seen, baseUrl: `http://127.0.0.1:${port}/v1` };
  }

  const ask = { messages: [{ role: 'user', content: 'a scene' }] };

  it('relays one chat call with the server’s key and the chosen model, only for a signed-in account, and never returns the key', async () => {
    const model = await fakeModel();
    const app = await newApp(true, { apiKey: 'secret-key', baseUrl: model.baseUrl, models: ['muse-a', 'muse-b'] });
    const b = browser(app);
    expect((await b.call('POST', '/api/agent/chat', ask)).status).toBe(401);

    await b.call('POST', '/api/signup', credentials('a@example.com'));
    const res = await b.call('POST', '/api/agent/chat', { ...ask, model: 'muse-b' });
    expect(res.body).toEqual({ message: { role: 'assistant', content: '{}' }, model: 'muse-b' });
    expect(model.seen).toEqual({ auth: 'Bearer secret-key', body: { model: 'muse-b', messages: ask.messages } });
    expect(JSON.stringify(res.body)).not.toContain('secret-key');
  });

  it('uses the first model when none is chosen, and refuses one the server does not offer', async () => {
    const model = await fakeModel();
    const b = browser(await newApp(true, { apiKey: 'k', baseUrl: model.baseUrl, models: ['muse-a', 'muse-b'] }));
    await b.call('POST', '/api/signup', credentials('a@example.com'));
    expect((await b.call('GET', '/api/agent')).body).toEqual({ enabled: true, models: ['muse-a', 'muse-b'] });
    expect((await b.call('POST', '/api/agent/chat', ask)).body.model).toBe('muse-a');
    expect((await b.call('POST', '/api/agent/chat', { ...ask, model: 'someone-elses-model' })).status).toBe(400);
  });

  it('says so when the server has no key, and when the model service refuses', async () => {
    const off = browser(await newApp());
    await off.call('POST', '/api/signup', credentials('a@example.com'));
    expect((await off.call('GET', '/api/agent')).body).toEqual({ enabled: false, models: [] });
    expect((await off.call('POST', '/api/agent/chat', ask)).status).toBe(503);

    const model = await fakeModel(500);
    const on = browser(await newApp(true, { apiKey: 'k', baseUrl: model.baseUrl, models: ['m'] }));
    await on.call('POST', '/api/signup', credentials('b@example.com'));
    const refused = await on.call('POST', '/api/agent/chat', ask);
    expect(refused.status).toBe(502);
    expect(refused.body.error).toContain('500');
  });
});
