// A scene's cast: entities [[linked]] in its prose (in order of first mention) plus ones added by hand.

import { findEntity, parseLinks } from '../core/links';
import type { Id, Scene, Vault } from '../core/types';

export interface CastMember {
  entityId: Id;
  /** How the entity is in the cast. */
  source: 'mention' | 'manual' | 'change';
}

/** Ordered cast: mentions first (by position), then manual additions, then entities only changed here. */
export function sceneCast(vault: Vault, scene: Scene): CastMember[] {
  const seen = new Set<Id>();
  const out: CastMember[] = [];
  const add = (entityId: Id, source: CastMember['source']) => {
    if (seen.has(entityId) || !vault.entities[entityId]) return;
    seen.add(entityId);
    out.push({ entityId, source });
  };
  for (const l of parseLinks(scene.prose)) {
    const e = findEntity(vault, l.target);
    if (e) add(e.id, 'mention');
  }
  for (const id of scene.cast ?? []) add(id, 'manual');
  for (const c of Object.values(vault.changes)) if (c.sceneId === scene.id) add(c.entityId, 'change');
  return out;
}

export interface GroupCastMember extends CastMember {
  /** The scenes of the group this entity is in, in the order given. */
  sceneIds: Id[];
}

/** Everyone in any of the scenes, once each, in order of first appearance; `source` is how they first got in. */
export function groupCast(vault: Vault, scenes: Scene[]): GroupCastMember[] {
  const byEntity = new Map<Id, GroupCastMember>();
  for (const scene of scenes) {
    for (const m of sceneCast(vault, scene)) {
      const have = byEntity.get(m.entityId);
      if (have) have.sceneIds.push(scene.id);
      else byEntity.set(m.entityId, { ...m, sceneIds: [scene.id] });
    }
  }
  return [...byEntity.values()];
}

export function addToCast(v: Vault, sceneId: Id, entityId: Id): Vault {
  const s = v.scenes[sceneId];
  if (!s || s.cast?.includes(entityId)) return v;
  return { ...v, scenes: { ...v.scenes, [sceneId]: { ...s, cast: [...(s.cast ?? []), entityId] } } };
}

export function removeFromCast(v: Vault, sceneId: Id, entityId: Id): Vault {
  const s = v.scenes[sceneId];
  if (!s?.cast?.includes(entityId)) return v;
  const cast = s.cast.filter((id) => id !== entityId);
  const next: Scene = { ...s, cast };
  if (!cast.length) delete next.cast;
  return { ...v, scenes: { ...v.scenes, [sceneId]: next } };
}
