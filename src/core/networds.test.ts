import { describe, expect, it } from 'vitest';
import { PASTE_LIMIT, netWordsAdded, netWordsBetween } from './networds';
import { VaultBuilder } from './testkit';
import type { Vault } from './types';

const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');

describe('netWordsAdded', () => {
  it('counts insertions and deletions, and nothing for an edit that keeps the count or only moves text', () => {
    expect(netWordsAdded('one two', 'one two three four')).toBe(2);
    expect(netWordsAdded('one two three four', 'one two')).toBe(-2);
    expect(netWordsAdded('the grey cat', 'the black dog')).toBe(0);
    expect(netWordsAdded('First para here.\n\nSecond para there.', 'Second para there.\n\nFirst para here.')).toBe(0);
  });

  it('deleting a stretch and typing it again nets what was first written', () => {
    const wrote = words(300);
    const deleted = words(200);
    expect(netWordsAdded('', wrote) + netWordsAdded(wrote, deleted) + netWordsAdded(deleted, wrote)).toBe(300);
  });

  it('does not count words inside author notes', () => {
    expect(netWordsAdded('hello', 'hello %% a long private note to myself %%')).toBe(0);
  });

  it('does not count a paste bigger than the limit as writing, but counts one at the limit', () => {
    expect(netWordsAdded('', words(PASTE_LIMIT + 1))).toBe(0);
    expect(netWordsAdded('', words(PASTE_LIMIT))).toBe(PASTE_LIMIT);
  });
});

describe('netWordsBetween', () => {
  const world = (prose: Record<string, string>): Vault => {
    const b = new VaultBuilder();
    Object.keys(prose).forEach((id) => b.scene(id));
    const v = b.build();
    for (const [id, p] of Object.entries(prose)) v.scenes[id] = { ...v.scenes[id], prose: p };
    return v;
  };
  const edit = (v: Vault, id: string, prose: string): Vault => ({ ...v, scenes: { ...v.scenes, [id]: { ...v.scenes[id], prose } } });

  it('sums the scenes whose prose changed', () => {
    const v = world({ a: 'one', b: 'two' });
    expect(netWordsBetween(v, edit(edit(v, 'a', 'one more'), 'b', 'two more words'))).toBe(3);
  });

  it('counts nothing when scenes come or go, or when many change at once (an import or a replace-all)', () => {
    const v = world({ a: 'one', b: 'two', c: 'three', d: 'four', e: 'five' });
    expect(netWordsBetween(v, world({ a: 'one', b: 'two', c: 'three', d: 'four', e: 'five', f: 'six seven' }))).toBe(0);
    expect(netWordsBetween(world({ a: 'one', b: 'two' }), world({ a: 'one more' }))).toBe(0);
    const many = ['a', 'b', 'c', 'd'].reduce((acc, id) => edit(acc, id, 'x y z'), v);
    expect(netWordsBetween(v, many)).toBe(0);
  });

  it('counts nothing when only something other than prose changed', () => {
    const v = world({ a: 'one' });
    expect(netWordsBetween(v, { ...v, scenes: { ...v.scenes, a: { ...v.scenes.a, title: 'New title' } } })).toBe(0);
  });
});
