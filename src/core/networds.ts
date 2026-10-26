// Net words written: the change in a scene's word count across an edit. Deleting and retyping the same sentence adds
// nothing, moving a paragraph adds nothing, and a huge paste (an imported draft) does not make a productive day.

import type { Vault } from './types';
import { countWords } from './wordcount';

/** More words than this arriving in one edit are a paste, not writing. */
export const PASTE_LIMIT = 500;

/** Most scenes one edit may change before it is treated as bulk work (an import, a replace-all). */
const BULK_SCENES = 3;

/** Words added (or, negative, removed) by turning one text into another, by the same counter the rest of the app uses. */
export function netWordsAdded(before: string, after: string): number {
  if (before === after) return 0;
  const delta = countWords(after) - countWords(before);
  return delta > PASTE_LIMIT ? 0 : delta;
}

/**
 * Net words written between two vaults: the sum over scenes whose prose changed. An edit that changes more than a few
 * scenes at once, or that brings scenes in or takes them out, is bulk work and counts for nothing.
 */
export function netWordsBetween(prev: Vault, next: Vault): number {
  if (prev.scenes === next.scenes) return 0;
  let changed = 0;
  let total = 0;
  let count = 0;
  for (const [id, scene] of Object.entries(next.scenes)) {
    count++;
    const old = prev.scenes[id];
    if (!old) return 0;
    if (old.prose === scene.prose) continue;
    if (++changed > BULK_SCENES) return 0;
    total += netWordsAdded(old.prose, scene.prose);
  }
  return count === Object.keys(prev.scenes).length ? total : 0;
}
