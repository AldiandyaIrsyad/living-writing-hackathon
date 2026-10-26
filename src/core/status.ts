// Scene status: idea, draft, revised, done. Pure edits and roll-ups.

import type { Id, SceneStatus, Vault } from './types';

export const STATUSES: readonly SceneStatus[] = ['idea', 'draft', 'revised', 'done'];

export const STATUS_LABELS: Record<SceneStatus, string> = { idea: 'Idea', draft: 'Draft', revised: 'Revised', done: 'Done' };

export function isStatus(v: unknown): v is SceneStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

/** Sets a scene's status; undefined clears it (no status at all, which is not the same as "idea"). */
export function setSceneStatus(vault: Vault, sceneId: Id, status: SceneStatus | undefined): Vault {
  const scene = vault.scenes[sceneId];
  if (!scene || scene.status === status) return vault;
  const { status: _old, ...rest } = scene;
  void _old;
  return { ...vault, scenes: { ...vault.scenes, [sceneId]: status === undefined ? rest : { ...rest, status } } };
}

export interface Rollup {
  done: number;
  total: number;
}

/** "7 of 9 done" for a chapter: every scene counts in the total, whether or not it has a status. */
export function chapterRollup(vault: Vault, chapterId: Id): Rollup {
  let done = 0;
  let total = 0;
  for (const s of Object.values(vault.scenes)) {
    if (s.chapterId !== chapterId) continue;
    total++;
    if (s.status === 'done') done++;
  }
  return { done, total };
}
