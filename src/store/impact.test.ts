import { describe, expect, it } from 'vitest';
import { moveScenes } from '../core/timeline';
import { VaultBuilder } from '../core/testkit';
import type { Id, Vault } from '../core/types';
import { deleteChange } from './actions';
import { describeDifference, describeImpact, impactOf, type Impact } from './impact';

/** Scenes s0..s4 in a row; `mentions` lists which scenes talk about norman. */
function story(mentions: number[], build: (b: VaultBuilder) => void = () => {}): Vault {
  const b = new VaultBuilder().entity('norman', { status: 'alive' }).entity('mira', { status: 'alive' });
  const ids = [0, 1, 2, 3, 4].map((i) => `s${i}`);
  for (const id of ids) b.scene(id);
  b.chain(...ids);
  build(b);
  const v = b.build();
  for (const i of mentions) v.scenes[`s${i}`] = { ...v.scenes[`s${i}`], prose: 'Then [[norman]] came in.' };
  return v;
}

const changeIn = (v: Vault, sceneId: Id) => Object.values(v.changes).find((c) => c.sceneId === sceneId)!.id;
const pairs = (v1: Vault, v2: Vault) => impactOf(v1, v2).map((i) => `${i.sceneId}:${i.entityId}`).sort();

describe('impactOf', () => {
  it('finds nothing when nothing changed', () => {
    const v = story([1, 2, 3], (b) => b.change('s1', 'norman', 'status', 'dead'));
    expect(impactOf(v, v)).toEqual([]);
  });

  it('after deleting a death, lists the later scenes that mention him, and no others', () => {
    const v = story([0, 2, 3], (b) => b.change('s1', 'norman', 'status', 'dead'));
    const after = deleteChange(v, changeIn(v, 's1'));
    const result = impactOf(v, after);
    // s0 is wholly before the death, s1 is where it happens (he enters it alive either way), s4 never mentions him.
    expect(result.map((i) => i.sceneId)).toEqual(['s2', 's3']);
    expect(result[0].differences).toEqual([{ kind: 'prop', property: 'status', before: 'dead', after: 'alive' }]);
  });

  it('only ever reaches forward in time: for a commit at any scene, exactly the mentioning scenes after it', () => {
    for (let k = 0; k < 5; k++) {
      const v = story([0, 1, 2, 3, 4], (b) => b.change(`s${k}`, 'norman', 'status', 'dead'));
      const after = deleteChange(v, changeIn(v, `s${k}`));
      expect(impactOf(v, after).map((i) => i.sceneId)).toEqual([0, 1, 2, 3, 4].filter((i) => i > k).map((i) => `s${i}`));
    }
  });

  it('reports nothing for an entity no scene mentions, however much it changes', () => {
    const v = story([1, 2], (b) => b.change('s0', 'mira', 'status', 'dead'));
    expect(impactOf(v, deleteChange(v, changeIn(v, 's0')))).toEqual([]);
  });

  it('reports a scene that moves past a commit, which changes what it sees', () => {
    const v = story([4], (b) => b.change('s1', 'norman', 'status', 'dead'));
    // Moving the death after the last scene means s4 no longer finds him dead.
    const moved = moveScenes(v, ['s1'], 'after', 's4');
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const result = impactOf(v, moved.vault);
    expect(result.map((i) => i.sceneId)).toEqual(['s4']);
    expect(result[0].differences).toEqual([{ kind: 'prop', property: 'status', before: 'dead', after: 'alive' }]);
  });

  it('is symmetric: the same scenes are affected going there and coming back', () => {
    const v = story([1, 2, 3, 4], (b) => b.change('s2', 'norman', 'status', 'dead'));
    const after = deleteChange(v, changeIn(v, 's2'));
    expect(pairs(v, after)).toEqual(pairs(after, v));
  });

  it('notices when unordered scenes stop disagreeing, even if the value shown stays the same', () => {
    // p and q are unordered; both set x; r comes after both and mentions norman.
    const b = new VaultBuilder().entity('norman', {}).scene('p').scene('q').scene('r').before('p', 'r').before('q', 'r');
    b.change('p', 'norman', 'x', 1).change('q', 'norman', 'x', 2);
    const v = b.build();
    v.scenes.r = { ...v.scenes.r, prose: '[[norman]]' };
    // q's value wins (it sorts last), so dropping p leaves the shown value alone and removes only the disagreement.
    const result = impactOf(v, deleteChange(v, changeIn(v, 'p')));
    expect(result.map((i) => i.sceneId)).toEqual(['r']);
    expect(result[0].differences.some((d) => d.kind === 'ambiguous' && d.before && !d.after)).toBe(true);
  });
});

describe('describeImpact', () => {
  const v = (() => {
    const b = new VaultBuilder();
    for (const [id, name] of [['a', 'Alice'], ['b', 'Bob'], ['c', 'Cara'], ['d', 'Dan'], ['e', 'Eve']]) b.entity(id, {}, name);
    return b.build();
  })();
  const hit = (sceneId: string, entityId: string): Impact => ({ sceneId, entityId, differences: [{ kind: 'page' }] });

  it('says nothing when nobody sees a difference', () => {
    expect(describeImpact(v, [])).toBeNull();
  });

  it('counts scenes, not pairs, and uses the singular for one', () => {
    expect(describeImpact(v, [hit('s1', 'a'), hit('s1', 'b')])).toBe('1 scene now sees something different about Alice, Bob.');
    expect(describeImpact(v, [hit('s1', 'a'), hit('s2', 'a')])).toBe('2 scenes now see something different about Alice.');
  });

  it('names the most affected first and caps the list', () => {
    const impacts = [hit('s1', 'e'), hit('s2', 'e'), hit('s1', 'd'), hit('s1', 'c'), hit('s1', 'b'), hit('s1', 'a')];
    expect(describeImpact(v, impacts)).toBe('2 scenes now see something different about Eve, Alice, Bob and 2 more.');
  });
});

describe('describeDifference', () => {
  it('reads each kind of difference as a short phrase', () => {
    expect(describeDifference({ kind: 'prop', property: 'status', before: 'dead', after: 'alive' })).toBe('status: dead → alive');
    expect(describeDifference({ kind: 'prop', property: 'owner', before: undefined, after: { kind: 'link', target: 'Mira' } })).toBe('owner: — → [[Mira]]');
    expect(describeDifference({ kind: 'exists', before: true, after: false })).toBe('no longer exists');
    expect(describeDifference({ kind: 'ambiguous', property: 'x', before: true, after: false })).toBe('x: order of changes now clear');
  });
});

describe('impactOf: empty values', () => {
  it('adding a property with no value is not something any scene sees', () => {
    const v = story([1, 2]);
    const after = { ...v, entities: { ...v.entities, norman: { ...v.entities.norman, props: { ...v.entities.norman.props, mood: '' } } } };
    expect(impactOf(v, after)).toEqual([]);
  });

  it('giving it a value afterwards is, for every scene that mentions him', () => {
    const v = story([1, 2]);
    const after = { ...v, entities: { ...v.entities, norman: { ...v.entities.norman, props: { ...v.entities.norman.props, mood: 'calm' } } } };
    expect(impactOf(v, after).map((i) => i.sceneId)).toEqual(['s1', 's2']);
  });
});
