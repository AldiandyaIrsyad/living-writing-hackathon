// Reordering scenes and chapters in the outline. This changes reading order only: where a scene sits in the story is
// never touched, so story time (the timeline) stays exactly as it was.
//
// `order` numbers are shared by a whole story, but only the order inside one chapter (or arc) is ever read, so a move
// hands out the numbers the moved group already had. Everything outside the group keeps its object and its number.

import type { Chapter, Id, Scene, Story, Vault } from './types';

const byOrder = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

/**
 * Puts `moved` at `index` among `others` and gives the group's existing order numbers out again in the new sequence.
 * Returns the (id, order) pairs that changed.
 */
function reassign(others: readonly { id: Id; order: number }[], moved: { id: Id; order: number }, index: number): [Id, number][] {
  const slots = [...others, moved].map((x) => x.order).sort((a, b) => a - b);
  const seq = [...others];
  seq.splice(Math.max(0, Math.min(index, seq.length)), 0, moved);
  const changed: [Id, number][] = [];
  seq.forEach((x, i) => {
    if (x.order !== slots[i]) changed.push([x.id, slots[i]]);
  });
  return changed;
}

const scenesOf = (vault: Vault, storyId: Id, chapterId: Id | null) =>
  Object.values(vault.scenes)
    .filter((s) => s.storyId === storyId && s.chapterId === chapterId)
    .sort(byOrder);

/** Moves a scene to `index` (0 = first) in the given chapter, or among the scenes without a chapter. */
export function moveScene(vault: Vault, sceneId: Id, chapterId: Id | null, index: number): Vault {
  const scene = vault.scenes[sceneId];
  if (!scene) return vault;
  if (chapterId !== null && vault.chapters[chapterId]?.storyId !== scene.storyId) return vault;
  const others = scenesOf(vault, scene.storyId, chapterId).filter((s) => s.id !== sceneId);
  const changed = new Map(reassign(others, scene, index));
  const clearsSomeday = chapterId !== null && Boolean(scene.someday);
  if (changed.size === 0 && scene.chapterId === chapterId && !clearsSomeday) return vault;
  const scenes: Record<Id, Scene> = { ...vault.scenes };
  const updated: Scene = { ...scene, chapterId, order: changed.get(sceneId) ?? scene.order };
  if (clearsSomeday) delete updated.someday;
  scenes[sceneId] = updated;
  for (const [id, order] of changed) if (id !== sceneId) scenes[id] = { ...scenes[id], order };
  return { ...vault, scenes };
}

/** Moves a scene to just before or after another scene, joining that scene's chapter. */
export function moveSceneBeside(vault: Vault, sceneId: Id, targetId: Id, side: 'before' | 'after'): Vault {
  const scene = vault.scenes[sceneId];
  const target = vault.scenes[targetId];
  if (!scene || !target || sceneId === targetId || scene.storyId !== target.storyId) return vault;
  const others = scenesOf(vault, target.storyId, target.chapterId).filter((s) => s.id !== sceneId);
  return moveScene(vault, sceneId, target.chapterId, others.findIndex((s) => s.id === targetId) + (side === 'after' ? 1 : 0));
}

/** Moves a scene to the end of a chapter. */
export function moveSceneToChapterEnd(vault: Vault, sceneId: Id, chapterId: Id): Vault {
  const scene = vault.scenes[sceneId];
  if (!scene) return vault;
  return moveScene(vault, sceneId, chapterId, Infinity);
}

const chaptersOf = (vault: Vault, storyId: Id, arcId: Id | undefined) =>
  Object.values(vault.chapters)
    .filter((c) => c.storyId === storyId && c.arcId === arcId)
    .sort(byOrder);

/** Moves a chapter to just before or after another chapter, joining that chapter's arc. */
export function moveChapterBeside(vault: Vault, chapterId: Id, targetId: Id, side: 'before' | 'after'): Vault {
  const chapter = vault.chapters[chapterId];
  const target = vault.chapters[targetId];
  if (!chapter || !target || chapterId === targetId || chapter.storyId !== target.storyId) return vault;
  const others = chaptersOf(vault, target.storyId, target.arcId).filter((c) => c.id !== chapterId);
  const changed = new Map(reassign(others, chapter, others.findIndex((c) => c.id === targetId) + (side === 'after' ? 1 : 0)));
  if (changed.size === 0 && chapter.arcId === target.arcId) return vault;
  const chapters: Record<Id, Chapter> = { ...vault.chapters };
  const moved: Chapter = { ...chapter, order: changed.get(chapterId) ?? chapter.order };
  if (target.arcId === undefined) delete moved.arcId;
  else moved.arcId = target.arcId;
  chapters[chapterId] = moved;
  for (const [id, order] of changed) if (id !== chapterId) chapters[id] = { ...chapters[id], order };
  return { ...vault, chapters };
}

/** Moves a story's track to just before or after another story's, the order the timeline and the story picker list them in. */
export function moveStoryBeside(vault: Vault, storyId: Id, targetId: Id, side: 'before' | 'after'): Vault {
  const story = vault.stories[storyId];
  if (!story || !vault.stories[targetId] || storyId === targetId) return vault;
  const others = Object.values(vault.stories).filter((x) => x.id !== storyId).sort(byOrder);
  const changed = reassign(others, story, others.findIndex((x) => x.id === targetId) + (side === 'after' ? 1 : 0));
  if (changed.length === 0) return vault;
  const stories: Record<Id, Story> = { ...vault.stories };
  for (const [id, order] of changed) stories[id] = { ...stories[id], order };
  return { ...vault, stories };
}
