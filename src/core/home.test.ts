import { describe, expect, it } from 'vitest';
import { buildStoryCards, recordVisit, type Visits } from './home';
import { VaultBuilder } from './testkit';

function twoStories() {
  const b = new VaultBuilder().scene('a1').scene('a2').scene('b1', undefined, 'other');
  b.v.stories.s.order = 0;
  b.v.stories.other.order = 1;
  return b.build();
}

describe('recordVisit', () => {
  it('keeps one visit per story and leaves the input untouched', () => {
    const before: Visits = { s: { sceneId: 'a1', at: 1 } };
    const after = recordVisit(before, { id: 'b1', storyId: 'other' }, 5);
    const again = recordVisit(after, { id: 'a2', storyId: 's' }, 9);
    expect(before).toEqual({ s: { sceneId: 'a1', at: 1 } });
    expect(again).toEqual({ s: { sceneId: 'a2', at: 9 }, other: { sceneId: 'b1', at: 5 } });
  });
});

describe('buildStoryCards', () => {
  it('puts the most recently opened story first, then unvisited ones in sidebar order', () => {
    const b = new VaultBuilder().scene('a1').scene('b1', undefined, 'second').scene('c1', undefined, 'third').scene('d1', undefined, 'fourth');
    b.v.stories.s.order = 0;
    b.v.stories.second.order = 1;
    b.v.stories.third.order = 2;
    b.v.stories.fourth.order = 3;
    const cards = buildStoryCards(b.build(), { third: { sceneId: 'c1', at: 10 }, fourth: { sceneId: 'd1', at: 20 } });
    expect(cards.map((c) => c.story.id)).toEqual(['fourth', 'third', 's', 'second']);
  });

  it('continues at the last opened scene, or the first scene in reading order when none was opened', () => {
    const v = twoStories();
    v.scenes.a1.order = 5; // told after a2, though created first
    v.scenes.a2.order = 1;
    const [opened, fresh] = buildStoryCards(v, { s: { sceneId: 'a1', at: 3 } });
    expect(opened.resume?.scene.id).toBe('a1');
    expect(fresh.resume?.scene.id).toBe('b1');
    const [unvisited] = buildStoryCards(v, {});
    expect(unvisited.resume?.scene.id).toBe('a2');
  });

  it('ignores a remembered scene that was deleted or moved to another story', () => {
    const v = twoStories();
    delete v.scenes.a1;
    v.scenes.a2.storyId = 'other';
    const cards = buildStoryCards(v, { s: { sceneId: 'a2', at: 7 }, other: { sceneId: 'gone', at: 8 } });
    const s = cards.find((c) => c.story.id === 's')!;
    expect(s.visitedAt).toBeNull();
    expect(s.resume).toBeNull();
    expect(cards.find((c) => c.story.id === 'other')!.visitedAt).toBeNull();
  });

  it('reports size, the resume chapter and an empty story without a continue target', () => {
    const b = new VaultBuilder().scene('a1');
    b.v.chapters.ch = { id: 'ch', storyId: 's', title: 'The Siege', order: 0 };
    b.v.scenes.a1.chapterId = 'ch';
    b.v.scenes.a1.prose = 'one two three';
    b.v.stories.empty = { id: 'empty', name: 'Empty', color: '#000', order: 9 };
    const [card, empty] = buildStoryCards(b.build(), {});
    expect(card).toMatchObject({ chapters: 1, scenes: 1, words: 3, resume: { chapterTitle: 'The Siege', words: 3 } });
    expect(empty).toMatchObject({ scenes: 0, chapters: 0, words: 0, resume: null });
  });
});
