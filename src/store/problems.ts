// Continuity problems: things the engine can see that the writer may not have noticed. Pure rules over a vault.
//
// Every rule is built to stay quiet when in doubt, because one wrong warning teaches the writer to ignore all of them.
// Reading order against story time is never a problem: flashbacks are the point of this app.

import { memoLookup } from '../core/linkList';
import { findScene } from '../core/links';
import { Resolver, formatValue } from '../core/resolve';
import type { Id, Scene, Vault } from '../core/types';
import { linkTargets } from './impact';

export type Severity = 'warning' | 'info';

export interface Problem {
  /** Stable while the facts behind the problem are the same; a dismissal is stored against it. */
  id: string;
  rule: 'gone' | 'unresolved' | 'ambiguous' | 'floating';
  severity: Severity;
  sceneId: Id;
  entityId?: Id;
  message: string;
  hint?: string;
}

function inReadingOrder(vault: Vault): Scene[] {
  return Object.values(vault.scenes).sort((a, b) => (a.storyId < b.storyId ? -1 : a.storyId > b.storyId ? 1 : a.order - b.order));
}

/** A scene mentions (or lists in its cast) an entity that, by that point in story time, no longer exists, or does not exist yet. */
function goneEntities(vault: Vault, resolver: Resolver, scenes: Scene[]): Problem[] {
  const lookup = memoLookup(vault);
  // An entity nothing creates or retires exists throughout, so only the others need resolving.
  const lifecycle = new Set<Id>();
  for (const c of Object.values(vault.changes)) if (c.op === 'create' || c.op === 'retire') lifecycle.add(c.entityId);
  const out: Problem[] = [];
  for (const scene of scenes) {
    const mentioned = new Set<Id>(scene.cast?.filter((id) => vault.entities[id]));
    for (const target of linkTargets(scene)) {
      const id = lookup(target);
      if (id !== undefined) mentioned.add(id);
    }
    for (const entityId of mentioned) {
      if (!lifecycle.has(entityId)) continue;
      const state = resolver.entityAt(entityId, resolver.atScene(scene.id));
      if (state.exists) continue;
      const last = [...state.applied].reverse().find((c) => c.op === 'create' || c.op === 'retire');
      const retired = last?.op === 'retire';
      out.push({
        id: `gone:${scene.id}:${entityId}:${last?.id ?? 'never'}`,
        rule: 'gone',
        severity: 'warning',
        sceneId: scene.id,
        entityId,
        message: `“${scene.title}” mentions ${vault.entities[entityId].name}, who ${retired ? 'has been retired by then' : 'does not exist yet at that point'}.`,
        hint: retired ? 'If this is a memory or a flashback, move the scene earlier; otherwise move the retire commit. You can dismiss this if it is intended.' : 'Move the scene later, or the create commit earlier. You can dismiss this if it is intended.',
      });
    }
  }
  return out;
}

/** [[Nobody]] names neither an entity nor a scene. */
function unresolvedLinks(vault: Vault, scenes: Scene[]): Problem[] {
  const lookup = memoLookup(vault);
  const out: Problem[] = [];
  for (const scene of scenes) {
    for (const target of linkTargets(scene)) {
      if (lookup(target) !== undefined || findScene(vault, target)) continue;
      out.push({
        id: `unresolved:${scene.id}:${target}`,
        rule: 'unresolved',
        severity: 'info',
        sceneId: scene.id,
        message: `“${scene.title}” links to “${target}”, which is not an entity or a scene.`,
        hint: 'Create the entity, or fix the spelling.',
      });
    }
  }
  return out;
}

/** Scenes with no known order between them set the same property to different values. */
function ambiguousState(vault: Vault, resolver: Resolver): Problem[] {
  const out: Problem[] = [];
  for (const entity of Object.values(vault.entities)) {
    const state = resolver.entityAt(entity.id, { kind: 'latest' });
    for (const [property, p] of Object.entries(state.props)) {
      if (!p.ambiguous?.length || p.sceneId === null) continue;
      const others = p.ambiguous.map((a) => `“${formatValue(a.value)}” in “${vault.scenes[a.sceneId]?.title ?? 'a scene'}”`).join(', ');
      out.push({
        id: `ambiguous:${entity.id}:${property}:${p.changeId}:${p.ambiguous.map((a) => `${a.sceneId}=${formatValue(a.value)}`).join('|')}`,
        rule: 'ambiguous',
        severity: 'warning',
        sceneId: p.sceneId,
        entityId: entity.id,
        message: `${entity.name}: “${property}” is “${formatValue(p.value)}” in “${vault.scenes[p.sceneId]?.title ?? 'a scene'}” but also ${others}, and nothing says which comes first.`,
        hint: 'Place the scenes in order on the timeline so the latest one wins.',
      });
    }
  }
  return out;
}

/** A scene that no ordering mentions, in a story whose other scenes are ordered: probably a placement the writer forgot (unless marked as Someday). */
function floatingScenes(vault: Vault, scenes: Scene[]): Problem[] {
  const ordered = new Set<Id>();
  for (const c of Object.values(vault.constraints)) {
    ordered.add(c.before);
    ordered.add(c.after);
  }
  const placedPerStory = new Map<Id, number>();
  for (const s of scenes) if (ordered.has(s.momentId)) placedPerStory.set(s.storyId, (placedPerStory.get(s.storyId) ?? 0) + 1);
  const out: Problem[] = [];
  for (const s of scenes) {
    if (s.someday) continue;
    if (ordered.has(s.momentId) || (placedPerStory.get(s.storyId) ?? 0) < 2) continue;
    out.push({
      id: `floating:${s.id}`,
      rule: 'floating',
      severity: 'info',
      sceneId: s.id,
      message: `“${s.title}” is not placed relative to any other scene, though the rest of its story is.`,
      hint: 'Drag it to where it happens, mark it as Someday, or dismiss this if it really is free-floating.',
    });
  }
  return out;
}

/** Every problem in the vault, most serious first, then in reading order. */
export function findProblems(vault: Vault): Problem[] {
  const scenes = inReadingOrder(vault);
  const resolver = new Resolver(vault);
  const all = [...goneEntities(vault, resolver, scenes), ...ambiguousState(vault, resolver), ...unresolvedLinks(vault, scenes), ...floatingScenes(vault, scenes)];
  const rank = { warning: 0, info: 1 } as const;
  return all.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
