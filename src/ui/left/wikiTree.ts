// The wiki panel's list as a tree: an entity sits under its parent, whatever the parent's type. Pure.

import type { Entity, Id } from '../../core/types';

export interface WikiRow {
  entity: Entity;
  depth: number;
  hasChildren: boolean;
  open: boolean;
  /** Unique per place in the tree: an entity with two parents appears under both. */
  key: string;
}

/**
 * The rows to draw, in order. `list` is what the panel shows (already filtered by type), sorted by name; `parentsOf`
 * says where each entity hangs. Children are listed only under parents in `expanded`. An entity whose parents are not
 * in the list is a root, and so is every member of a loop (bad data must never hide an entity). With `flat` (a text
 * filter is active) the tree is dropped and every match is a root row.
 */
export function wikiRows(list: Entity[], parentsOf: (id: Id) => Id[], expanded: ReadonlySet<Id>, flat: boolean): WikiRow[] {
  if (flat) return list.map((entity) => ({ entity, depth: 0, hasChildren: false, open: false, key: entity.id }));

  const shown = new Set(list.map((e) => e.id));
  const children = new Map<Id, Entity[]>();
  const roots: Entity[] = [];
  for (const e of list) {
    const parents = parentsOf(e.id).filter((p) => shown.has(p) && p !== e.id);
    if (parents.length === 0) roots.push(e);
    for (const p of parents) {
      let kids = children.get(p);
      if (!kids) children.set(p, (kids = []));
      kids.push(e);
    }
  }

  // Everything reachable from a root, ignoring what is folded: whatever is left is a loop and becomes a root.
  const reachable = new Set<Id>();
  const reach = (e: Entity) => {
    if (reachable.has(e.id)) return;
    reachable.add(e.id);
    for (const k of children.get(e.id) ?? []) reach(k);
  };
  for (const r of roots) reach(r);
  for (const e of list) {
    if (!reachable.has(e.id)) {
      roots.push(e);
      reach(e);
    }
  }

  const rows: WikiRow[] = [];
  const walk = (e: Entity, depth: number, path: string, above: ReadonlySet<Id>) => {
    const kids = (children.get(e.id) ?? []).filter((k) => !above.has(k.id));
    const open = expanded.has(e.id) && kids.length > 0;
    const key = path === '' ? e.id : `${path}/${e.id}`;
    rows.push({ entity: e, depth, hasChildren: kids.length > 0, open, key });
    if (!open) return;
    const next = new Set(above).add(e.id);
    for (const k of kids) walk(k, depth + 1, key, next);
  };
  for (const r of roots) walk(r, 0, '', new Set());
  return rows;
}

/** Ids to unfold so that `id` is visible: every ancestor of it that is in the list. */
export function ancestorsToOpen(id: Id, parentsOf: (id: Id) => Id[]): Id[] {
  const out = new Set<Id>();
  const queue = [id];
  while (queue.length) {
    for (const p of parentsOf(queue.shift()!)) {
      if (p !== id && !out.has(p)) {
        out.add(p);
        queue.push(p);
      }
    }
  }
  return [...out];
}
