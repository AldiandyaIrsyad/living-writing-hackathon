// The review list: scenes to look at again, and why. Pure edits over a vault.

import type { Id, ReviewItem, ReviewStatus, Vault } from './types';
import { newId } from './types';

/**
 * Adds an open item for each (scene, cause) not already open on the list. A pair that is already open is left alone, so
 * the same retcon flagged twice does not pile up; one the writer marked done or dismissed is added again, since the
 * cause has come back. Scenes that do not exist are skipped.
 */
export function addReviewItems(vault: Vault, items: readonly { sceneId: Id; cause: string }[], now = Date.now()): Vault {
  const open = new Set(Object.values(vault.reviewItems).filter((i) => i.status === 'open').map((i) => `${i.sceneId}\u0000${i.cause}`));
  let reviewItems = vault.reviewItems;
  for (const { sceneId, cause } of items) {
    const key = `${sceneId}\u0000${cause}`;
    if (!vault.scenes[sceneId] || open.has(key)) continue;
    open.add(key);
    const item: ReviewItem = { id: newId('review'), sceneId, cause, status: 'open', created: now };
    reviewItems = { ...reviewItems, [item.id]: item };
  }
  return reviewItems === vault.reviewItems ? vault : { ...vault, reviewItems };
}

export function setReviewStatus(vault: Vault, id: Id, status: ReviewStatus): Vault {
  const item = vault.reviewItems[id];
  if (!item || item.status === status) return vault;
  return { ...vault, reviewItems: { ...vault.reviewItems, [id]: { ...item, status } } };
}

/** Open items, oldest first. */
export function openReviewItems(vault: Vault): ReviewItem[] {
  return Object.values(vault.reviewItems)
    .filter((i) => i.status === 'open')
    .sort((a, b) => a.created - b.created);
}
