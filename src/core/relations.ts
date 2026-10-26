// Relations between entities: parent / children, and siblings. Places hold places, organizations hold
// organizations, people have children: one mechanism, worded per type (EntityType.parentLabel / childrenLabel).
//
// Only one direction is stored. "B is a child of A" is the link `parent: [[A]]` on B, and A's children are found by
// looking for it, so a commit is a single change and the two sides can never disagree. Siblings come for free
// from a shared parent; an explicit `siblings` link (stored on either entity, read both ways) is for the ones that
// cannot be derived, and does not spread: A~B and B~C do not make A~C, and it never gives anyone a parent.
// Both properties are ordinary link lists, so they change over the story like affiliations do.

import { editLinkList, byName, linkedIds, memoLookup, type LinkWhere } from './linkList';
import { Resolver } from './resolve';
import type { Entity, Id, PropValue, TimePoint, Vault } from './types';

export const PARENT = 'parent';
export const SIBLINGS = 'siblings';

export type RelationWhere = LinkWhere;

export interface Relations {
  parents(id: Id): Id[];
  children(id: Id): Id[];
  /** Entities sharing a parent, plus explicit sibling links either way. Never includes `id`. */
  siblings(id: Id): Id[];
  /** Children, their children, and so on. */
  descendants(id: Id): Id[];
  /** Parents, their parents, and so on. */
  ancestors(id: Id): Id[];
}

function build(vault: Vault, valueOf: (e: Entity, property: string) => PropValue | undefined, exists: (e: Entity) => boolean): Relations {
  const lookup = memoLookup(vault);
  const parents = new Map<Id, Id[]>();
  const kids = new Map<Id, Set<Id>>();
  const explicit = new Map<Id, Set<Id>>();
  const grab = (map: Map<Id, Set<Id>>, id: Id) => {
    let set = map.get(id);
    if (!set) map.set(id, (set = new Set()));
    return set;
  };
  for (const e of Object.values(vault.entities)) {
    if (!exists(e)) continue;
    const ps = linkedIds(valueOf(e, PARENT), lookup).filter((id) => id !== e.id);
    parents.set(e.id, ps);
    for (const p of ps) grab(kids, p).add(e.id);
    for (const s of linkedIds(valueOf(e, SIBLINGS), lookup)) {
      if (s === e.id) continue;
      grab(explicit, e.id).add(s);
      grab(explicit, s).add(e.id);
    }
  }
  const sorted = (ids: Iterable<Id>): Id[] =>
    [...ids].filter((id) => vault.entities[id]).sort((a, b) => byName(vault.entities[a], vault.entities[b]));
  const walk = (start: Id, next: (id: Id) => Iterable<Id>): Id[] => {
    const seen = new Set<Id>();
    const queue = [start];
    while (queue.length) {
      for (const n of next(queue.shift()!)) {
        if (n !== start && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    return sorted(seen);
  };
  const childrenOf = (id: Id): Iterable<Id> => kids.get(id) ?? [];
  const parentsOf = (id: Id): Iterable<Id> => parents.get(id) ?? [];
  return {
    parents: (id) => [...parentsOf(id)].filter((p) => vault.entities[p]),
    children: (id) => sorted(childrenOf(id)),
    siblings(id) {
      const out = new Set<Id>(explicit.get(id) ?? []);
      for (const p of parentsOf(id)) for (const k of childrenOf(p)) out.add(k);
      out.delete(id);
      return sorted(out);
    },
    descendants: (id) => walk(id, childrenOf),
    ancestors: (id) => walk(id, parentsOf),
  };
}

/** The relations as they stand at a point in time. */
export function relationsAt(resolver: Resolver, tp: TimePoint): Relations {
  const states = new Map<Id, ReturnType<Resolver['entityAt']>>();
  const stateOf = (e: Entity) => {
    let s = states.get(e.id);
    if (!s) states.set(e.id, (s = resolver.entityAt(e.id, tp)));
    return s;
  };
  return build(resolver.vault, (e, property) => stateOf(e).props[property]?.value, (e) => stateOf(e).exists);
}

/** The relations in the entities' base properties, before any scene changes them. The wiki tree is drawn from this. */
export function baseRelations(vault: Vault): Relations {
  return build(vault, (e, property) => e.props[property], () => true);
}

function timeOf(resolver: Resolver, where: RelationWhere): TimePoint | null {
  if (where === 'base') return null;
  if ('at' in where) return { kind: 'position', x: where.at };
  return resolver.vault.scenes[where.sceneId] ? resolver.atScene(where.sceneId, true) : null;
}

/** The relations where an edit lands: the base properties, or the point a commit takes effect at. */
function relationsFor(vault: Vault, where: RelationWhere): Relations {
  if (where === 'base') return baseRelations(vault);
  const resolver = new Resolver(vault);
  const tp = timeOf(resolver, where);
  return tp ? relationsAt(resolver, tp) : baseRelations(vault);
}

/** Whether making `parentId` a parent of `childId` would put an entity above itself. */
export function wouldLoop(rel: Relations, childId: Id, parentId: Id): boolean {
  return childId === parentId || rel.descendants(childId).includes(parentId);
}

const PARENT_MESSAGES = { add: 'Child of {name}', remove: 'No longer a child of {name}' };
const SIBLING_MESSAGES = { add: 'Sibling of {name}', remove: 'No longer a sibling of {name}' };

/** Makes `parentId` a parent of `childId`. Comes back unchanged when it already is, or when it would loop. Pure. */
export function addParent(vault: Vault, childId: Id, parentId: Id, where: RelationWhere): Vault {
  if (wouldLoop(relationsFor(vault, where), childId, parentId)) return vault;
  return editLinkList(vault, childId, parentId, PARENT, where, true, PARENT_MESSAGES, (resolver, tp) => relationsAt(resolver, tp).parents(childId));
}

export function removeParent(vault: Vault, childId: Id, parentId: Id, where: RelationWhere): Vault {
  return editLinkList(vault, childId, parentId, PARENT, where, false, PARENT_MESSAGES, (resolver, tp) => relationsAt(resolver, tp).parents(childId));
}

/** Makes two entities siblings by an explicit link. Unchanged when they already are (e.g. by a shared parent). Pure. */
export function addSibling(vault: Vault, aId: Id, bId: Id, where: RelationWhere): Vault {
  if (relationsFor(vault, where).siblings(aId).includes(bId)) return vault;
  return editLinkList(vault, aId, bId, SIBLINGS, where, true, SIBLING_MESSAGES, (resolver, tp) => relationsAt(resolver, tp).siblings(aId));
}

/**
 * Takes an explicit sibling link away, whichever of the two entities holds it. Unchanged when the two are siblings
 * only through a shared parent (remove that parent link instead). Pure.
 */
export function removeSibling(vault: Vault, aId: Id, bId: Id, where: RelationWhere): Vault {
  const explicit = (holder: Id, other: Id) => (resolver: Resolver, tp: TimePoint) => {
    const state = resolver.entityAt(holder, tp);
    return state.exists ? linkedIds(state.props[SIBLINGS]?.value, memoLookup(resolver.vault)).filter((id) => id === other) : [];
  };
  const fromA = editLinkList(vault, aId, bId, SIBLINGS, where, false, SIBLING_MESSAGES, explicit(aId, bId));
  return fromA !== vault ? fromA : editLinkList(vault, bId, aId, SIBLINGS, where, false, SIBLING_MESSAGES, explicit(bId, aId));
}
