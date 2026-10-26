import { describe, expect, it } from 'vitest';
import { FORMAT_VERSION, checkEnvelope, exportJSON, importJSON } from './exchange';
import { runMigrations, type Migrations } from './migrate';
import { emptyVault } from './types';

type Doc = { log: string[]; n?: number };
const step = (name: string) => (d: Doc): Doc => ({ ...d, log: [...d.log, name] });
const chain: Migrations<Doc> = { 1: step('1→2'), 2: step('2→3') };

describe('runMigrations', () => {
  it('applies each step from the stored version up, in order, and no earlier one', () => {
    expect(runMigrations({ log: [] }, 1, chain)).toEqual({ value: { log: ['1→2', '2→3'] }, version: 3 });
    expect(runMigrations({ log: [] }, 2, chain).value.log).toEqual(['2→3']);
    expect(runMigrations({ log: [] }, 3, chain).value.log).toEqual([]);
  });

  it('refuses data from a newer version, and versions that make no sense', () => {
    expect(() => runMigrations({ log: [] }, 4, chain)).toThrow(/newer version \(format 4, this app reads 3\)/);
    for (const bad of [0, -1, 1.5, NaN]) expect(() => runMigrations({ log: [] }, bad, chain)).toThrow(/whole number/);
  });

  it('names the failing step and leaves the original untouched when one throws or mutates halfway', () => {
    const original: Doc = { log: [], n: 1 };
    const mutatesThenThrows: Migrations<Doc> = {
      1: step('1→2'),
      2: (d) => {
        d.log.push('half done');
        throw new Error('bad row');
      },
    };
    expect(() => runMigrations(original, 1, mutatesThenThrows, (v) => structuredClone(v))).toThrow(/from format 2 to 3: bad row/);
    expect(original).toEqual({ log: [], n: 1 });
  });

  it('reports a gap in the chain instead of skipping it', () => {
    expect(() => runMigrations({ log: [] }, 1, { 2: step('2→3') } as Migrations<Doc>)).toThrow(/no way to upgrade format 1/);
  });
});

describe('opening an export from another format version', () => {
  const doc = (version: unknown) => ({ format: 'living-writing', version, vault: {} });

  it('runs the registry on the parsed document before validating it, and stamps the new version', () => {
    const upgraded = checkEnvelope(doc(1), { 1: (d) => ({ ...d, upgraded: true }) });
    expect(upgraded).toMatchObject({ upgraded: true, version: 2 });
  });

  it('turns a failing migration into a clear "Invalid file" message', () => {
    expect(() =>
      checkEnvelope(doc(1), {
        1: () => {
          throw new Error('boom');
        },
      }),
    ).toThrow(/Invalid file: could not upgrade from format 1 to 2: boom/);
  });

  it('still refuses a file one version newer than this app, and changes nothing', () => {
    const text = JSON.stringify({ ...doc(FORMAT_VERSION + 1), vault: emptyVault() });
    expect(() => importJSON(text)).toThrow(`newer version (format ${FORMAT_VERSION + 1}, this app reads ${FORMAT_VERSION})`);
    expect(importJSON(exportJSON(emptyVault()))).toEqual(emptyVault());
  });
});
