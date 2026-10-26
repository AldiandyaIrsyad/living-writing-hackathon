// Server mode (built with VITE_BACKEND=1): the vault is kept on the Living Writing server, one private vault per account.
// Without the flag none of this runs and the app stores everything in the browser.

import { currentVersion, runMigrations, type Migrations } from '../core/migrate';
import { COLLECTIONS, emptyVault, type Vault } from '../core/types';
import { diffRows, type Row, type Storage } from './db';
import { VAULT_MIGRATIONS } from './schema';

export const BACKEND = import.meta.env.VITE_BACKEND === '1';

async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: object): Promise<T> {
  const res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body && JSON.stringify(body) });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as { error?: string }) : {};
  if (!res.ok) throw new Error(json.error ?? `The server answered ${res.status}.`);
  return json as T;
}

// ---- Accounts ----

let email = '';

/** The signed-in account's email, or null when there is no session. */
export async function currentAccount(): Promise<string | null> {
  try {
    email = (await api<{ email: string }>('GET', '/api/me')).email;
    return email;
  } catch {
    return null;
  }
}

export async function signIn(mode: 'login' | 'signup', address: string, password: string): Promise<void> {
  email = (await api<{ email: string }>('POST', mode === 'login' ? '/api/login' : '/api/signup', { email: address, password })).email;
}

export const accountEmail = () => email;

/** Ends the session; the page reloads so no one's vault stays in memory for the next account. Save first. */
export async function logOut(): Promise<void> {
  await api('POST', '/api/logout');
  location.reload();
}

// ---- Vault ----

interface StoredVault {
  revision: number;
  schemaVersion: number;
  rows: Record<string, Row[]>;
}

export class ServerStorage implements Storage {
  private readonly target: number;
  /** What the server holds, as of the last load or save: a save is only accepted on top of this revision. */
  private revision = 0;
  private stored = 0;

  /** `migrations` is only passed by tests; the app uses the real registry. */
  constructor(private readonly migrations: Migrations<Vault> = VAULT_MIGRATIONS) {
    this.target = currentVersion(migrations);
  }

  async load(): Promise<Vault | null> {
    const saved = await api<StoredVault>('GET', '/api/vault');
    this.revision = saved.revision;
    this.stored = saved.schemaVersion;
    if (saved.revision === 0) return null;
    if (saved.schemaVersion > this.target) {
      throw new Error(`This vault was written by a newer version of Living Writing (storage format ${saved.schemaVersion}; this version reads ${this.target}). Nothing has been changed.`);
    }
    const v = emptyVault();
    for (const c of COLLECTIONS) {
      const target = v[c] as Record<string, unknown>;
      for (const row of saved.rows[c] ?? []) target[row.id] = row;
    }
    return saved.schemaVersion < this.target ? runMigrations(v, saved.schemaVersion, this.migrations).value : v;
  }

  async save(prev: Vault | null, next: Vault): Promise<void> {
    if (this.stored > this.target) throw new Error('The saved data is in a newer format than this tab understands; reload to continue.');
    // Rows stored in an older shape are all replaced, since a diff against the loaded vault would skip the ones the upgrade rewrote.
    const replace = this.stored < this.target;
    const put: Record<string, Row[]> = {};
    const del: Record<string, string[]> = {};
    for (const c of COLLECTIONS) {
      const d = diffRows(replace ? {} : (prev?.[c] ?? {}), next[c]);
      if (d.put.length) put[c] = d.put;
      if (d.del.length) del[c] = d.del;
    }
    const { revision } = await api<{ revision: number }>('PUT', '/api/vault', { baseRevision: this.revision, schemaVersion: this.target, replace, put, del });
    this.revision = revision;
    this.stored = this.target;
  }

  async clear(): Promise<void> {
    await api('DELETE', '/api/vault');
    this.revision = 0;
    this.stored = 0;
  }
}
