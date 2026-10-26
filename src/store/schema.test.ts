import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { VaultBuilder } from '../core/testkit';
import type { Vault } from '../core/types';
import { IndexedDBStorage } from './db';
import { SCHEMA_VERSION } from './schema';

// Contract with the writer's browser database: an older one is upgraded on load without being touched, rewritten whole
// by the first save, and a database from a newer version is refused before anything is written to it.

const upperCaseTitles = (v: Vault): Vault => ({ ...v, scenes: Object.fromEntries(Object.entries(v.scenes).map(([id, s]) => [id, { ...s, title: s.title.toUpperCase() }])) });
const storedTitles = async () => {
  const db = new Dexie('living-writing');
  await db.open();
  const titles = (await db.table('scenes').toArray()).map((s) => s.title).sort();
  const meta = await db.table('meta').get('vault');
  db.close();
  return { titles, schemaVersion: meta?.schemaVersion };
};

beforeEach(async () => {
  await Dexie.delete('living-writing');
});

describe('IndexedDBStorage schema versions', () => {
  it('upgrades an older database on load, leaves its rows alone, and rewrites them all on the first save', async () => {
    const old = new IndexedDBStorage({}); // today's schema: version 1
    await old.save(null, new VaultBuilder().scene('a').scene('b').build());
    expect(await storedTitles()).toEqual({ titles: ['a', 'b'], schemaVersion: 1 });

    const next = new IndexedDBStorage({ 1: upperCaseTitles }); // a later release: version 2
    const loaded = (await next.load())!;
    expect(Object.values(loaded.scenes).map((s) => s.title).sort()).toEqual(['A', 'B']);
    expect(await storedTitles()).toEqual({ titles: ['a', 'b'], schemaVersion: 1 }); // reading changed nothing

    // The writer edits only scene a; scene b is untouched in memory but must still be rewritten in the new shape.
    const edited = { ...loaded, scenes: { ...loaded.scenes, a: { ...loaded.scenes.a, prose: 'x' } } };
    await next.save(loaded, edited);
    expect(await storedTitles()).toEqual({ titles: ['A', 'B'], schemaVersion: 2 });
  });

  it('refuses a database written by a newer version, on load and on save, without changing it', async () => {
    const newer = new IndexedDBStorage({ 1: (v) => v });
    await newer.save(null, new VaultBuilder().scene('a').build());
    const current = new IndexedDBStorage({});
    await expect(current.load()).rejects.toThrow(/newer version/);
    await expect(current.save(null, new VaultBuilder().scene('z').build())).rejects.toThrow(/newer format/);
    expect(await storedTitles()).toEqual({ titles: ['a'], schemaVersion: 2 });
  });

  it('treats a database from before versions were recorded as version 1', async () => {
    const db = new Dexie('living-writing');
    db.version(2).stores({ meta: 'key', scenes: 'id', entities: 'id', entityTypes: 'id', moments: 'id', constraints: 'id', stories: 'id', arcs: 'id', chapters: 'id', changes: 'id' });
    await db.open();
    await db.table('meta').put({ key: 'vault', savedAt: 1 });
    db.close();
    await expect(new IndexedDBStorage({}).load()).resolves.not.toBeNull();
  });
});

describe('the real migration registry', () => {
  it('opens a version-1 database (saved before the review list existed) with an empty list, and the first save stamps the current version', async () => {
    await new IndexedDBStorage({}).save(null, new VaultBuilder().scene('a').build());
    const real = new IndexedDBStorage();
    const loaded = (await real.load())!;
    expect(loaded.reviewItems).toEqual({});
    await real.save(loaded, loaded);
    expect((await storedTitles()).schemaVersion).toBe(SCHEMA_VERSION);
  });
});
