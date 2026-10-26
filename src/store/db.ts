// IndexedDB persistence via Dexie. One table per vault collection; saves are diffs by reference.

import Dexie, { type Table } from 'dexie';
import { currentVersion, runMigrations, type Migrations } from '../core/migrate';
import { COLLECTIONS, emptyVault, type CollectionName, type Vault } from '../core/types';
import { VAULT_MIGRATIONS } from './schema';

/** Storage backend interface — swap for a filesystem or server backend later. */
export interface Storage {
  load(): Promise<Vault | null>;
  save(prev: Vault | null, next: Vault): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = 'living-writing';

/** A stored row as the databases see it: any object with an id. */
export type Row = { id: string } & Record<string, unknown>;

/** The rows of one collection that differ between two saves, compared by reference: what to write and what to delete. */
export function diffRows(a: Record<string, unknown>, b: Record<string, unknown>): { put: Row[]; del: string[] } {
  if (a === b) return { put: [], del: [] };
  const put = Object.entries(b).filter(([id, row]) => a[id] !== row).map(([, row]) => row as Row);
  const del = Object.keys(a).filter((id) => !(id in b));
  return { put, del };
}

/**
 * When the vault was last saved to IndexedDB (epoch ms), or null when nothing is saved.
 * Read-only: opens the existing database without a schema and never creates one.
 */
export async function getSavedAt(): Promise<number | null> {
  if (!(await Dexie.exists(DB_NAME))) return null;
  const db = new Dexie(DB_NAME);
  try {
    await db.open();
    const meta: { savedAt?: unknown } | undefined = await db.table('meta').get('vault');
    return typeof meta?.savedAt === 'number' ? meta.savedAt : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

class LivingWritingDB extends Dexie {
  constructor() {
    super(DB_NAME);
    const schema: Record<string, string> = {};
    for (const c of COLLECTIONS) schema[c] = 'id';
    schema.meta = 'key';
    const v1 = { ...schema };
    delete v1.arcs;
    delete v1.reviewItems;
    const v2 = { ...schema };
    delete v2.reviewItems;
    this.version(1).stores(v1);
    this.version(2).stores(v2); // + arcs
    this.version(3).stores(schema); // + reviewItems
  }
  coll(name: CollectionName | 'meta'): Table<{ id: string } & Record<string, unknown>, string> {
    return this.table(name);
  }
}

/** What the meta row says about the saved schema. Databases saved before it was recorded are version 1. */
function storedVersion(meta: { schemaVersion?: unknown } | undefined): number {
  return typeof meta?.schemaVersion === 'number' ? meta.schemaVersion : 1;
}

export class IndexedDBStorage implements Storage {
  private db = new LivingWritingDB();
  private readonly target: number;

  /** `migrations` is only passed by tests; the app uses the real registry. */
  constructor(private readonly migrations: Migrations<Vault> = VAULT_MIGRATIONS) {
    this.target = currentVersion(migrations);
  }

  async load(): Promise<Vault | null> {
    const meta = await this.db.table('meta').get('vault');
    if (!meta) return null;
    const stored = storedVersion(meta);
    if (stored > this.target) {
      throw new Error(`These saved files were written by a newer version of Living Writing (storage format ${stored}; this version reads ${this.target}). Nothing has been changed.`);
    }
    const v = emptyVault();
    for (const c of COLLECTIONS) {
      const rows = await this.db.coll(c).toArray();
      const target = v[c] as Record<string, unknown>;
      for (const r of rows) target[r.id] = r;
    }
    // Nothing is written here: the stored rows stay as they were until the first save, which rewrites them in one transaction.
    return stored < this.target ? runMigrations(v, stored, this.migrations).value : v;
  }

  async save(prev: Vault | null, next: Vault): Promise<void> {
    const tables = [...COLLECTIONS.map((c) => this.db.coll(c)), this.db.table('meta')];
    await this.db.transaction('rw', tables, async () => {
      const stored = storedVersion(await this.db.table('meta').get('vault'));
      // Another tab already upgraded the database past what this one understands: writing would corrupt it.
      if (stored > this.target) throw new Error(`The saved data is in a newer format (${stored}) than this tab understands (${this.target}); reload to continue.`);
      // Rows saved in an older shape are all replaced, since a diff against the loaded vault would skip the ones the upgrade rewrote.
      const rewrite = stored < this.target;
      if (rewrite) for (const c of COLLECTIONS) await this.db.coll(c).clear();
      for (const c of COLLECTIONS) {
        const { put, del } = diffRows(rewrite ? {} : (prev?.[c] ?? {}), next[c]);
        if (put.length) await this.db.coll(c).bulkPut(put);
        if (del.length) await this.db.coll(c).bulkDelete(del);
      }
      await this.db.table('meta').put({ key: 'vault', savedAt: Date.now(), schemaVersion: this.target });
    });
  }

  async clear(): Promise<void> {
    await this.db.transaction('rw', [...COLLECTIONS.map((c) => this.db.coll(c)), this.db.table('meta')], async () => {
      for (const c of COLLECTIONS) await this.db.coll(c).clear();
      await this.db.table('meta').clear();
    });
  }
}

/**
 * Every row of every table, whatever state the database is in: a table that cannot be read is recorded as an error
 * instead of stopping the dump. For the recovery screen, where the vault itself would not load.
 */
export async function dumpRawStorage(): Promise<string> {
  const out: Record<string, unknown> = {};
  const raw = new Dexie(DB_NAME);
  try {
    await raw.open();
    for (const table of raw.tables) {
      try {
        out[table.name] = await table.toArray();
      } catch (e) {
        out[table.name] = { error: e instanceof Error ? e.message : String(e) };
      }
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  } finally {
    raw.close();
  }
  return JSON.stringify(out, null, 2);
}
