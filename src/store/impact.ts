// Retcon impact: what a change to the story makes different, and where the writer can see it.
//
// Resolve the world as it is and as it would be after a proposed edit (both are plain vaults, so any edit works: a
// deleted commit, a moved scene, a changed base property). An impact is a scene whose cast includes an entity that looks
// different entering that scene. Pure: nothing here touches the store.

import { memoLookup } from '../core/linkList';
import { parseLinks } from '../core/links';
import { Resolver, formatValue, valueEquals } from '../core/resolve';
import type { Id, PropValue, Scene, Vault } from '../core/types';

export type Difference =
  | { kind: 'prop'; property: string; before: PropValue | undefined; after: PropValue | undefined }
  /** The property's value is the same, but whether unordered scenes disagree about it changed. */
  | { kind: 'ambiguous'; property: string; before: boolean; after: boolean }
  | { kind: 'exists'; before: boolean; after: boolean }
  | { kind: 'name'; before: string; after: string }
  | { kind: 'page' };

export interface Impact {
  sceneId: Id;
  entityId: Id;
  differences: Difference[];
}

/** Whether anything about when scenes happen differs, which can change what every entity looks like. */
function timeChanged(before: Vault, after: Vault): boolean {
  if (before.constraints !== after.constraints || before.moments !== after.moments) return true;
  if (before.scenes === after.scenes) return false;
  for (const [id, s] of Object.entries(after.scenes)) {
    const old = before.scenes[id];
    if (old && (old.momentId !== s.momentId || (old.span ?? 1) !== (s.span ?? 1))) return true;
  }
  return false;
}

/** The link targets written in each scene's prose, remembered per scene object: scenes are replaced when edited, so a stale entry is simply never asked for again. */
const targetsOfScene = new WeakMap<Scene, string[]>();

export function linkTargets(scene: Scene): string[] {
  let targets = targetsOfScene.get(scene);
  if (!targets) targetsOfScene.set(scene, (targets = [...new Set(parseLinks(scene.prose).map((l) => l.target))]));
  return targets;
}

/** Who is in each scene's cast (mentioned, added by hand, or changed there), as sceneCast defines it, but built for every scene at once: link lookups are remembered and changes are indexed by scene. */
function castIds(vault: Vault, scenes: Iterable<Scene>): Map<Id, Set<Id>> {
  const lookup = memoLookup(vault);
  const changedIn = new Map<Id, Id[]>();
  for (const c of Object.values(vault.changes)) {
    if (c.sceneId === undefined) continue;
    const list = changedIn.get(c.sceneId);
    if (list) list.push(c.entityId);
    else changedIn.set(c.sceneId, [c.entityId]);
  }
  const out = new Map<Id, Set<Id>>();
  for (const scene of scenes) {
    const cast = new Set<Id>();
    for (const target of linkTargets(scene)) {
      const id = lookup(target);
      if (id !== undefined) cast.add(id);
    }
    for (const id of scene.cast ?? []) if (vault.entities[id]) cast.add(id);
    for (const id of changedIn.get(scene.id) ?? []) if (vault.entities[id]) cast.add(id);
    out.set(scene.id, cast);
  }
  return out;
}

