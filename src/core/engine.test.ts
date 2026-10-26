import { describe, expect, it } from 'vitest';
import { buildGraph, MomentGraph } from './graph';
import { Resolver } from './resolve';
import { VaultBuilder } from './testkit';
import { createDemoVault } from './seed';
import { addConstraint, constrainScenes, deleteScene, insertColumn, insertScene, removeColumn, layoutTimeline, moveScenes, removeConstraint, setSceneSpan } from './timeline';
import type { Vault } from './types';

const mom = (v: Vault, scene: string) => v.scenes[scene].momentId;

describe('MomentGraph', () => {
  it('computes transitive reachability', () => {
    const g = new MomentGraph(['a', 'b', 'c', 'd'], [
      { before: 'a', after: 'b' },
      { before: 'b', after: 'c' },
    ]);
    expect(g.isBefore('a', 'c')).toBe(true);
    expect(g.isBefore('c', 'a')).toBe(false);
    expect(g.isBefore('a', 'a')).toBe(false);
    expect(g.isUnordered('a', 'd')).toBe(true);
    expect(g.isUnordered('a', 'a')).toBe(false);
    expect(g.cycle).toBeNull();
  });

  it('layers by longest path so simultaneous/parallel moments share columns', () => {
    const g = new MomentGraph(['a', 'b', 'c', 'x'], [
      { before: 'a', after: 'b' },
      { before: 'b', after: 'c' },
      { before: 'a', after: 'x' },
      { before: 'x', after: 'c' },
    ]);
    expect(g.layerOf('a')).toBe(0);
    expect(g.layerOf('b')).toBe(1);
    expect(g.layerOf('x')).toBe(1);
    expect(g.layerOf('c')).toBe(2);
    expect(g.columns).toBe(3);
  });

  it('produces a deterministic topological order', () => {
    const edges = [
      { before: 'z', after: 'y' },
      { before: 'b', after: 'a' },
    ];
    const g1 = new MomentGraph(['a', 'b', 'y', 'z'], edges);
    const g2 = new MomentGraph(['z', 'y', 'b', 'a'], [...edges].reverse());
    expect(g1.order).toEqual(g2.order);
    expect(g1.topoIndex('b')).toBeLessThan(g1.topoIndex('a'));
    expect(g1.topoIndex('z')).toBeLessThan(g1.topoIndex('y'));
  });

  it('detects cycles and wouldCycle', () => {
    const g = new MomentGraph(['a', 'b'], [{ before: 'a', after: 'b' }]);
    expect(g.wouldCycle('b', 'a')).toBe(true);
    expect(g.wouldCycle('a', 'a')).toBe(true);
    expect(g.wouldCycle('a', 'b')).toBe(false);
    const bad = new MomentGraph(['a', 'b', 'c'], [
      { before: 'a', after: 'b' },
      { before: 'b', after: 'a' },
    ]);
    expect(bad.cycle?.sort()).toEqual(['a', 'b']);
  });

  it('ignores constraints to unknown moments and reports floating moments', () => {
    const g = new MomentGraph(['a', 'b', 'f'], [
      { before: 'a', after: 'b' },
      { before: 'a', after: 'ghost' },
    ]);
    expect(g.isFloating('f')).toBe(true);
    expect(g.isFloating('a')).toBe(false);
    expect(g.directSuccs('a')).toEqual(['b']);
    expect(g.directPreds('b')).toEqual(['a']);
  });

  it('handles > 32 moments (multi-word bitsets)', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `m${String(i).padStart(3, '0')}`);
    const edges = ids.slice(1).map((id, i) => ({ before: ids[i], after: id }));
    const g = new MomentGraph(ids, edges);
    expect(g.isBefore(ids[0], ids[99])).toBe(true);
    expect(g.isBefore(ids[70], ids[40])).toBe(false);
    expect(g.layerOf(ids[99])).toBe(99);
  });
});

