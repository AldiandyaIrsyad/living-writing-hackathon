// Where an edit sits in time: after a scene (it moves with the scene), or at a column of the timeline (it stays).

import type { Anchor, Scene, StateChange, Vault } from './types';

/** The `sceneId` / `at` fields of a change for this anchor. */
export function anchorFields(a: Anchor): Pick<StateChange, 'sceneId' | 'at'> {
  return 'at' in a ? { at: a.at } : { sceneId: a.sceneId };
}

export function anchorOf(c: StateChange): Anchor | null {
  if (c.at !== undefined) return { at: c.at };
  return c.sceneId !== undefined ? { sceneId: c.sceneId } : null;
}

export function sameAnchor(c: StateChange, a: Anchor): boolean {
  return 'at' in a ? c.at === a.at : c.at === undefined && c.sceneId === a.sceneId;
}

/** "after column 4" (columns counted from 1): the timeline column a change takes effect after. */
export function atLabel(at: number): string {
  return at <= 0 ? 'from the start' : `after column ${at}`;
}

/** Where a change sits, in words: its scene's title, or its column on the timeline. */
export function changeWhere(vault: Vault, c: StateChange): string {
  if (c.at !== undefined) return atLabel(c.at);
  return (c.sceneId && vault.scenes[c.sceneId]?.title) || '?';
}

/** The scene a scene-anchored change belongs to; undefined for a change on the timeline. */
export function sceneOfChange(vault: Vault, c: StateChange): Scene | undefined {
  return c.at === undefined && c.sceneId ? vault.scenes[c.sceneId] : undefined;
}
