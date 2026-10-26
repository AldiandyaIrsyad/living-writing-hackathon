import { describe, expect, it } from 'vitest';
import { buildGraph } from '../core/graph';
import { VaultBuilder } from '../core/testkit';
import type { Vault } from '../core/types';
import { addChapterAfter, chapterForNewScene, chaptersOfStory } from './actions';

/** Story "s": chapter one holds a and b, chapter two holds c; one arc over both. */
function twoChapters(): Vault {
  const v = new VaultBuilder().scene('a').scene('b').scene('c').chain('a', 'b', 'c').build();
  v.arcs.arc = { id: 'arc', storyId: 's', title: 'Act I', order: 0 };
  v.chapters.one = { id: 'one', storyId: 's', title: 'Chapter 1', order: 0, arcId: 'arc' };
  v.chapters.two = { id: 'two', storyId: 's', title: 'Chapter 2', order: 1, arcId: 'arc' };
  v.scenes.a.chapterId = 'one';
  v.scenes.b.chapterId = 'one';
  v.scenes.c.chapterId = 'two';
  return v;
}

describe('a new chapter', () => {
  it('reads right after the chapter it follows, joins its arc, and opens with a scene after that chapter’s last', () => {
    const made = addChapterAfter(twoChapters(), 's', 'one', 'after', 'b');
    expect(chaptersOfStory(made.vault, 's').map((c) => c.id)).toEqual(['one', made.chapterId, 'two']);
    expect(made.vault.chapters[made.chapterId]).toMatchObject({ title: 'Chapter 3', arcId: 'arc' });
    const scene = made.vault.scenes[made.sceneId];
    expect(scene.chapterId).toBe(made.chapterId);
    const g = buildGraph(made.vault);
    expect(g.topoIndex(scene.momentId)).toBeGreaterThan(g.topoIndex(made.vault.scenes.b.momentId));
  });
});

describe('the chapter a new scene joins', () => {
  it('is the chapter of the scene beside it, else the story’s last chapter, else a new “Chapter 1”', () => {
    const v = twoChapters();
    expect(chapterForNewScene(v, 's', 'a').chapterId).toBe('one');
    v.scenes.b.chapterId = null;
    expect(chapterForNewScene(v, 's', 'b').chapterId).toBe('two');

    const bare = new VaultBuilder().scene('x').build();
    const made = chapterForNewScene(bare, 's', 'x');
    expect(made.vault.chapters[made.chapterId]).toMatchObject({ storyId: 's', title: 'Chapter 1' });
  });
});
