// Which scene the Inspector describes. Pure, so the precedence can be tested without a browser.

import type { Id, Vault } from '../../core/types';

export type TargetSource = 'pinned' | 'writing' | 'playhead';

/**
 * A pin wins over everything, so a reference point stays put while the writer edits elsewhere. Without one the open
 * scene is described (and is editable); without that, the scene under the playhead. A pin whose scene no longer exists
 * is ignored rather than leaving the Inspector empty.
 */
export function chooseTarget(
  vault: Vault,
  pin: Id | null,
  openSceneId: Id | null,
  playheadSceneId: Id | null,
): { sceneId: Id; source: TargetSource } | null {
  if (pin !== null && vault.scenes[pin]) return { sceneId: pin, source: 'pinned' };
  if (openSceneId !== null && vault.scenes[openSceneId]) return { sceneId: openSceneId, source: 'writing' };
  if (playheadSceneId !== null && vault.scenes[playheadSceneId]) return { sceneId: playheadSceneId, source: 'playhead' };
  return null;
}

/** "Chapter 2 · The Ford": where a pinned Inspector is looking. */
export function pinLabel(vault: Vault, sceneId: Id): string {
  const scene = vault.scenes[sceneId];
  if (!scene) return '';
  const chapter = scene.chapterId ? vault.chapters[scene.chapterId]?.title : undefined;
  return [chapter, scene.title].filter(Boolean).join(' · ');
}
