import { describe, expect, it } from 'vitest';
import { buildGraph, MomentGraph } from './graph';
import { Resolver } from './resolve';
import { createDemoVault } from './seed';
import { VaultBuilder } from './testkit';
import { constrainScenes, layoutTimeline, moveScenes, setSceneSpan, type Relation } from './timeline';
import type { Vault } from './types';

const mom = (v: Vault, scene: string) => v.scenes[scene].momentId;
const colOf = (v: Vault, scene: string) => layoutTimeline(v).cells.find((c) => c.sceneId === scene)!.column;
const spanOf = (v: Vault, scene: string) => layoutTimeline(v).cells.find((c) => c.sceneId === scene)!.span;

/** The demo world with The Stranger (sc_2, columns 1..) stretched over 3 columns. */
function strangerSpan3(): Vault {
  return setSceneSpan(createDemoVault(), 'sc_2', 3);
}

function place(v: Vault, scene: string, relation: Relation, target: string): Vault {
  const res = moveScenes(v, [scene], relation, target);
  if (!res.ok) throw new Error(res.error);
  return res.vault;
}

describe('the demo with a stretched main-story scene', () => {
  it('stretching The Stranger keeps its start column and pushes what follows to its end', () => {
    const v = strangerSpan3();
    expect(colOf(v, 'sc_2')).toBe(1);
    expect(spanOf(v, 'sc_2')).toBe(3);
    // Mira's Road (Crossroads, Sword) still sits between The Stranger and The Betrayal in the demo: columns 4 and 5.
    expect(colOf(v, 'sc_m1')).toBe(4);
    expect(colOf(v, 'sc_m2')).toBe(5);
    expect(colOf(v, 'sc_3')).toBe(6);
    expect(buildGraph(v).cycle).toBeNull();
  });

  it.each([
    [0, 1],
    [1, 2],
    [2, 3],
  ])('dropping Crossroads during column %i of the stretched clip puts it at column %i', (k, column) => {
    const v = place(strangerSpan3(), 'sc_m1', { during: k }, 'sc_2');
    expect(colOf(v, 'sc_m1')).toBe(column);
    expect(colOf(v, 'sc_2')).toBe(1);
    const g = buildGraph(v);
    expect(g.layerOf(mom(v, 'sc_m1'))).toBe(1 + k);
    // A side story inside a clip is not before or after it.
    expect(g.isBefore(mom(v, 'sc_2'), mom(v, 'sc_m1'))).toBe(false);
    expect(g.isBefore(mom(v, 'sc_m1'), mom(v, 'sc_2'))).toBe(false);
    expect(g.cycle).toBeNull();
  });

  it('dropping after the stretched clip lands at its start column plus its span', () => {
    const v = place(strangerSpan3(), 'sc_m1', 'after', 'sc_2');
    expect(colOf(v, 'sc_m1')).toBe(1 + 3);
    expect(colOf(v, 'sc_2') + spanOf(v, 'sc_2')).toBe(colOf(v, 'sc_m1'));
    expect(buildGraph(v).isBefore(mom(v, 'sc_2'), mom(v, 'sc_m1'))).toBe(true);
    expect(buildGraph(v).cycle).toBeNull();
  });

  it('dropping before the stretched clip puts the dropped scene in the column the clip started in', () => {
    const v = place(strangerSpan3(), 'sc_m1', 'before', 'sc_2');
    expect(colOf(v, 'sc_m1')).toBe(1);
    expect(colOf(v, 'sc_2')).toBe(2);
    expect(buildGraph(v).isBefore(mom(v, 'sc_m1'), mom(v, 'sc_2'))).toBe(true);
  });

  it('two Mira\'s Road scenes at the start and the end of the stretched clip leave its middle empty', () => {
    const first = place(strangerSpan3(), 'sc_m1', { during: 0 }, 'sc_2');
    const v = place(first, 'sc_m2', { during: 2 }, 'sc_2');
    expect(colOf(v, 'sc_m1')).toBe(1);
    expect(colOf(v, 'sc_m2')).toBe(3);
    expect(colOf(v, 'sc_2')).toBe(1);
    // Nothing of Mira's Road sits in the middle column (2), and the main story still continues after the span.
    const midColumn = layoutTimeline(v).cells.filter((c) => c.column === 2).map((c) => c.sceneId);
    expect(midColumn).toEqual([]);
    expect(colOf(v, 'sc_3')).toBe(4);
    expect(buildGraph(v).cycle).toBeNull();
  });

  it('constrain mode with a during rule keeps the scene placed where the rule puts it, without moving others', () => {
    const v = strangerSpan3();
    const res = constrainScenes(v, ['sc_m1'], { during: 1 }, 'sc_2');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(buildGraph(res.vault).cycle).toBeNull();
    expect(colOf(res.vault, 'sc_2')).toBe(1);
  });
});

describe('isBefore across a during-edge', () => {
  it('a change wholly before a host is also wholly before the scenes placed during the host', () => {
    // Supper ends before The Stranger starts; a scene placed during the Stranger starts after Supper has ended.
    const v = new VaultBuilder().scene('a').scene('host').scene('guest').span('host', 3).chain('a', 'host').during('host', 'guest', 1).build();
    const g = buildGraph(v);
    expect(g.isBefore(mom(v, 'a'), mom(v, 'guest'))).toBe(true);
    expect(g.isBefore(mom(v, 'host'), mom(v, 'guest'))).toBe(false);
    expect(g.isBefore(mom(v, 'guest'), mom(v, 'a'))).toBe(false);
  });

  it('the host is not wholly before what is only during it, even when a later scene follows the guest', () => {
    const v = new VaultBuilder().scene('host').scene('guest').scene('late').span('host', 3).during('host', 'guest', 1).chain('guest', 'late').build();
    const g = buildGraph(v);
    expect(g.isBefore(mom(v, 'host'), mom(v, 'late'))).toBe(false);
  });

  it('a change applies to a scene placed during a later host', () => {
    const v = new VaultBuilder()
      .entity('norman', { status: 'alive' })
      .scene('a')
      .scene('host')
      .scene('guest')
      .span('host', 3)
      .chain('a', 'host')
      .during('host', 'guest', 1)
      .change('a', 'norman', 'status', 'dead')
      .build();
    const r = new Resolver(v);
    // Viewed at the guest scene (its own changes excluded), the change in "a" has already happened.
    expect(r.entityAt('norman', r.atScene('guest')).props.status.value).toBe('dead');
  });
});

describe('a clip placed on a stretched clip keeps the layout consistent', () => {
  it('a during target whose span is 1 behaves as "same time"', () => {
    const v = new VaultBuilder().scene('a').scene('b').chain('a', 'b').build();
    const res = moveScenes(v, ['b'], { during: 0 }, 'a');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(colOf(res.vault, 'b')).toBe(colOf(res.vault, 'a'));
  });

  it('moving the stretched clip itself keeps its span', () => {
    const v = strangerSpan3();
    const moved = place(v, 'sc_2', 'after', 'sc_3');
    expect(spanOf(moved, 'sc_2')).toBe(3);
    const g: MomentGraph = buildGraph(moved);
    expect(g.isBefore(mom(moved, 'sc_3'), mom(moved, 'sc_2'))).toBe(true);
  });
});
