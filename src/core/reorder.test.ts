import { describe, expect, it } from 'vitest';
import { buildManuscript } from './manuscript';
import { moveChapterBeside, moveScene, moveSceneBeside, moveSceneToChapterEnd, moveStoryBeside } from './reorder';
import { VaultBuilder } from './testkit';
import type { Id, Vault } from './types';

/** Chapters A and B whose scenes are interleaved in the story's numbering: A = a1 a2 a3 (0, 2, 4), B = b1 b2 b3 (1, 3, 5). */
function world(): Vault {
  const b = new VaultBuilder();
  for (const id of ['a1', 'b1', 'a2', 'b2', 'a3', 'b3']) b.scene(id);
  const v = b.build();
  v.chapters.A = { id: 'A', storyId: 's', title: 'A', order: 0 };
  v.chapters.B = { id: 'B', storyId: 's', title: 'B', order: 1 };
  for (const id of Object.keys(v.scenes)) v.scenes[id] = { ...v.scenes[id], chapterId: id.startsWith('a') ? 'A' : 'B' };
  return v;
}

/** What a reader gets: chapters in order, scenes in order within each. */
function reading(v: Vault): string[][] {
  return buildManuscript(v, { storyId: 's', chapterIds: null, sceneSeparator: 'none', chapterHeadings: true, keepNotes: false }).chapters.map((c) => c.scenes.map((s) => s.id));
}

describe('moveScene', () => {
  it.each([
    [0, ['a1', 'a2', 'a3']],
    [1, ['a2', 'a1', 'a3']],
    [2, ['a2', 'a3', 'a1']],
    [99, ['a2', 'a3', 'a1']],
    [-5, ['a1', 'a2', 'a3']],
  ])('puts the first scene of a chapter at position %i', (index, expected) => {
    const moved = moveScene(world(), 'a1', 'A', index);
    expect(reading(moved)[0]).toEqual(expected);
  });

  it('changes reading order only: the other chapter, the timeline and the scenes it passes keep their identity', () => {
    const v = world();
    const moved = moveScene(v, 'a1', 'A', 2);
    expect(moved.moments).toBe(v.moments);
    expect(moved.constraints).toBe(v.constraints);
    expect(moved.scenes.b1).toBe(v.scenes.b1);
    expect(v.scenes.a1.order).toBe(0); // the old vault is not changed, so undo restores it
  });

  it('is a no-op, returning the same vault, when the scene is already there', () => {
    const v = world();
    expect(moveScene(v, 'a2', 'A', 1)).toBe(v);
  });

  it('keeps every scene’s number distinct and the same set of numbers, however it is moved', () => {
    const v = world();
    const numbers = (x: Vault) => Object.values(x.scenes).map((s) => s.order).sort((a, b) => a - b);
    const ids = Object.keys(v.scenes);
    for (const id of ids) {
      for (const target of ids) {
        for (const side of ['before', 'after'] as const) {
          const moved = moveSceneBeside(v, id, target, side);
          expect(numbers(moved)).toEqual(numbers(v));
        }
      }
    }
  });
});

describe('moveSceneBeside', () => {
  it('drops a scene before or after another, inside that scene’s chapter', () => {
    const before = reading(moveSceneBeside(world(), 'a1', 'b2', 'before'));
    expect(before).toEqual([['a2', 'a3'], ['b1', 'a1', 'b2', 'b3']]);
    const after = reading(moveSceneBeside(world(), 'a1', 'b3', 'after'));
    expect(after).toEqual([['a2', 'a3'], ['b1', 'b2', 'b3', 'a1']]);
  });

  it('moves within a chapter just before or after a neighbour', () => {
    expect(reading(moveSceneBeside(world(), 'a3', 'a1', 'before'))[0]).toEqual(['a3', 'a1', 'a2']);
    expect(reading(moveSceneBeside(world(), 'a1', 'a2', 'after'))[0]).toEqual(['a2', 'a1', 'a3']);
    expect(reading(moveSceneBeside(world(), 'a1', 'a2', 'before'))[0]).toEqual(['a1', 'a2', 'a3']);
  });

  it('ignores a drop on itself, a missing scene, and a scene of another story', () => {
    const v = world();
    v.scenes.x = { ...v.scenes.a1, id: 'x', storyId: 'other', order: 0 };
    expect(moveSceneBeside(v, 'a1', 'a1', 'after')).toBe(v);
    expect(moveSceneBeside(v, 'a1', 'nope', 'after')).toBe(v);
    expect(moveSceneBeside(v, 'a1', 'x', 'after')).toBe(v);
  });

  it('can empty a chapter and can put a scene among the ones without a chapter', () => {
    let v = world();
    v.scenes.l1 = { ...v.scenes.a1, id: 'l1', chapterId: null, order: 10 };
    v = moveSceneBeside(v, 'a1', 'l1', 'before');
    expect(v.scenes.a1.chapterId).toBeNull();
    expect(Math.min(...[v.scenes.a1.order, v.scenes.l1.order])).toBe(v.scenes.a1.order);
  });
});

