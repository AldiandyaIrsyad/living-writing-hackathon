// A list property whose values are links to other entities (affiliations, parent, siblings), edited the same way
// everywhere: in the entity's base properties, or as a commit after a scene or at a column of the timeline.

import { anchorFields, sameAnchor } from './anchor';
import { findEntity } from './links';
import { Resolver } from './resolve';
import type { Anchor, Entity, Id, LinkValue, Props, PropValue, ScalarValue, StateChange, TimePoint, Vault } from './types';
import { isLink, newId } from './types';

/** Where an edit takes effect: the base properties, after a scene, or at a column of the timeline. */
export type LinkWhere = { sceneId: Id; message?: string } | { at: number; message?: string } | 'base';

export type Lookup = (target: string) => Id | undefined;

export function byName(a: Entity, b: Entity): number {
  return a.name.localeCompare(b.name);
}

export function linksOf(value: PropValue | undefined): LinkValue[] {
  if (value === undefined) return [];
  const items: ScalarValue[] = Array.isArray(value) ? value : [value];
  return items.filter((x): x is LinkValue => isLink(x));
}

/** Entity ids named by a link value (a single link or a list); unresolved links are dropped. */
export function linkedIds(value: PropValue | undefined, lookup: Lookup): Id[] {
  const out: Id[] = [];
  for (const link of linksOf(value)) {
    const id = lookup(link.target);
    if (id !== undefined && !out.includes(id)) out.push(id);
  }
  return out;
}

/** A lookup that remembers its answers: findEntity scans the vault, and most entities have no links at all. */
export function memoLookup(vault: Vault): Lookup {
  const cache = new Map<string, Id | undefined>();
  return (target) => {
    if (!cache.has(target)) cache.set(target, findEntity(vault, target)?.id);
    return cache.get(target);
  };
}

/** Current list value as an array of scalars (empty for missing or blank values). */
export function listOf(value: PropValue | undefined): ScalarValue[] {
  if (value === undefined || value === '') return [];
  return Array.isArray(value) ? [...value] : [value];
}

/**
 * Adds or removes the link `entity → target` in the list property, in the base properties or as a commit.
 * `current(resolver, tp)` says who is linked at a point in time, so an edit that changes nothing there comes back
 * as the same vault. Pure.
 */
export function editLinkList(
  vault: Vault,
  entityId: Id,
  targetId: Id,
  property: string,
  where: LinkWhere,
  add: boolean,
  messages: { add: string; remove: string },
  current: (resolver: Resolver, tp: TimePoint) => Id[],
): Vault {
  const entity = vault.entities[entityId];
  const target = vault.entities[targetId];
  if (!entity || !target || entityId === targetId) return vault;
  const link: LinkValue = { kind: 'link', target: target.name };
  const isTarget = (x: ScalarValue): boolean => isLink(x) && findEntity(vault, x.target)?.id === targetId;

  if (where === 'base') {
    const items = listOf(entity.props[property]);
    if (items.some(isTarget) === add) return vault;
    const next: ScalarValue[] = add ? [...items, link] : items.filter((x) => !isTarget(x));
    const props: Props = { ...entity.props };
    if (next.length) props[property] = next;
    else delete props[property];
    return { ...vault, entities: { ...vault.entities, [entityId]: { ...entity, props } } };
  }

  // After a scene, or at a column of the timeline.
  const resolver = new Resolver(vault);
  const anchor: Anchor | null = 'at' in where ? { at: where.at } : vault.scenes[where.sceneId] ? { sceneId: where.sceneId } : null;
  if (!anchor) return vault;
  // Already so (or already not) once that has happened: nothing to commit.
  const tp: TimePoint = 'at' in anchor ? { kind: 'position', x: anchor.at } : resolver.atScene(anchor.sceneId, true);
  if (current(resolver, tp).includes(targetId) === add) return vault;

  const order = Math.max(-1, ...Object.values(vault.changes).filter((c) => sameAnchor(c, anchor)).map((c) => c.order)) + 1;
  const message = where.message?.trim() || (add ? messages.add : messages.remove).replace('{name}', target.name);
  const change: StateChange = {
    id: newId('chg'),
    ...anchorFields(anchor),
    entityId,
    op: add ? 'add' : 'removeItem',
    property,
    value: link,
    order,
    message,
  };
  return { ...vault, changes: { ...vault.changes, [change.id]: change } };
}
