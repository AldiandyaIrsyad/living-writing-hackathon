import { describe, expect, it } from 'vitest';
import { buildGraph } from '../../core/graph';
import { VaultBuilder } from '../../core/testkit';
import { insertColumn, insertScene, layoutTimeline } from '../../core/timeline';
import type { Vault } from '../../core/types';
import { buildTimelineModel, partTitle, targetForColumn } from './model';

/** a (col 0) → b (cols 1–3, stretched) → c (col 4), plus an empty-ish side story "m" with one scene after c. */
function stretched() {
  const v = new VaultBuilder().scene('a').scene('b').scene('c').scene('m1', undefined, 'm').chain('a', 'b', 'c', 'm1').span('b', 3).build();
  return { v, model: buildTimelineModel(v, buildGraph(v), []) };
}

function columns(v: Vault) {
  const out: Record<string, number> = {};
  for (const cell of layoutTimeline(v).cells) out[cell.sceneId] = cell.column;
  return out;
}

describe('targetForColumn', () => {
  it('a scene added in the middle of a stretched clip starts at that column and moves nothing else', () => {
    const { v, model } = stretched();
    const before = columns(v);
    expect(before).toMatchObject({ a: 0, b: 1, c: 4 });

    const target = targetForColumn(v, model, 2)!;
    const { vault, sceneId } = insertScene(v, { storyId: 'm', title: 'Mid' }, target.relation, target.sceneId);
    expect(columns(vault)).toEqual({ ...before, [sceneId]: 2 });
  });

  it('prefers a scene that starts in the column, then falls back to the clip that ended last', () => {
    const { v, model } = stretched();
    expect(targetForColumn(v, model, 4)).toEqual({ relation: 'same', sceneId: 'c' });
    // Past the end of everything: right after the last clip to finish.
    expect(targetForColumn(v, model, 9)).toEqual({ relation: 'after', sceneId: 'm1' });
  });

  it('a scene added in an empty column before everything goes right before the first scene, filling that column', () => {
    const { v } = stretched();
    const gapped = insertColumn(v, 0);
    const model = buildTimelineModel(gapped, buildGraph(gapped), []);
    const target = targetForColumn(gapped, model, 0)!;
    expect(target).toEqual({ relation: 'before', sceneId: 'a' });
    const { vault, sceneId } = insertScene(gapped, { storyId: 's', title: 'Prologue' }, target.relation, target.sceneId);
    expect(columns(vault)).toMatchObject({ [sceneId]: 0, a: 1, b: 2 });
  });

  it('never targets a scene that is being dragged', () => {
    const { v, model } = stretched();
    expect(targetForColumn(v, model, 2, ['b'])).toEqual({ relation: 'after', sceneId: 'a' });
  });
});

/** Chapter 1: a, b, (flashback f written later in time) — chapter 2: c in between. Reading: a b f in ch1, c in ch2. */
function withFlashback() {
  const b = new VaultBuilder().scene('a').scene('b').scene('c').scene('f').scene('d').chain('a', 'b', 'c', 'f', 'd');
  b.v.arcs.arc = { id: 'arc', storyId: 's', title: 'Arc', order: 0 };
  b.v.chapters.one = { id: 'one', storyId: 's', title: 'Chapter 1', order: 0, arcId: 'arc' };
  b.v.chapters.two = { id: 'two', storyId: 's', title: 'Chapter 2', order: 1 };
  for (const id of ['a', 'b', 'f']) b.v.scenes[id].chapterId = 'one';
  b.v.scenes.c.chapterId = 'two';
  b.v.scenes.d.chapterId = 'two';
  b.v.moments.m_b.label = 'Late autumn';
  return b.build();
}

describe('chapter parts', () => {
  it('a chapter with a scene written beyond another chapter is drawn as two connected parts, not one bar across both', () => {
    const v = withFlashback();
    const track = buildTimelineModel(v, buildGraph(v), []).tracks[0];
    const one = track.chapters.filter((c) => c.id === 'one').map((c) => [c.from, c.to, c.part, c.parts]);
    expect(one).toEqual([
      [0, 2, 0, 2],
      [3, 4, 1, 2],
    ]);
    expect(track.chapters.filter((c) => c.id === 'two').map((c) => [c.from, c.to, c.part, c.parts])).toEqual([[2, 3, 0, 2], [4, 5, 1, 2]]);
    // The arc is cut the same way: nothing of it is in column 2.
    expect(track.arcs.map((a) => [a.from, a.to])).toEqual([[0, 2], [3, 4]]);
  });

  it('marks only the sides that have more: a mark before from the second part on, after up to the one before the last', () => {
    expect([0, 1, 2].map((part) => partTitle({ part, parts: 3 }, 'Chapter 2'))).toEqual(['Chapter 2 ›', '‹ Chapter 2 ›', '‹ Chapter 2']);
    expect(partTitle({ part: 0, parts: 1 }, 'Chapter 2')).toBe('Chapter 2');
  });

  it('a chapter with an empty gap but no other work inside it stays one bar', () => {
    const b = new VaultBuilder().scene('a').scene('x', undefined, 'other').scene('y', undefined, 'other').scene('b').chain('a', 'x', 'y', 'b');
    b.v.chapters.one = { id: 'one', storyId: 's', title: 'Chapter 1', order: 0 };
    b.v.scenes.a.chapterId = 'one';
    b.v.scenes.b.chapterId = 'one';
    const v = b.build();
    const track = buildTimelineModel(v, buildGraph(v), []).tracks.find((t) => t.story.id === 's')!;
    expect(track.chapters.map((c) => [c.from, c.to, c.parts])).toEqual([[0, 4, 1]]);
  });
});

describe('moment labels', () => {
  it('lists each labelled column once, in column order', () => {
    const v = withFlashback();
    v.moments.m_f.label = 'Winter';
    expect(buildTimelineModel(v, buildGraph(v), []).labels).toEqual([
      { col: 1, text: 'Late autumn' },
      { col: 3, text: 'Winter' },
    ]);
  });
});