describe('moveSceneToChapterEnd', () => {
  it('appends to a chapter, including an empty one', () => {
    const v = world();
    v.chapters.C = { id: 'C', storyId: 's', title: 'C', order: 2 };
    const moved = moveSceneToChapterEnd(moveSceneToChapterEnd(v, 'a1', 'C'), 'a2', 'C');
    expect(reading(moved)).toEqual([['a3'], ['b1', 'b2', 'b3'], ['a1', 'a2']]);
  });
});

describe('moveChapterBeside', () => {
  const chapters = (ids: Id[]): Vault => {
    const v = world();
    ids.forEach((id, i) => (v.chapters[id] = { id, storyId: 's', title: id, order: i }));
    for (const k of Object.keys(v.chapters)) if (!ids.includes(k)) delete v.chapters[k];
    return v;
  };
  const titles = (v: Vault) => buildManuscript(v, { storyId: 's', chapterIds: null, sceneSeparator: 'none', chapterHeadings: true, keepNotes: false }).chapters.map((c) => c.title);

  it('reorders chapters without touching scenes', () => {
    const v = chapters(['A', 'B', 'C']);
    const moved = moveChapterBeside(v, 'C', 'A', 'before');
    expect(titles(moved)).toEqual(['C', 'A', 'B']);
    expect(moved.scenes).toBe(v.scenes);
    expect(titles(moveChapterBeside(v, 'A', 'C', 'after'))).toEqual(['B', 'C', 'A']);
    expect(moveChapterBeside(v, 'B', 'A', 'after')).toBe(v);
  });

  it('takes the arc of the chapter it is dropped beside, and leaves it when dropped beside one with no arc', () => {
    const v = chapters(['A', 'B', 'C']);
    v.arcs.x = { id: 'x', storyId: 's', title: 'Act one', order: 0 };
    v.chapters.A = { ...v.chapters.A, arcId: 'x' };
    const into = moveChapterBeside(v, 'C', 'A', 'after');
    expect(into.chapters.C.arcId).toBe('x');
    const out = moveChapterBeside(into, 'C', 'B', 'after');
    expect(out.chapters.C).not.toHaveProperty('arcId');
  });
});

describe('moveStoryBeside', () => {
  const stories = (ids: Id[]): Vault => {
    const v = world();
    v.stories = {};
    ids.forEach((id, i) => (v.stories[id] = { id, name: id, color: '#888', order: i }));
    return v;
  };
  const listed = (v: Vault) => Object.values(v.stories).sort((a, b) => a.order - b.order).map((x) => x.id);

  it('puts a story before or after another, and leaves the scenes alone', () => {
    const v = stories(['A', 'B', 'C']);
    expect(listed(moveStoryBeside(v, 'A', 'C', 'after'))).toEqual(['B', 'C', 'A']);
    expect(listed(moveStoryBeside(v, 'C', 'A', 'before'))).toEqual(['C', 'A', 'B']);
    expect(moveStoryBeside(v, 'A', 'C', 'after').scenes).toBe(v.scenes);
  });

  it('is a no-op when the story is already there or dropped on itself', () => {
    const v = stories(['A', 'B', 'C']);
    expect(moveStoryBeside(v, 'B', 'A', 'after')).toBe(v);
    expect(moveStoryBeside(v, 'B', 'B', 'before')).toBe(v);
  });
});