function sameChanges(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** A property with no value, an empty text or an empty list shows nothing: adding one to an entity is not something a scene sees. */
function blank(v: PropValue | undefined): boolean {
  return v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

function differences(before: ReturnType<Resolver['entityAt']>, after: ReturnType<Resolver['entityAt']>): Difference[] {
  const out: Difference[] = [];
  if (before.exists !== after.exists) out.push({ kind: 'exists', before: before.exists, after: after.exists });
  if (before.name !== after.name) out.push({ kind: 'name', before: before.name, after: after.name });
  if (before.note !== after.note) out.push({ kind: 'page' });
  const properties = [...new Set([...Object.keys(before.props), ...Object.keys(after.props)])].sort();
  for (const property of properties) {
    const a = before.props[property];
    const b = after.props[property];
    if (blank(a?.value) && blank(b?.value)) continue;
    if (!valueEquals(a?.value, b?.value)) out.push({ kind: 'prop', property, before: a?.value, after: b?.value });
    else if (!!a?.ambiguous !== !!b?.ambiguous) out.push({ kind: 'ambiguous', property, before: !!a?.ambiguous, after: !!b?.ambiguous });
  }
  return out;
}

/**
 * Every (scene, entity) pair, in reading order, whose entity looks different entering the scene in `after` than in
 * `before`. Only scenes that exist in both are compared (a deleted scene has nothing left to revisit), and only entities
 * in the scene's cast (mentioned, added by hand, or changed there) count: if nobody sees the difference, it is not reported.
 */
export function impactOf(before: Vault, after: Vault): Impact[] {
  if (before === after) return [];
  const rb = new Resolver(before);
  const ra = new Resolver(after);
  const everyone = timeChanged(before, after);
  const dirty = new Set<Id>();
  if (!everyone) {
    for (const id of new Set([...Object.keys(before.entities), ...Object.keys(after.entities)])) {
      if (before.entities[id] !== after.entities[id] || !sameChanges(rb.changesFor(id), ra.changesFor(id))) dirty.add(id);
    }
    if (dirty.size === 0) return [];
  }

  const out: Impact[] = [];
  const scenes = Object.values(after.scenes)
    .filter((s) => before.scenes[s.id])
    .sort((a, b) => (a.storyId < b.storyId ? -1 : a.storyId > b.storyId ? 1 : a.order - b.order));
  // Where nothing a cast depends on differs (the scene object, the entities and the changes are the same), the cast is too.
  const sameWorld = before.entities === after.entities && before.changes === after.changes;
  const castAfter = castIds(after, scenes);
  const castBefore = castIds(before, sameWorld ? scenes.filter((s) => before.scenes[s.id] !== s).map((s) => before.scenes[s.id]) : scenes.map((s) => before.scenes[s.id]));
  for (const scene of scenes) {
    const cast = new Set([...(castAfter.get(scene.id) ?? []), ...(castBefore.get(scene.id) ?? [])]);
    for (const entityId of cast) {
      if (!after.entities[entityId] || !before.entities[entityId] || (!everyone && !dirty.has(entityId))) continue;
      const diff = differences(rb.entityAt(entityId, rb.atScene(scene.id)), ra.entityAt(entityId, ra.atScene(scene.id)));
      if (diff.length) out.push({ sceneId: scene.id, entityId, differences: diff });
    }
  }
  return out;
}

/**
 * What to write on a review item for each impact: the edit, who it affects and how. Two impacts in one scene give two
 * causes, so each can be ticked off on its own.
 */
export function reviewCauses(vault: Vault, label: string, impacts: readonly Impact[]): { sceneId: Id; cause: string }[] {
  return impacts.map((i) => {
    const [first, ...rest] = i.differences;
    const what = first ? describeDifference(first) + (rest.length ? ` (+${rest.length} more)` : '') : 'looks different';
    return { sceneId: i.sceneId, cause: `${label}: ${vault.entities[i.entityId]?.name ?? i.entityId} ${what}` };
  });
}

const NAMES_SHOWN = 3;

/** One sentence for a toast: how many scenes now see something different, and about whom. Null when nothing changed for anyone. */
export function describeImpact(vault: Vault, impacts: readonly Impact[]): string | null {
  if (impacts.length === 0) return null;
  const scenes = new Set(impacts.map((i) => i.sceneId)).size;
  const seen = new Map<Id, number>();
  for (const i of impacts) seen.set(i.entityId, (seen.get(i.entityId) ?? 0) + 1);
  // The most affected first, ties by name, so the sentence does not change between runs.
  const names = [...seen.entries()]
    .map(([id, n]) => ({ name: vault.entities[id]?.name ?? id, n }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .map((x) => x.name);
  const shown = names.slice(0, NAMES_SHOWN).join(', ');
  const more = names.length > NAMES_SHOWN ? ` and ${names.length - NAMES_SHOWN} more` : '';
  return `${scenes} ${scenes === 1 ? 'scene now sees' : 'scenes now see'} something different about ${shown}${more}.`;
}

/** One difference in words for a list row: "status: dead → alive", "no longer exists", "page differs". */
export function describeDifference(d: Difference): string {
  switch (d.kind) {
    case 'prop':
      return `${d.property}: ${formatValue(d.before)} → ${formatValue(d.after)}`;
    case 'ambiguous':
      return d.after ? `${d.property}: order of changes now unclear` : `${d.property}: order of changes now clear`;
    case 'exists':
      return d.after ? 'now exists' : 'no longer exists';
    case 'name':
      return `name: ${d.before} → ${d.after}`;
    case 'page':
      return 'page differs';
  }
}