describe('Resolver', () => {
  const world = () =>
    new VaultBuilder()
      .entity('norman', { status: 'alive' })
      .scene('s1')
      .scene('s2')
      .scene('s3')
      .chain('s1', 's2', 's3')
      .change('s3', 'norman', 'status', 'dead');

  it('applies only changes strictly before the moment', () => {
    const v = world().build();
    const r = new Resolver(v);
    expect(r.entityAt('norman', r.atScene('s1')).props.status.value).toBe('alive');
    expect(r.entityAt('norman', r.atScene('s3')).props.status.value).toBe('alive');
    expect(r.entityAt('norman', r.atScene('s3', true)).props.status.value).toBe('dead');
    expect(r.entityAt('norman', { kind: 'latest' }).props.status.value).toBe('dead');
    expect(r.entityAt('norman', { kind: 'latest' }).props.status.sceneId).toBe('s3');
  });

  it('lists unordered and simultaneous changes without applying them', () => {
    const v = world().scene('side').scene('twin', mom(world().build(), 's2')).change('side', 'norman', 'mood', 'sad').change('twin', 'norman', 'mood', 'happy').build();
    const r = new Resolver(v);
    const at2 = r.entityAt('norman', r.atScene('s2'));
    expect(at2.props.mood).toBeUndefined();
    expect(at2.unordered.map((c) => c.sceneId).sort()).toEqual(['side', 'twin']);
  });

  it('marks ambiguous values from unordered changes', () => {
    const v = world().scene('side').change('side', 'norman', 'status', 'missing').build();
    const r = new Resolver(v);
    const latest = r.entityAt('norman', { kind: 'latest' }).props.status;
    expect(latest.ambiguous).toHaveLength(1);
    expect([latest.value, latest.ambiguous![0].value].sort()).toEqual(['dead', 'missing']);
  });

  it('is not ambiguous when the changes are ordered', () => {
    const v = world().change('s2', 'norman', 'status', 'wounded').build();
    const r = new Resolver(v);
    const latest = r.entityAt('norman', { kind: 'latest' }).props.status;
    expect(latest.value).toBe('dead');
    expect(latest.ambiguous).toBeUndefined();
  });

  it('supports remove, list add/removeItem, create and retire', () => {
    const v = new VaultBuilder()
      .entity('e', { tags: ['a'], temp: 1 })
      .scene('s1')
      .scene('s2')
      .scene('s3')
      .chain('s1', 's2', 's3')
      .op('s1', 'e', 'create')
      .change('s1', 'e', 'tags', 'b', 'add')
      .change('s2', 'e', 'tags', 'a', 'removeItem')
      .change('s2', 'e', 'temp', '', 'remove')
      .op('s3', 'e', 'retire')
      .build();
    const r = new Resolver(v);
    expect(r.entityAt('e', r.atScene('s1')).exists).toBe(false);
    const after1 = r.entityAt('e', r.atScene('s1', true));
    expect(after1.exists).toBe(true);
    expect(after1.props.tags.value).toEqual(['a', 'b']);
    const at3 = r.entityAt('e', r.atScene('s3'));
    expect(at3.props.tags.value).toEqual(['b']);
    expect(at3.props.temp).toBeUndefined();
    expect(at3.exists).toBe(true);
    expect(r.entityAt('e', { kind: 'latest' }).exists).toBe(false);
  });

  it('produces history with before/after values', () => {
    const v = world().change('s2', 'norman', 'status', 'wounded').build();
    const h = new Resolver(v).history('norman');
    expect(h.map((e) => [e.change.sceneId, e.before, e.after])).toEqual([
      ['s2', 'alive', 'wounded'],
      ['s3', 'wounded', 'dead'],
    ]);
  });
});

