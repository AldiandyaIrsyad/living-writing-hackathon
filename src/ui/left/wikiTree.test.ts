import { describe, expect, it } from 'vitest';
import type { Entity, Id } from '../../core/types';
import { ancestorsToOpen, wikiRows } from './wikiTree';

const entity = (id: string): Entity => ({ id, typeId: 't', name: id, aliases: [], note: '', props: {} });
const list = (...ids: string[]) => ids.map(entity);
const under = (map: Record<string, string[]>) => (id: Id) => map[id] ?? [];
const names = (rows: ReturnType<typeof wikiRows>) => rows.map((r) => `${'-'.repeat(r.depth)}${r.entity.id}`);

describe('wikiRows', () => {
  const parents = under({ ashford: ['asia'], harbor: ['ashford'], asia: ['world'] });

  it('hangs entities under their parents and shows children only once their parent is opened', () => {
    const all = list('ashford', 'asia', 'harbor', 'mira', 'world');
    expect(names(wikiRows(all, parents, new Set(), false))).toEqual(['mira', 'world']);
    expect(names(wikiRows(all, parents, new Set(['world']), false))).toEqual(['mira', 'world', '-asia']);
    expect(names(wikiRows(all, parents, new Set(['world', 'asia', 'ashford']), false))).toEqual(['mira', 'world', '-asia', '--ashford', '---harbor']);
  });

  it('flags which rows can be opened and which are', () => {
    const rows = wikiRows(list('asia', 'ashford'), under({ ashford: ['asia'] }), new Set(['asia']), false);
    expect(rows.map((r) => [r.entity.id, r.hasChildren, r.open])).toEqual([
      ['asia', true, true],
      ['ashford', false, false],
    ]);
  });

  it('treats an entity as a root when its parent is not in the list (another type, say)', () => {
    expect(names(wikiRows(list('ashford', 'mira'), parents, new Set(), false))).toEqual(['ashford', 'mira']);
  });

  it('lists an entity with two parents under each', () => {
    const rows = wikiRows(list('a', 'b', 'kid'), under({ kid: ['a', 'b'] }), new Set(['a', 'b']), false);
    expect(names(rows)).toEqual(['a', '-kid', 'b', '-kid']);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it('never hides an entity because of a loop in the data', () => {
    const rows = wikiRows(list('a', 'b', 'c'), under({ a: ['b'], b: ['a'] }), new Set(['a', 'b']), false);
    expect(names(rows)).toEqual(['c', 'a', '-b']);
  });

  it('drops the tree while a text filter is on, so every match is a plain row', () => {
    expect(names(wikiRows(list('ashford', 'harbor'), parents, new Set(['ashford']), true))).toEqual(['ashford', 'harbor']);
  });
});

describe('ancestorsToOpen', () => {
  it('names every ancestor, so an entity opened from elsewhere is visible in the tree', () => {
    expect(ancestorsToOpen('harbor', under({ ashford: ['asia'], harbor: ['ashford'], asia: ['world'] })).sort()).toEqual(['ashford', 'asia', 'world']);
  });

  it('stops on a loop', () => {
    expect(ancestorsToOpen('a', under({ a: ['b'], b: ['a'] }))).toEqual(['b']);
  });
});
