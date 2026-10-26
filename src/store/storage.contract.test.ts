import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../server/app';
import { VaultBuilder } from '../core/testkit';
import type { Vault } from '../core/types';
import { IndexedDBStorage, type Storage } from './db';
import { ServerStorage } from './server';

// Contract the store depends on, whichever place the vault is kept: what was saved is what loads, a row removed in a later
// save stays removed, and a cleared vault loads as nothing.

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App | null = null;

/** Points fetch at an in-process server, signed in as a fresh account. */
async function connectToServer(): Promise<void> {
  app = await buildApp({ dbPath: ':memory:', allowSignup: true, secureCookie: false });
  const signup = await app.inject({ method: 'POST', url: '/api/signup', payload: { email: 'writer@example.com', password: 'correct horse' } });
  const cookie = `lw_session=${signup.cookies[0].value}`;
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    const res = await app!.inject({ method: init.method as 'GET', url: path, payload: init.body as string | undefined, headers: { cookie, ...(init.headers as Record<string, string>) } });
    return new Response(res.body, { status: res.statusCode });
  });
}

async function serverStorage(): Promise<Storage> {
  await connectToServer();
  return new ServerStorage();
}

beforeEach(async () => {
  await Dexie.delete('living-writing');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await app?.close();
  app = null;
});

describe.each([
  ['IndexedDBStorage', async (): Promise<Storage> => new IndexedDBStorage()],
  ['ServerStorage', serverStorage],
])('%s', (_name, open) => {
  it('loads nothing before the first save, and what was saved afterwards', async () => {
    const storage = await open();
    expect(await storage.load()).toBeNull();

    const vault = new VaultBuilder().scene('a').scene('b').build();
    await storage.save(null, vault);
    expect(await storage.load()).toEqual(vault);
  });

  it('keeps an edit and forgets a removed row after a later save', async () => {
    const storage = await open();
    const first = new VaultBuilder().scene('a').scene('b').build();
    await storage.save(null, first);

    const [idA, idB] = Object.keys(first.scenes);
    const { [idB]: _removed, ...rest } = first.scenes;
    const second = { ...first, scenes: { ...rest, [idA]: { ...first.scenes[idA], prose: 'edited' } } };
    await storage.save(first, second);

    expect(await storage.load()).toEqual(second);
  });

  it('loads as nothing again once cleared', async () => {
    const storage = await open();
    await storage.save(null, new VaultBuilder().scene('a').build());
    await storage.clear();
    expect(await storage.load()).toBeNull();
  });
});

describe('ServerStorage schema versions', () => {
  const upperCaseTitles = (v: Vault): Vault => ({ ...v, scenes: Object.fromEntries(Object.entries(v.scenes).map(([id, s]) => [id, { ...s, title: s.title.toUpperCase() }])) });
  const titles = (v: Vault | null) => Object.values(v!.scenes).map((s) => s.title).sort();

  it('upgrades an older vault on load and rewrites all of its rows on the first save', async () => {
    await connectToServer();
    await new ServerStorage({}).save(null, new VaultBuilder().scene('a').scene('b').build()); // today's schema: version 1

    const later = new ServerStorage({ 1: upperCaseTitles }); // a later release: version 2
    const loaded = (await later.load())!;
    expect(titles(loaded)).toEqual(['A', 'B']);

    // The writer edits only scene a; scene b is untouched in memory but must still be stored in the new shape.
    const [idA] = Object.keys(loaded.scenes);
    await later.save(loaded, { ...loaded, scenes: { ...loaded.scenes, [idA]: { ...loaded.scenes[idA], prose: 'x' } } });

    expect(titles(await new ServerStorage({ 1: upperCaseTitles }).load())).toEqual(['A', 'B']);
  });

  it('refuses a vault written by a newer version, without changing it', async () => {
    await connectToServer();
    await new ServerStorage({ 1: (v) => v }).save(null, new VaultBuilder().scene('a').build()); // version 2
    const current = new ServerStorage({});
    await expect(current.load()).rejects.toThrow(/newer version/);
    await expect(current.save(null, new VaultBuilder().scene('z').build())).rejects.toThrow(/newer format/);
  });
});