describe('timeline operations', () => {
  const base = () =>
    new VaultBuilder()
      .entity('sword', {})
      .scene('c1')
      .scene('c2')
      .scene('c3')
      .scene('c4')
      .scene('c5')
      .scene('m1', undefined, 'side')
      .scene('m2', undefined, 'side')
      .chain('c1', 'c2', 'c3', 'c4', 'c5')
      .chain('c2', 'm1', 'm2', 'c3')
      .change('m2', 'sword', 'owner', 'mira')
      .build();

  it('moving a side story after the last chapter changes resolved state', () => {
    const v = base();
    expect(new Resolver(v).entityAt('sword', new Resolver(v).atScene('c4')).props.owner?.value).toBe('mira');
    const res = moveScenes(v, ['m1', 'm2'], 'after', 'c5');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const r = new Resolver(res.vault);
    expect(r.entityAt('sword', r.atScene('c4')).props.owner).toBeUndefined();
    expect(r.graph.isBefore(mom(res.vault, 'c5'), mom(res.vault, 'm1'))).toBe(true);
    expect(r.graph.isBefore(mom(res.vault, 'm1'), mom(res.vault, 'm2'))).toBe(true);
    // Main story order kept even though the side story was bridging c2 → c3.
    expect(r.graph.isBefore(mom(res.vault, 'c2'), mom(res.vault, 'c3'))).toBe(true);
    expect(r.entityAt('sword', { kind: 'latest' }).props.owner.value).toBe('mira');
  });

  it('move before inserts right before the target', () => {
    const res = moveScenes(base(), ['c5'], 'before', 'c2');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const g = buildGraph(res.vault);
    const v = res.vault;
    expect(g.isBefore(mom(v, 'c1'), mom(v, 'c5'))).toBe(true);
    expect(g.isBefore(mom(v, 'c5'), mom(v, 'c2'))).toBe(true);
    expect(g.isBefore(mom(v, 'c4'), mom(v, 'c5'))).toBe(false);
    expect(Object.keys(v.moments)).toHaveLength(7);
  });

  it('same-time places scenes in one column', () => {
    const res = moveScenes(base(), ['m1'], 'same', 'c4');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const layout = layoutTimeline(res.vault);
    const col = (id: string) => layout.cells.find((c) => c.sceneId === id)!.column;
    expect(res.vault.scenes.m1.momentId).toBe(res.vault.scenes.c4.momentId);
    expect(col('m1')).toBe(col('c4'));
  });

  it('rejects placing a scene relative to itself', () => {
    expect(moveScenes(base(), ['c1'], 'after', 'c1').ok).toBe(false);
  });

  it('constrain mode rejects time loops and leaves the vault unchanged', () => {
    const v = base();
    const res = constrainScenes(v, ['c1'], 'after', 'c5');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/time loop/);
    expect(buildGraph(v).cycle).toBeNull();
    expect(constrainScenes(v, ['c1'], 'same', 'c3').ok).toBe(false);
  });

  it('constrain mode adds rules without detaching', () => {
    const v = new VaultBuilder().scene('a').scene('b').scene('x').chain('a', 'b').build();
    const res = constrainScenes(v, ['x'], 'after', 'a');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const g = buildGraph(res.vault);
    expect(g.isBefore(mom(v, 'a'), mom(v, 'x'))).toBe(true);
    expect(g.isUnordered(mom(v, 'b'), mom(v, 'x'))).toBe(true);
    const same = constrainScenes(res.vault, ['b'], 'same', 'x');
    expect(same.ok).toBe(true);
    if (same.ok) expect(same.vault.scenes.b.momentId).toBe(same.vault.scenes.x.momentId);
  });

  it('add/remove constraint', () => {
    const v = new VaultBuilder().scene('a').scene('b').build();
    const res = addConstraint(v, mom(v, 'a'), mom(v, 'b'));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(addConstraint(res.vault, mom(v, 'b'), mom(v, 'a')).ok).toBe(false);
    const id = Object.keys(res.vault.constraints)[0];
    expect(Object.keys(removeConstraint(res.vault, id).constraints)).toHaveLength(0);
  });

  it('insert scene after a target and at the same time', () => {
    const v = base();
    const { vault, sceneId } = insertScene(v, { storyId: 'side', title: 'New' }, 'after', 'c3');
    const g = buildGraph(vault);
    expect(g.isBefore(mom(vault, 'c3'), mom(vault, sceneId))).toBe(true);
    expect(g.isBefore(mom(vault, sceneId), mom(vault, 'c4'))).toBe(true);
    expect(vault.scenes[sceneId].order).toBe(v.scenes.m2.order + 1);
    const same = insertScene(v, { storyId: 's', title: 'Twin' }, 'same', 'c2');
    expect(same.vault.scenes[same.sceneId].momentId).toBe(mom(v, 'c2'));
    const floating = insertScene(v, { storyId: 's', title: 'Float' }, null, null);
    const layout = layoutTimeline(floating.vault);
    expect(layout.cells.find((c) => c.sceneId === floating.sceneId)?.floating).toBe(true);
  });

  it('delete scene bridges the order and removes its changes', () => {
    const v = deleteScene(base(), 'c3');
    const g = buildGraph(v);
    expect(g.isBefore(mom(v, 'c2'), mom(v, 'c4'))).toBe(true);
    expect(g.isBefore(mom(v, 'm2'), mom(v, 'c4'))).toBe(true);
    const w = deleteScene(base(), 'm2');
    expect(Object.values(w.changes)).toHaveLength(0);
  });

  it('does not mutate the input vault', () => {
    const v = base();
    const snapshot = JSON.stringify(v);
    moveScenes(v, ['m1', 'm2'], 'after', 'c5');
    constrainScenes(v, ['c1'], 'after', 'c5');
    insertScene(v, { storyId: 's', title: 'x' }, 'before', 'c1');
    deleteScene(v, 'c2');
    expect(JSON.stringify(v)).toBe(snapshot);
  });
});

