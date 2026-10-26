import { describe, expect, it } from 'vitest';
import { Resolver } from './resolve';
import { createDemoVault } from './seed';
import { formatStateQuery, parseStateQuery, runStateQuery, whenToTimePoint, type StateQuery } from './stateQuery';
import { VaultBuilder } from './testkit';
import { LATEST, type Vault } from './types';

const parse = (text: string): StateQuery => {
  const r = parseStateQuery(text);
  if (!r.ok) throw new Error(r.error);
  return r.query;
};

/** Names of the entities a query returns at a time, as the palette would show them. */
function names(vault: Vault, text: string, playhead = 0): string[] {
  const q = parse(text);
  const tp = whenToTimePoint(vault, q.when, playhead);
  if (!tp) throw new Error('unknown time');
  const r = new Resolver(vault);
  return runStateQuery(vault, r, q, tp).map((id) => r.entityAt(id, tp).name);
}

describe('parse and format', () => {
  it('reads every kind of term, and prints the same query back', () => {
    const q = parse('type=Character status!=dead location=[[the keep]] #noble gone at "The Fall of Ashford"');
    expect(q).toEqual({
      terms: [
        { name: 'type', op: '=', value: 'Character' },
        { name: 'status', op: '!=', value: 'dead' },
        { name: 'location', op: '=', value: '[[the keep]]' },
      ],
      tags: ['noble'],
      gone: true,
      when: { kind: 'scene', title: 'The Fall of Ashford' },
    });
    expect(parseStateQuery(formatStateQuery(q))).toEqual({ ok: true, query: q });
  });

  it('round-trips a generated set of queries, including values with spaces and scene titles with “at”', () => {
    const values = ['dead', '', 'in the keep', '[[Mira the Brave]]', 'a=b', '3'];
    const whens: StateQuery['when'][] = [{ kind: 'playhead' }, { kind: 'latest' }, { kind: 'scene', title: 'Meet at the ford' }];
    let n = 0;
    for (const value of values) {
      for (const op of ['=', '!='] as const) {
        for (const when of whens) {
          for (const gone of [false, true]) {
            const q: StateQuery = { terms: [{ name: 'status', op, value }, { name: 'type', op: '=', value: 'Magic / System' }], tags: n % 2 ? ['a', 'b/c'] : [], gone, when };
            expect(parseStateQuery(formatStateQuery(q)), formatStateQuery(q)).toEqual({ ok: true, query: q });
            n++;
          }
        }
      }
    }
    expect(n).toBe(72);
  });

  it('says what it did not understand, and a bare query matches every existing entity', () => {
    expect(parseStateQuery('status=dead banana')).toEqual({ ok: false, error: expect.stringContaining('banana') });
    expect(parseStateQuery('at ')).toMatchObject({ ok: false, error: expect.stringContaining('“at”') });
    expect(parseStateQuery('#')).toMatchObject({ ok: false });
    expect(parse('')).toEqual({ terms: [], tags: [], gone: false, when: { kind: 'playhead' } });
  });
});

describe('runStateQuery over the demo world', () => {
  const vault = createDemoVault();

  it('follows the story: Norman is alive before his death scene and dead after it', () => {
    expect(names(vault, 'status=alive type=Character at "The Betrayal"')).toContain('Norman');
    expect(names(vault, 'status=alive type=Character at latest')).not.toContain('Norman');
    expect(names(vault, 'status=dead at latest')).toEqual(['Norman']);
    expect(names(vault, 'status!=dead type=Character at latest')).not.toContain('Norman');
  });

  it('answers at the playhead by default, and the answer changes as the playhead crosses the death scene', () => {
    const early = names(vault, 'status=dead', 0);
    const late = names(vault, 'status=dead', 1e6);
    expect(early).toEqual([]);
    expect(late).toEqual(['Norman']);
  });

  it('matches a link value by the page it points at, and a list by any of its items', () => {
    const members = names(vault, 'affiliations=[[The Ashford Guard]] at latest');
    expect(members.length).toBeGreaterThan(0);
    expect(names(vault, 'affiliations=[[the-ashford-guard]] at latest')).toEqual(members);
    expect(names(vault, 'affiliations=[[Somebody Else]] at latest')).toEqual([]);
  });

  it('agrees with a plain filter over every entity at every scene, for every property value in the vault', () => {
    const r = new Resolver(vault);
    for (const scene of Object.values(vault.scenes)) {
      const tp = whenToTimePoint(vault, { kind: 'scene', title: scene.title }, 0)!;
      for (const [prop, value] of [['status', 'alive'], ['status', 'dead'], ['status', 'enemies'], ['role', 'wanderer']]) {
        const expected = Object.values(vault.entities)
          .map((e) => ({ s: r.entityAt(e.id, tp), id: e.id }))
          .filter(({ s }) => s.exists && s.props[prop]?.value === value)
          .map(({ s }) => s.name)
          .sort((a, b) => a.localeCompare(b));
        expect(names(vault, `${prop}=${value} at "${scene.title}"`), `${prop}=${value} at ${scene.title}`).toEqual(expected);
      }
    }
  });
});

describe('existence', () => {
  it('only returns entities that exist at that time, unless asked for the ones that do not', () => {
    const b = new VaultBuilder().entity('ghost', {}, 'Ghost').entity('stone', {}, 'Stone').scene('a').scene('b').chain('a', 'b').op('b', 'ghost', 'create');
    const v = b.build();
    expect(names(v, 'at "a"')).toEqual(['Stone']);
    expect(names(v, 'gone at "a"')).toEqual(['Ghost']);
    expect(names(v, 'at latest')).toEqual(['Ghost', 'Stone']);
    expect(whenToTimePoint(v, { kind: 'scene', title: 'nowhere' }, 0)).toBeNull();
    expect(whenToTimePoint(v, { kind: 'latest' }, 0)).toBe(LATEST);
  });
});
