// Affiliations: which group entities (factions, guilds, families…) an entity belongs to, and when.
// Stored as the list property `affiliations` whose values are links to group entities. Base
// memberships live in the entity's props; joining or leaving in a scene is a state change
// (`add` / `removeItem` on `affiliations`), so memberships evolve like any other property.

import { findEntity } from './links';
import { byName, editLinkList, linkedIds, memoLookup, type LinkWhere, type Lookup } from './linkList';
import { Resolver } from './resolve';
import type { Entity, Id, TimePoint, Vault } from './types';

export const AFFILIATIONS = 'affiliations';

/** Where a join or leave takes effect: the base properties, after a scene, or at a column of the timeline. */
export type AffiliationWhere = LinkWhere;

function affiliationsWith(resolver: Resolver, entityId: Id, tp: TimePoint, lookup: Lookup): Id[] {
  const state = resolver.entityAt(entityId, tp);
  if (!state.exists) return [];
  return linkedIds(state.props[AFFILIATIONS]?.value, lookup);
}

/** Ids of the groups the entity belongs to at a point in time, in the stored order. */
export function affiliationsAt(resolver: Resolver, entityId: Id, tp: TimePoint): Id[] {
  return affiliationsWith(resolver, entityId, tp, (target) => findEntity(resolver.vault, target)?.id);
}

/** Every entity that is affiliated with the group at a point in time, sorted by name. */
export function membersAt(resolver: Resolver, groupId: Id, tp: TimePoint): Id[] {
  const lookup = memoLookup(resolver.vault);
  const members: Entity[] = [];
  for (const e of Object.values(resolver.vault.entities)) {
    if (affiliationsWith(resolver, e.id, tp, lookup).includes(groupId)) members.push(e);
  }
  return members.sort(byName).map((e) => e.id);
}

/** Entities that can be picked as a group: group-type entities first, then everything else. */
export function groupCandidates(vault: Vault): Entity[] {
  const groupTypes = new Set(Object.values(vault.entityTypes).filter((t) => t.group).map((t) => t.id));
  const all = Object.values(vault.entities).sort(byName);
  return [...all.filter((e) => groupTypes.has(e.typeId)), ...all.filter((e) => !groupTypes.has(e.typeId))];
}

/** Adds the entity to the group, in the base properties or as a commit in a scene. Pure. */
export function joinGroup(vault: Vault, entityId: Id, groupId: Id, where: AffiliationWhere): Vault {
  return editAffiliation(vault, entityId, groupId, where, true);
}

/** Removes the entity from the group, in the base properties or as a commit in a scene. Pure. */
export function leaveGroup(vault: Vault, entityId: Id, groupId: Id, where: AffiliationWhere): Vault {
  return editAffiliation(vault, entityId, groupId, where, false);
}

function editAffiliation(vault: Vault, entityId: Id, groupId: Id, where: AffiliationWhere, join: boolean): Vault {
  return editLinkList(
    vault,
    entityId,
    groupId,
    AFFILIATIONS,
    where,
    join,
    { add: 'Joins {name}', remove: 'Leaves {name}' },
    (resolver, tp) => affiliationsAt(resolver, entityId, tp),
  );
}