describe('playhead positions', () => {
  it('applies changes of clips that end at or before x', () => {
    const v = new VaultBuilder()
      .entity('norman', { status: 'alive' })
      .scene('s1')
      .scene('s2')
      .scene('s3')
      .chain('s1', 's2', 's3')
      .change('s3', 'norman', 'status', 'dead')
      .build();
    const r = new Resolver(v);
    expect(r.entityAt('norman', { kind: 'position', x: 2 }).props.status.value).toBe('alive');
    expect(r.entityAt('norman', { kind: 'position', x: 2.5 }).props.status.value).toBe('alive');
    expect(r.entityAt('norman', { kind: 'position', x: 3 }).props.status.value).toBe('dead');
    expect(r.entityAt('norman', r.atClip('s3', 'start')).props.status.value).toBe('alive');
    expect(r.entityAt('norman', r.atClip('s3', 'end')).props.status.value).toBe('dead');
  });
});

describe('note commits (message only)', () => {
  const plainWorld = () =>
    new VaultBuilder()
      .entity('norman', { status: 'alive' })
      .scene('s1')
      .scene('s2')
      .scene('s3')
      .chain('s1', 's2', 's3')
      .change('s3', 'norman', 'status', 'dead')
      .build();

  /** The same world plus a note-only commit in s2. */
  const notedWorld = (): Vault => {
    const v = plainWorld();
    v.changes.note_s2 = {
      id: 'note_s2',
      sceneId: 's2',
      entityId: 'norman',
      op: 'note',
      order: 0,
      message: 'Falls defending the inn',
    };
    return v;
  };

  it('appears in applied changes once its scene is before the viewed moment, with no props change', () => {
    const plain = new Resolver(plainWorld());
    const noted = new Resolver(notedWorld());
    const at3 = noted.entityAt('norman', noted.atScene('s3'));
    expect(at3.applied.map((c) => c.id)).toEqual(['note_s2']);
    expect(at3.props).toStrictEqual(plain.entityAt('norman', plain.atScene('s3')).props);
    expect(Object.keys(at3.props)).toEqual(['status']);
    expect(at3.props.status.value).toBe('alive');
    expect(at3.props.status.changeId).toBeNull();

    const latest = noted.entityAt('norman', { kind: 'latest' });
    expect(latest.applied.map((c) => c.id)).toEqual(['note_s2', expect.any(String)]);
    expect(latest.props).toStrictEqual(plain.entityAt('norman', { kind: 'latest' }).props);
    expect(latest.props.status.value).toBe('dead');
    expect(latest.props.status.ambiguous).toBeUndefined();
  });

  it('is listed as unordered for its own scene, not applied', () => {
    const noted = new Resolver(notedWorld());
    const atS2 = noted.entityAt('norman', noted.atScene('s2'));
    expect(atS2.applied).toEqual([]);
    expect(atS2.unordered.map((c) => c.id)).toEqual(['note_s2']);
    expect(atS2.props.status.value).toBe('alive');
  });

  it('shows in the history with no before or after value', () => {
    const plain = new Resolver(plainWorld()).history('norman');
    const h = new Resolver(notedWorld()).history('norman');
    expect(h.map((e) => e.change.op)).toEqual(['note', 'set']);
    const note = h[0];
    expect(note.change.message).toBe('Falls defending the inn');
    expect(note.before).toBeUndefined();
    expect(note.after).toBeUndefined();
    expect(note.existsBefore).toBe(true);
    expect(note.existsAfter).toBe(true);
    // The structured change is unaffected by the note that precedes it.
    expect(h[1].before).toBe('alive');
    expect(h[1].after).toBe('dead');
    expect(h[1]).toStrictEqual(plain[0]);
  });
});

