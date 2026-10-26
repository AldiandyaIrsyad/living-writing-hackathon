// Navigating from a [[link]] — shared by the editor, markdown preview and hover card.

import { findEntity, findScene, parseLinkInner, resolveLinkTime } from '../core/links';
import type { Id, Scene, TimePoint, Vault } from '../core/types';
import { addEntity, addEntityType, sortedTypes } from '../store/actions';
import { getResolver, useStore } from '../store/store';

export interface LinkInfo {
  target: string;
  timeRaw?: string;
  contextSceneId?: Id;
}

export type ResolvedLink =
  | { kind: 'entity'; id: Id; at: TimePoint }
  | { kind: 'scene'; id: Id }
  | { kind: 'unresolved'; target: string }
  | { kind: 'badtime'; id: Id; timeRaw: string };

export function resolveLinkInfo(vault: Vault, info: LinkInfo): ResolvedLink {
  const parsed = parseLinkInner(info.timeRaw !== undefined ? `${info.target}@${info.timeRaw}` : info.target);
  const entity = findEntity(vault, parsed.target);
  if (entity) {
    const at = resolveLinkTime(vault, parsed.time, info.contextSceneId);
    if (!at) return { kind: 'badtime', id: entity.id, timeRaw: info.timeRaw ?? '' };
    return { kind: 'entity', id: entity.id, at };
  }
  const scene = findScene(vault, parsed.target);
  if (scene) return { kind: 'scene', id: scene.id };
  return { kind: 'unresolved', target: parsed.target };
}

/** Create an entity for an unresolved link (Obsidian-style one-click create). */
export function createEntityNamed(name: string): Id {
  const { vault, commit } = useStore.getState();
  let v = vault;
  let typeId = sortedTypes(v)[0]?.id;
  if (!typeId) {
    const r = addEntityType(v, { name: 'Note' });
    v = r.vault;
    typeId = r.id;
  }
  const r = addEntity(v, { name, typeId });
  commit(r.vault);
  return r.id;
}

export function followLink(target: string, timeRaw?: string, contextSceneId?: Id): void {
  const { vault, view, navigate, openFloatingEntity } = useStore.getState();
  const r = resolveLinkInfo(vault, { target, timeRaw, contextSceneId });
  const activeSceneId = contextSceneId ?? (view.kind === 'scene' ? view.id : null);
  const inScene = view.kind === 'scene';
  switch (r.kind) {
    case 'entity':
      // Only pin `at` on the floating wiki if the author wrote an explicit `@time` on the link;
      // otherwise let the floating wiki resolve `as of` the active scene (including the scene's own commits)
      // and follow the active scene when navigating across chapters.
      if (inScene) openFloatingEntity(r.id, activeSceneId, timeRaw !== undefined ? r.at : undefined);
      else navigate({ kind: 'entity', id: r.id, at: r.at });
      break;
    case 'badtime':
      useStore.getState().toast('error', `No scene called “${r.timeRaw.replace(/^(before|after):/, '')}”. Showing latest.`);
      if (inScene) openFloatingEntity(r.id, activeSceneId);
      else navigate({ kind: 'entity', id: r.id });
      break;
    case 'scene':
      navigate({ kind: 'scene', id: r.id });
      break;
    case 'unresolved': {
      const id = createEntityNamed(target);
      if (inScene) openFloatingEntity(id, activeSceneId);
      else navigate({ kind: 'entity', id });
      break;
    }
  }
}

/** Human description of a time point, e.g. “Entering “The Siege” · Chapter 3”. */
export function describeTime(vault: Vault, tp: TimePoint | undefined): string {
  if (!tp || tp.kind === 'latest') return 'Latest';
  if (tp.kind === 'position') return describePlayhead(vault, tp.x);
  if (tp.includeSceneId) {
    const s = vault.scenes[tp.includeSceneId];
    return s ? `Just after “${s.title}”` : 'Unknown time';
  }
  const scenes = Object.values(vault.scenes).filter((s) => s.momentId === tp.momentId);
  const label = vault.moments[tp.momentId]?.label;
  if (!scenes.length) return label ?? 'Unknown time';
  const s = scenes[0];
  const ch = s.chapterId ? vault.chapters[s.chapterId]?.title : undefined;
  return [`At “${s.title}”`, ch, label].filter(Boolean).join(' · ');
}

/** Scenes in chronological (topological) order — used by time pickers. */
export function chronologicalScenes(vault: Vault) {
  const g = getResolver(vault).graph;
  return Object.values(vault.scenes).sort(
    (a, b) => g.topoIndex(a.momentId) - g.topoIndex(b.momentId) || a.order - b.order,
  );
}

/** Arc · chapter · scene at a playhead position, preferring a given story. */
export function playheadContext(vault: Vault, x: number, preferStoryId?: Id) {
  const g = getResolver(vault).graph;
  const scenes = Object.values(vault.scenes);
  const storyOrder = [preferStoryId, ...Object.values(vault.stories).sort((a, b) => a.order - b.order).map((s) => s.id)];
  for (const storyId of storyOrder) {
    if (!storyId) continue;
    const own = scenes.filter((s) => s.storyId === storyId);
    // A clip covers [start, start + its span). The clip under the playhead (the latest started), else the last one finished.
    const start = (s: Scene) => g.layerOf(s.momentId);
    const end = (s: Scene) => start(s) + Math.max(1, s.span ?? 1);
    const under = own.filter((s) => start(s) <= x && x < end(s)).sort((a, b) => start(b) - start(a))[0];
    const done = own.filter((s) => end(s) <= x).sort((a, b) => end(b) - end(a) || start(b) - start(a))[0];
    const scene = under ?? done;
    if (!scene) continue;
    const chapter = scene.chapterId ? vault.chapters[scene.chapterId] : undefined;
    const arc = chapter?.arcId ? vault.arcs[chapter.arcId] : undefined;
    return { scene, chapter, arc, inside: !!under };
  }
  return null;
}

export function describePlayhead(vault: Vault, x: number, preferStoryId?: Id, withArc = true): string {
  const g = getResolver(vault).graph;
  const col = Math.floor(x);
  const milestoneMoments = Object.values(vault.moments).filter(
    (m) => g.layerOf(m.id) === col && ((m.labels && m.labels.length > 0) || m.concrete || m.label),
  );
  const scenesAtCol = Object.values(vault.scenes).filter((s) => !s.someday && g.layerOf(s.momentId) === col);
  if (scenesAtCol.length === 0 && milestoneMoments.length > 0) {
    const m = milestoneMoments[0];
    const parts = [m.concrete ?? m.label, ...(m.labels ?? []).map((l) => `🏷 ${l}`)].filter(Boolean);
    if (parts.length > 0) return parts.join(' · ');
  }
  const ctx = playheadContext(vault, x, preferStoryId);
  if (!ctx) return x <= 0 ? 'Start' : 'Playhead';
  const parts = [withArc ? ctx.arc?.title : undefined, ctx.chapter?.title, ctx.inside ? ctx.scene.title : `after “${ctx.scene.title}”`];
  return parts.filter(Boolean).join(' · ');
}
