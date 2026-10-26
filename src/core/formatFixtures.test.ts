import { describe, expect, it } from 'vitest';
import { exportJSON, filesToVault, importJSON, vaultToFiles } from './exchange';
import v1Files from './fixtures/format-v1.files.json';
import v1Json from './fixtures/format-v1.json?raw';
import v2Files from './fixtures/format-v2.files.json';
import v2Json from './fixtures/format-v2.json?raw';
import v3Files from './fixtures/format-v3.files.json';
import v3Json from './fixtures/format-v3.json?raw';
import { findEntity, findScene } from './links';
import { Resolver } from './resolve';
import type { Vault } from './types';

// Contract with the writer's archive: the files below were written by released versions of the format, from the demo
// world, and are FROZEN. Never edit them. When the format changes, add format-vN.* beside them and a migration; every
// version stays here, and every one must keep importing as the same world. (Why: exports and sync folders outlive the
// app version.) v1 predates the review list; v2 has two review items, one open and one done; v3 adds scene statuses.

const versions: [string, () => Vault, () => Vault][] = [
  ['v1', () => importJSON(v1Json), () => filesToVault(new Map(Object.entries(v1Files)))],
  ['v2', () => importJSON(v2Json), () => filesToVault(new Map(Object.entries(v2Files)))],
  ['v3', () => importJSON(v3Json), () => filesToVault(new Map(Object.entries(v3Files)))],
];

describe.each(versions.flatMap(([v, json, files]) => [[`${v} JSON export`, json] as const, [`${v} markdown files`, files] as const]))('format fixture: %s', (_name, read) => {
  it('still reads as the same story world, with the facts the spec promises', () => {
    const vault = read();
    const r = new Resolver(vault);
    const norman = findEntity(vault, 'norman')!.id;
    const aliceBob = findEntity(vault, 'alice-bob')!.id;
    const fall = findScene(vault, 'The Fall of Ashford')!.id;

    expect(r.entityAt(norman, r.atScene(fall)).props.status.value).toBe('alive');
    expect(r.entityAt(norman, { kind: 'latest' }).props.status.value).toBe('dead');
    expect(r.entityAt(aliceBob, { kind: 'latest' }).props.status.value).toBe('enemies');
  });

  it('exports and imports again without changing', () => {
    const vault = read();
    expect(importJSON(exportJSON(vault))).toStrictEqual(vault);
    expect(filesToVault(vaultToFiles(vault))).toStrictEqual(vault);
  });
});

describe('every version of the format describes the same world', () => {
  it('v3 keeps the status of each scene, and older archives have none', () => {
    const statuses = (v: Vault) => Object.values(v.scenes).filter((s) => s.status).map((s) => s.status).sort();
    expect(statuses(versions[2][1]())).toEqual(['done', 'draft', 'revised']);
    expect(statuses(versions[0][1]())).toEqual([]);
    expect(statuses(versions[2][2]())).toEqual(['done', 'draft', 'revised']);
  });

  it('JSON and markdown agree within each version', () => {
    for (const [, json, files] of versions) expect(json()).toStrictEqual(files());
  });

  it('a v1 archive opens with an empty review list, and a v2 one keeps the writer\'s items and their status', () => {
    expect(Object.keys(versions[0][1]().reviewItems)).toEqual([]);
    const items = Object.values(versions[1][1]().reviewItems);
    expect(items.map((i) => [i.cause, i.status]).sort()).toEqual([
      ['Delete a commit: Norman status: dead → alive', 'open'],
      ['Moved a scene', 'done'],
    ]);
  });
});