describe('spans and during placement', () => {
  it('a stretched clip covers its span, and the next clip starts where it ends', () => {
    const v = new VaultBuilder().scene('chapter').scene('next').span('chapter', 3).chain('chapter', 'next').build();
    const g = buildGraph(v);
    expect(g.spanOf(mom(v, 'chapter'))).toBe(3);
    expect(g.endOf(mom(v, 'chapter'))).toBe(3);
    expect(g.layerOf(mom(v, 'next'))).toBe(3);
    expect(g.columns).toBe(4);
    const layout = layoutTimeline(v);
    expect(layout.columns).toBe(4);
    expect(layout.cells.find((c) => c.sceneId === 'chapter')).toMatchObject({ column: 0, span: 3 });
    expect(layout.cells.find((c) => c.sceneId === 'next')).toMatchObject({ column: 3, span: 1 });
  });

  it('a moment takes the largest span of the scenes at it', () => {
    const v = new VaultBuilder().scene('x').scene('y', 'm_x').span('y', 2).build();
    expect(buildGraph(v).spanOf('m_x')).toBe(2);
  });

  it('a during-edge places the clip inside the host without making it "before"', () => {
    const v = new VaultBuilder().scene('chapter').scene('side').span('chapter', 3).during('chapter', 'side', 2).build();
    const g = buildGraph(v);
    expect(g.layerOf(mom(v, 'side'))).toBe(2);
    expect(g.isBefore(mom(v, 'chapter'), mom(v, 'side'))).toBe(false);
    expect(g.isBefore(mom(v, 'side'), mom(v, 'chapter'))).toBe(false);
    expect(g.isUnordered(mom(v, 'chapter'), mom(v, 'side'))).toBe(true);
    // ...but it is still an ordering: the host cannot come after what is during it.
    expect(g.wouldCycle(mom(v, 'side'), mom(v, 'chapter'))).toBe(true);
    expect(g.wouldCycle(mom(v, 'chapter'), mom(v, 'side'))).toBe(false);
  });

  it('an offset at or past the span of the host is an ordinary "after"', () => {
    const v = new VaultBuilder().scene('chapter').scene('late').span('chapter', 3).during('chapter', 'late', 3).build();
    const g = buildGraph(v);
    expect(g.layerOf(mom(v, 'late'))).toBe(3);
    expect(g.isBefore(mom(v, 'chapter'), mom(v, 'late'))).toBe(true);
  });

  it('layers take the longest path across during and plain edges', () => {
    // side starts 2 into chapter (span 3) and ends at 3; next starts after chapter ends (3) and is after side.
    const v = new VaultBuilder()
      .scene('chapter')
      .scene('side')
      .scene('next')
      .span('chapter', 3)
      .during('chapter', 'side', 2)
      .chain('chapter', 'next')
      .build();
    const g = buildGraph(v);
    expect(g.layerOf(mom(v, 'side'))).toBe(2);
    expect(g.layerOf(mom(v, 'next'))).toBe(3);
    expect(g.isBefore(mom(v, 'chapter'), mom(v, 'next'))).toBe(true);
  });

  it('playhead positions apply a change when its own clip ends', () => {
    const v = new VaultBuilder()
      .entity('norman', { status: 'alive' })
      .scene('chapter')
      .scene('side')
      .span('chapter', 3)
      .during('chapter', 'side', 2)
      .change('chapter', 'norman', 'status', 'dead')
      .change('side', 'norman', 'mood', 'uneasy')
      .build();
    const r = new Resolver(v);
    expect(r.clipEnd('chapter')).toBe(3);
    expect(r.entityAt('norman', { kind: 'position', x: 2.5 }).props.status.value).toBe('alive');
    expect(r.entityAt('norman', { kind: 'position', x: 3 }).props.status.value).toBe('dead');
    expect(r.entityAt('norman', { kind: 'position', x: 3 }).props.mood.value).toBe('uneasy');
  });

  it('a side story dropped during the later end of a stretched chapter sees the pre-chapter state', () => {
    const v = new VaultBuilder()
      .entity('norman', { status: 'alive' })
      .scene('c1')
      .scene('c2')
      .scene('side')
      .span('c2', 3)
      .chain('c1', 'c2')
      .during('c2', 'side', 2)
      .change('c2', 'norman', 'status', 'dead')
      .change('side', 'norman', 'mood', 'uneasy')
      .build();
    const r = new Resolver(v);
    // Side starts 2 columns into c2, while c2 has not ended: its change is not applied yet either.
    expect(r.entityAt('norman', { kind: 'position', x: 2 }).props.status.value).toBe('alive');
    expect(r.entityAt('norman', { kind: 'position', x: 2 }).props.mood).toBeUndefined();
    expect(r.entityAt('norman', { kind: 'position', x: 3 }).props.status.value).toBe('alive');
    expect(r.entityAt('norman', { kind: 'position', x: 4 }).props.status.value).toBe('dead');
    // Viewed as "entering" the side scene, c2 is not before it, so its change is only listed as unordered.
    const atSide = r.entityAt('norman', r.atScene('side'));
    expect(atSide.props.status.value).toBe('alive');
    expect(atSide.unordered.map((c) => c.sceneId).sort()).toEqual(['c2', 'side']);
  });

  it('setSceneSpan sets the span, removes the key at 1, and keeps the order', () => {
    const v = new VaultBuilder().scene('a').scene('b').chain('a', 'b').build();
    const stretched = setSceneSpan(v, 'a', 3);
    expect(stretched.scenes.a.span).toBe(3);
    expect(v.scenes.a.span).toBeUndefined();
    expect(buildGraph(stretched).layerOf(mom(v, 'b'))).toBe(3);
    expect(buildGraph(stretched).isBefore(mom(v, 'a'), mom(v, 'b'))).toBe(true);
    expect(setSceneSpan(stretched, 'a', 1).scenes.a).not.toHaveProperty('span');
    expect(setSceneSpan(v, 'a', 0).scenes.a).not.toHaveProperty('span');
    expect(setSceneSpan(v, 'a', 2.6).scenes.a.span).toBe(3);
    expect(setSceneSpan(v, 'a', Number.NaN).scenes.a).not.toHaveProperty('span');
    expect(setSceneSpan(v, 'ghost', 4)).toBe(v);
  });

  it('setSceneSpan invalidates a previously built graph (new moments identity)', () => {
    const v = new VaultBuilder().scene('a').scene('b').chain('a', 'b').build();
    const before = buildGraph(v);
    const after = buildGraph(setSceneSpan(v, 'a', 2));
    expect(before.layerOf(mom(v, 'b'))).toBe(1);
    expect(after.layerOf(mom(v, 'b'))).toBe(2);
  });

  it('moving a scene during a stretched one puts the next chapter after the stretched end', () => {
    const v = new VaultBuilder()
      .scene('c1')
      .scene('c2')
      .scene('c3')
      .scene('side')
      .span('c2', 3)
      .chain('c1', 'c2', 'c3')
      .build();
    const res = moveScenes(v, ['side'], { during: 1 }, 'c2');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const g = buildGraph(res.vault);
    expect(g.layerOf(mom(res.vault, 'side'))).toBe(2);
    expect(g.isBefore(mom(res.vault, 'c2'), mom(res.vault, 'side'))).toBe(false);
    // The side story ends inside c2, and nothing orders it against c3; c3 still waits for c2 to end.
    expect(g.isUnordered(mom(res.vault, 'side'), mom(res.vault, 'c3'))).toBe(true);
    expect(g.layerOf(mom(res.vault, 'c3'))).toBe(4);
  });

  it('constrain mode with a during rule adds the rule without detaching the scene', () => {
    const v = new VaultBuilder().scene('a').scene('b').scene('x').chain('a', 'b').build();
    const res = constrainScenes(v, ['x'], { during: 0 }, 'a');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const g = buildGraph(res.vault);
    expect(g.layerOf(mom(v, 'x'))).toBe(0);
    expect(g.isUnordered(mom(v, 'a'), mom(v, 'x'))).toBe(true);
    expect(g.isBefore(mom(v, 'b'), mom(v, 'x'))).toBe(false);
  });

  it('rejects a during rule that closes a time loop', () => {
    const v = new VaultBuilder().scene('a').scene('b').chain('a', 'b').build();
    const res = constrainScenes(v, ['a'], { during: 0 }, 'b');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/time loop/);
    expect(buildGraph(v).cycle).toBeNull();
  });

  it('insert scene during a target places the new clip inside it', () => {
    const v = new VaultBuilder().scene('a').scene('b').span('a', 4).chain('a', 'b').build();
    const { vault, sceneId } = insertScene(v, { storyId: 's', title: 'Inside' }, { during: 1 }, 'a');
    const g = buildGraph(vault);
    expect(g.layerOf(mom(vault, sceneId))).toBe(1);
    expect(g.isBefore(mom(vault, 'a'), mom(vault, sceneId))).toBe(false);
    expect(g.layerOf(mom(vault, 'b'))).toBe(4);
  });

  it('a graph built with a during-edge and a strict edge to the same moment takes the longer length', () => {
    const g = new MomentGraph(['a', 'b'], [
      { before: 'a', after: 'b', weight: 1, strict: false },
      { before: 'a', after: 'b', weight: 3, strict: true },
    ]);
    expect(g.layerOf('b')).toBe(3);
    expect(g.isBefore('a', 'b')).toBe(true);
  });
});

