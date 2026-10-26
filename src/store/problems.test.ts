import { describe, expect, it } from 'vitest';
import { createDemoVault } from '../core/seed';
import { VaultBuilder } from '../core/testkit';
import type { Vault } from '../core/types';
import { findProblems } from './problems';

const mention = (v: Vault, sceneId: string, text: string): Vault => ({ ...v, scenes: { ...v.scenes, [sceneId]: { ...v.scenes[sceneId], prose: text } } });
const rules = (v: Vault) => findProblems(v).map((p) => `${p.rule}:${p.sceneId}`);

describe('gone: a scene mentions an entity that is retired or not yet created', () => {
  const base = () => new VaultBuilder().entity('norman', { status: 'alive' }).scene('a').scene('b').scene('c').chain('a', 'b', 'c').op('b', 'norman', 'retire');

  it('flags a mention after the retire, but not in the scene that retires him, nor before it', () => {
    let v = base().build();
    v = mention(v, 'a', '[[norman]] lives.');
    v = mention(v, 'b', '[[norman]] falls.');
    v = mention(v, 'c', '[[norman]] walks in.');
    expect(rules(v)).toEqual(['gone:c']);
  });

  it('is silent for a flashback: read last, but set before the death', () => {
    let v = base().build();
    // Scene a is read after scene c in the telling, yet happens first in the story.
    v = mention(v, 'a', '[[norman]] as a boy.');
    v = { ...v, scenes: { ...v.scenes, a: { ...v.scenes.a, order: 9 } } };
    expect(rules(v)).toEqual([]);
  });

  it('is silent when the retire is unordered against the scene', () => {
    const b = new VaultBuilder().entity('norman').scene('a').scene('b').scene('c').chain('a', 'b').op('a', 'norman', 'retire');
    expect(rules(mention(b.build(), 'c', '[[norman]]'))).not.toContain('gone:c');
  });

  it('flags a mention before the entity is created', () => {
    let v = new VaultBuilder().entity('baby').scene('a').scene('b').chain('a', 'b').op('b', 'baby', 'create').build();
    v = mention(v, 'a', '[[baby]] cries.');
    const [p] = findProblems(v);
    expect(p.rule).toBe('gone');
    expect(p.message).toContain('does not exist yet');
  });

  it('gets a new fingerprint when the retire moves, so a dismissal does not outlive the facts', () => {
    let v = base().build();
    v = mention(v, 'c', '[[norman]]');
    const before = findProblems(v)[0].id;
    const other = Object.values(v.changes)[0];
    v = { ...v, changes: { ...v.changes, [other.id]: { ...other, id: 'moved' } } };
    expect(findProblems(v)[0].id).not.toBe(before);
  });
});

describe('unresolved: a link that names nothing', () => {
  it('flags [[Nobody]] once per scene, and spares entities, aliases, scenes and code', () => {
    let v = new VaultBuilder().entity('norman', {}, 'Norman').scene('a').scene('b').chain('a', 'b').build();
    v = { ...v, entities: { norman: { ...v.entities.norman, aliases: ['Nor'] } } };
    v = mention(v, 'a', '[[Norman]] [[Nor]] [[b]] `[[in code]]` [[Nobody]] again [[Nobody]]');
    expect(rules(v)).toEqual(['unresolved:a']);
  });
});

describe('ambiguous: unordered scenes disagree', () => {
  const two = (ordered: boolean) => {
    const b = new VaultBuilder().entity('mira', { mood: 'calm' }).scene('a').scene('b').scene('c').chain('a', 'c');
    if (ordered) b.chain('a', 'b', 'c');
    else b.chain('b', 'c'); // b and a have no order between them
    return b.change('a', 'mira', 'mood', 'angry').change('b', 'mira', 'mood', 'afraid').build();
  };

  it('flags the property when two unordered scenes set different values', () => {
    const found = findProblems(two(false)).filter((p) => p.rule === 'ambiguous');
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/mood/);
  });

  it('is silent once the scenes are placed in order', () => {
    expect(findProblems(two(true)).filter((p) => p.rule === 'ambiguous')).toEqual([]);
  });
});

describe('floating: a scene placed relative to nothing', () => {
  it('flags the loose scene when its story is otherwise ordered, not when nothing is ordered yet', () => {
    const ordered = new VaultBuilder().scene('a').scene('b').scene('c').chain('a', 'b').build();
    expect(rules(ordered)).toEqual(['floating:c']);
    const fresh = new VaultBuilder().scene('a').scene('b').scene('c').build();
    expect(rules(fresh)).toEqual([]);
  });
});

describe('the demo world', () => {
  it('has no continuity problems, so the panel starts out quiet for a writer who is doing nothing wrong', () => {
    expect(findProblems(createDemoVault()).map((p) => p.message)).toEqual([]);
  });
});
