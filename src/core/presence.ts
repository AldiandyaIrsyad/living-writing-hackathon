// Who is at a place: the entities whose `location` property, as of a point in time, names that place.
// A move whose order against another move is unknown leaves the entity "maybe" here (or maybe not).

import { findEntity } from './links';
import type { Resolver } from './resolve';
import { isLink, type Id, type PropValue, type TimePoint, type Vault } from './types';

export interface Presence {
  /** Entities whose resolved location is this place. */
  here: Id[];
  /** Entities that are here only if another move, ordered against this one in no known way, came first or last. */
  maybe: Id[];
  /** The part of `here` that another, unordered move would take elsewhere: the entity is resolved to two places at once. */
  contested: Id[];
}

const LOCATION = 'location';

function names(value: PropValue | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map((v) => (isLink(v) ? v.target : String(v))).filter((s) => s.trim() !== '');
}

/** Who is at `placeId` at `tp`, each list in name order. Entities that do not exist at `tp` are never anywhere. */
export function presenceAt(vault: Vault, resolver: Resolver, placeId: Id, tp: TimePoint): Presence {
  const here: { id: Id; name: string }[] = [];
  const maybe: { id: Id; name: string }[] = [];
  const contested: { id: Id; name: string }[] = [];
  for (const e of Object.values(vault.entities)) {
    if (e.id === placeId) continue;
    const state = resolver.entityAt(e.id, tp);
    if (!state.exists) continue;
    const key = Object.keys(state.props).find((k) => k.toLowerCase() === LOCATION);
    if (key === undefined) continue;
    const prop = state.props[key];
    const at = (value: PropValue | undefined) => names(value).some((n) => findEntity(vault, n)?.id === placeId);
    if (at(prop.value)) {
      here.push({ id: e.id, name: state.name });
      if (prop.ambiguous?.some((a) => !at(a.value))) contested.push({ id: e.id, name: state.name });
    }
    else if (prop.ambiguous?.some((a) => at(a.value))) maybe.push({ id: e.id, name: state.name });
  }
  const sorted = (xs: { id: Id; name: string }[]) => xs.sort((a, b) => a.name.localeCompare(b.name)).map((x) => x.id);
  return { here: sorted(here), maybe: sorted(maybe), contested: sorted(contested) };
}
