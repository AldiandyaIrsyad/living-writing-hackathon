import { describe, expect, it } from 'vitest';
import { addParent, addSibling, baseRelations, PARENT, relationsAt, removeParent, removeSibling, SIBLINGS, wouldLoop } from './relations';
import { Resolver } from './resolve';
import { VaultBuilder } from './testkit';
import type { Props, Vault } from './types';

const link = (target: string) => ({ kind: 'link' as const, target });

/** Entities are named by their ids ("Asia", "Ashford"…). Scenes s1 < s2 < s3. */
function world(props: Record<string, Props> = {}): Vault {
  const b = new VaultBuilder();
  for (const id of ['world', 'asia', 'ashford', 'harbor', 'mira', 'bob', 'cleo']) b.entity(id, props[id] ?? {}, id);
  b.scene('s1').scene('s2').scene('s3').chain('s1', 's2', 's3');
  return b.build();
}

const at = (v: Vault, sceneId: string, own = true) => relationsAt(new Resolver(v), new Resolver(v).atScene(sceneId, own));

describe('parent and children', () => {
  it('stores one link on the child and finds the children from the parent, with no second link to keep in step', () => {
    const v = addParent(world(), 'ashford', 'asia', 'base');
    expect(v.entities.ashford.props[PARENT]).toEqual([link('asia')]);
    expect(v.entities.asia.props[PARENT]).toBeUndefined();
    const rel = baseRelations(v);
    expect(rel.parents('ashford')).toEqual(['asia']);
    expect(rel.children('asia')).toEqual(['ashford']);
  });

  it('is a tree you can walk: descendants and ancestors, across several levels and several parents', () => {
    let v = world();
    v = addParent(v, 'asia', 'world', 'base');
    v = addParent(v, 'ashford', 'asia', 'base');
    v = addParent(v, 'harbor', 'ashford', 'base');
    v = addParent(v, 'harbor', 'world', 'base');
    const rel = baseRelations(v);
    expect(rel.descendants('world')).toEqual(['ashford', 'asia', 'harbor']);
    expect(rel.ancestors('harbor')).toEqual(['ashford', 'asia', 'world']);
    expect(rel.parents('harbor')).toEqual(['ashford', 'world']);
  });

  it('refuses a parent that would put an entity above itself, and survives bad data that already loops', () => {
    const v = addParent(world(), 'ashford', 'asia', 'base');
    expect(addParent(v, 'asia', 'ashford', 'base')).toBe(v);
    expect(addParent(v, 'asia', 'asia', 'base')).toBe(v);
    expect(wouldLoop(baseRelations(v), 'asia', 'ashford')).toBe(true);
    const bad = world({ asia: { [PARENT]: [link('ashford')] }, ashford: { [PARENT]: [link('asia')] } });
    expect(baseRelations(bad).descendants('asia')).toEqual(['ashford']);
  });

  it('comes back unchanged when the link is already there, and removes it again', () => {
    const v = addParent(world(), 'ashford', 'asia', 'base');
    expect(addParent(v, 'ashford', 'asia', 'base')).toBe(v);
    const back = removeParent(v, 'ashford', 'asia', 'base');
    expect(back.entities.ashford.props[PARENT]).toBeUndefined();
    expect(baseRelations(back).children('asia')).toEqual([]);
  });

  it('changes over the story like any committed fact: a parent set after a scene holds only from there on', () => {
    let v = addParent(world(), 'ashford', 'asia', 'base');
    v = addParent(v, 'ashford', 'world', { sceneId: 's2' });
    v = removeParent(v, 'ashford', 'asia', { sceneId: 's3' });
    expect(at(v, 's1').parents('ashford')).toEqual(['asia']);
    expect(at(v, 's2').parents('ashford')).toEqual(['asia', 'world']);
    expect(at(v, 's3').parents('ashford')).toEqual(['world']);
    expect(at(v, 's3').children('asia')).toEqual([]);
    // The same commit twice is nothing to commit.
    expect(addParent(v, 'ashford', 'world', { sceneId: 's2' })).toBe(v);
  });

  it('does not list an entity before it exists', () => {
    const v = addParent(world(), 'mira', 'ashford', 'base');
    v.changes.born = { id: 'born', sceneId: 's2', entityId: 'mira', op: 'create', order: 0 };
    expect(at(v, 's1', false).children('ashford')).toEqual([]);
    expect(at(v, 's2').children('ashford')).toEqual(['mira']);
  });
});

describe('siblings', () => {
  it('are whoever shares a parent, without storing anything', () => {
    let v = world();
    v = addParent(v, 'mira', 'ashford', 'base');
    v = addParent(v, 'bob', 'ashford', 'base');
    const rel = baseRelations(v);
    expect(rel.siblings('mira')).toEqual(['bob']);
    expect(rel.siblings('bob')).toEqual(['mira']);
    expect(v.entities.mira.props[SIBLINGS]).toBeUndefined();
  });

  it('can be set by hand, are stored once and read both ways', () => {
    const v = addSibling(world(), 'mira', 'cleo', 'base');
    expect(v.entities.mira.props[SIBLINGS]).toEqual([link('cleo')]);
    expect(v.entities.cleo.props[SIBLINGS]).toBeUndefined();
    const rel = baseRelations(v);
    expect(rel.siblings('mira')).toEqual(['cleo']);
    expect(rel.siblings('cleo')).toEqual(['mira']);
    // Already siblings, from either side: nothing to add.
    expect(addSibling(v, 'cleo', 'mira', 'base')).toBe(v);
  });

  it('give nobody a parent and do not spread to the siblings of siblings', () => {
    // mira and bob are children of ashford; mira is also a sibling of cleo, who has no parent.
    let v = world();
    v = addParent(v, 'mira', 'ashford', 'base');
    v = addParent(v, 'bob', 'ashford', 'base');
    v = addSibling(v, 'mira', 'cleo', 'base');
    const rel = baseRelations(v);
    expect(rel.parents('cleo')).toEqual([]);
    expect(rel.children('ashford')).toEqual(['bob', 'mira']);
    expect(rel.siblings('cleo')).toEqual(['mira']);
    expect(rel.siblings('bob')).toEqual(['mira']);
    expect(rel.siblings('mira')).toEqual(['bob', 'cleo']);
  });

  it('can be taken away from either side, but a shared parent is not a link to remove', () => {
    const v = addSibling(world(), 'mira', 'cleo', 'base');
    expect(baseRelations(removeSibling(v, 'cleo', 'mira', 'base')).siblings('mira')).toEqual([]);
    expect(baseRelations(removeSibling(v, 'mira', 'cleo', 'base')).siblings('cleo')).toEqual([]);
    const shared = addParent(addParent(world(), 'mira', 'ashford', 'base'), 'bob', 'ashford', 'base');
    expect(removeSibling(shared, 'mira', 'bob', 'base')).toBe(shared);
  });

  it('can start and stop mid-story', () => {
    let v = addSibling(world(), 'mira', 'cleo', { sceneId: 's2' });
    v = removeSibling(v, 'cleo', 'mira', { sceneId: 's3' });
    expect(at(v, 's1').siblings('mira')).toEqual([]);
    expect(at(v, 's2').siblings('cleo')).toEqual(['mira']);
    expect(at(v, 's3').siblings('cleo')).toEqual([]);
  });
});