describe('insertColumn', () => {
  const extent = (v: Vault) => Object.fromEntries(layoutTimeline(v).cells.map((c) => [c.sceneId, [c.column, c.column + c.span]]));

  it('opens an empty column: everything from it on moves one right, in every story, and nothing before it moves', () => {
    const demo = createDemoVault();
    const before = extent(demo);
    const frozen = JSON.stringify(demo);
    const columns = layoutTimeline(demo).columns;
    for (let k = 0; k < columns; k++) {
      const after = extent(insertColumn(demo, k));
      for (const [id, [from, to]] of Object.entries(before)) {
        // A clip that straddles the cut grows by one instead of moving.
        expect(after[id], `scene ${id}, cut at ${k}`).toEqual([from + (from >= k ? 1 : 0), to + (to > k ? 1 : 0)]);
      }
    }
    expect(JSON.stringify(demo)).toBe(frozen);
  });

  it('keeps a scene inside a long one, and grows the long one when the cut falls inside it', () => {
    const v = new VaultBuilder().scene('a').scene('long').scene('inside').scene('after').chain('a', 'long', 'after').span('long', 4).during('long', 'inside', 2).build();
    expect(extent(v)).toMatchObject({ long: [1, 5], inside: [3, 4], after: [5, 6] });
    const next = insertColumn(v, 3);
    expect(extent(next)).toMatchObject({ a: [0, 1], long: [1, 6], inside: [4, 5], after: [6, 7] });
    expect(buildGraph(next).isBefore(mom(next, 'long'), mom(next, 'inside'))).toBe(false);
  });

  it('removeColumn closes the gap that insertColumn opened, wherever it was opened, and refuses a column that has a scene in it', () => {
    const demo = createDemoVault();
    const before = extent(demo);
    const columns = layoutTimeline(demo).columns;
    for (let k = 0; k < columns; k++) {
      expect(extent(removeColumn(insertColumn(demo, k), k)), `gap at ${k}`).toEqual(before);
      // Two gaps in a row: closing one leaves exactly one.
      const twice = insertColumn(insertColumn(demo, k), k);
      expect(extent(removeColumn(twice, k)), `two gaps at ${k}`).toEqual(extent(insertColumn(demo, k)));
    }
    const busy = Object.values(before)[0][0];
    expect(removeColumn(demo, busy)).toBe(demo);
    const long = new VaultBuilder().scene('a').scene('long').scene('z').chain('a', 'long', 'z').span('long', 3).build();
    expect(removeColumn(long, 2)).toBe(long);
  });

  it('leaves the vault alone past the end, and when nothing is placed in time to move', () => {
    const v = new VaultBuilder().scene('a').scene('b').chain('a', 'b').build();
    expect(insertColumn(v, 2)).toBe(v);
    const unplaced = new VaultBuilder().scene('a').scene('b').build();
    expect(insertColumn(unplaced, 0)).toBe(unplaced);
  });

  describe('at the very start (column 0)', () => {
    const chain = () => new VaultBuilder().scene('a').scene('b').scene('c').chain('a', 'b', 'c').build();

    it('opens an empty first column that a scene added before the first one then fills', () => {
      const gapped = insertColumn(chain(), 0);
      expect(extent(gapped)).toMatchObject({ a: [1, 2], b: [2, 3], c: [3, 4] });
      expect(layoutTimeline(gapped).columns).toBe(4);
      const filled = insertScene(gapped, { storyId: 's', title: 'Prologue' }, 'before', 'a');
      expect(extent(filled.vault)[filled.sceneId]).toEqual([0, 1]);
      expect(extent(filled.vault)).toMatchObject({ a: [1, 2], b: [2, 3] });
    });

    it('keeps shifting everything on each press, including a scene added inside the gap, and closes only empty columns', () => {
      let v = chain();
      for (let i = 0; i < 3; i++) v = insertColumn(v, 0);
      const prologue = insertScene(v, { storyId: 's', title: 'Prologue' }, 'before', 'a');
      v = insertColumn(prologue.vault, 0);
      expect(extent(v)).toMatchObject({ a: [4, 5], b: [5, 6], c: [6, 7] });
      expect(extent(v)[prologue.sceneId]).toEqual([1, 2]);
      v = removeColumn(v, 0);
      expect(extent(v)[prologue.sceneId]).toEqual([0, 1]);
      expect(extent(v)).toMatchObject({ a: [3, 4], c: [5, 6] });
      // Column 0 now holds the prologue, so it cannot close; the empty columns after it still can.
      expect(removeColumn(v, 0)).toBe(v);
      v = removeColumn(removeColumn(v, 1), 1);
      expect(extent(v)).toMatchObject({ a: [1, 2], c: [3, 4] });
    });

    it('leaves no trace once closed, and leaves scenes that are not placed in time where they are', () => {
      const base = insertScene(chain(), { storyId: 's', title: 'Loose' }, null, null);
      const gapped = insertColumn(base.vault, 0);
      expect(extent(gapped)[base.sceneId]).toEqual([0, 1]);
      const closed = removeColumn(gapped, 0);
      expect(Object.keys(closed.moments).sort()).toEqual(Object.keys(base.vault.moments).sort());
      expect(Object.keys(closed.constraints).length).toBe(Object.keys(base.vault.constraints).length);
    });
  });
});
