// What the home page shows: one card per story with a "continue here" scene. Pure data, no React.

import type { Id, Scene, Story, Vault } from './types';
import { storyWordCounts } from './wordcount';

/** The scene of a story the writer last opened, and when (epoch ms). */
export interface Visit {
  sceneId: Id;
  at: number;
}

export type Visits = Record<Id, Visit>;

/** Remembers `scene` as its story's last-opened scene. */
export function recordVisit(visits: Visits, scene: Pick<Scene, 'id' | 'storyId'>, at: number): Visits {
  return { ...visits, [scene.storyId]: { sceneId: scene.id, at } };
}

export interface StoryCard {
  story: Story;
  chapters: number;
  scenes: number;
  words: number;
  /** When the writer last opened a scene of this story; null when never (or that scene is gone). */
  visitedAt: number | null;
  /** Where "Continue" lands: the last opened scene, else the first in reading order. Null for an empty story. */
  resume: { scene: Scene; chapterTitle: string | null; words: number } | null;
}

/** One card per story: recently opened stories first (newest first), then the rest in sidebar order. */
export function buildStoryCards(vault: Vault, visits: Visits): StoryCard[] {
  const byStory = new Map<Id, Scene[]>();
  for (const scene of Object.values(vault.scenes)) {
    const list = byStory.get(scene.storyId);
    if (list) list.push(scene);
    else byStory.set(scene.storyId, [scene]);
  }
  const chapterCount = new Map<Id, number>();
  for (const c of Object.values(vault.chapters)) chapterCount.set(c.storyId, (chapterCount.get(c.storyId) ?? 0) + 1);

  const cards = Object.values(vault.stories).map((story): StoryCard => {
    const scenes = byStory.get(story.id) ?? [];
    const counts = storyWordCounts(vault, story.id);
    const visit = visits[story.id];
    const visited = visit ? vault.scenes[visit.sceneId] : undefined;
    const opened = visited?.storyId === story.id ? visited : undefined;
    const target = opened ?? scenes.reduce<Scene | undefined>((first, s) => (first === undefined || s.order < first.order ? s : first), undefined);
    const chapter = target?.chapterId ? vault.chapters[target.chapterId] : undefined;
    return {
      story,
      chapters: chapterCount.get(story.id) ?? 0,
      scenes: scenes.length,
      words: counts.total,
      visitedAt: opened && visit ? visit.at : null,
      resume: target ? { scene: target, chapterTitle: chapter ? chapter.title || 'Untitled chapter' : null, words: counts.byScene.get(target.id) ?? 0 } : null,
    };
  });

  return cards.sort((a, b) => {
    if (a.visitedAt !== null && b.visitedAt !== null) return b.visitedAt - a.visitedAt;
    if (a.visitedAt !== null) return -1;
    if (b.visitedAt !== null) return 1;
    return a.story.order - b.story.order;
  });
}
