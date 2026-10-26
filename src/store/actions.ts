// Pure vault edits used by the UI. Each returns a new vault (structural sharing).

import { anchorFields, sameAnchor } from '../core/anchor';
import { buildGraph } from '../core/graph';
import { addLabelToList, removeLabelFromList } from '../core/labels';
import { parseLinks, renameEntity, renameScene } from '../core/links';
import type { PlaceResult } from '../core/timeline';
import type { Anchor, Arc, Chapter, Entity, EntityType, Id, Moment, Props, StateChange, Story, Vault } from '../core/types';
import { newId } from '../core/types';

function put<K extends keyof Vault>(v: Vault, coll: K, row: Vault[K][string]): Vault {
  return { ...v, [coll]: { ...v[coll], [(row as { id: Id }).id]: row } };
}

function drop<K extends keyof Vault>(v: Vault, coll: K, ids: Id[]): Vault {
  if (!ids.length) return v;
  const next = { ...v[coll] };
  for (const id of ids) delete next[id];
  return { ...v, [coll]: next };
}

// ---- Entity types ----

export function addEntityType(v: Vault, fields: Partial<EntityType> & { name: string }): { vault: Vault; id: Id } {
  const t: EntityType = { id: newId('type'), color: '#64748b', icon: 'circle', defaultProps: {}, ...fields };
  return { vault: put(v, 'entityTypes', t), id: t.id };
}

export function updateEntityType(v: Vault, id: Id, patch: Partial<Omit<EntityType, 'id'>>): Vault {
  const t = v.entityTypes[id];
  return t ? put(v, 'entityTypes', { ...t, ...patch }) : v;
}

/** Refuses (returns null) if entities still use the type. */
export function deleteEntityType(v: Vault, id: Id): Vault | null {
  if (Object.values(v.entities).some((e) => e.typeId === id)) return null;
  return drop(v, 'entityTypes', [id]);
}

// ---- Entities ----

export function addEntity(v: Vault, fields: { name: string; typeId: Id; props?: Props; note?: string }): { vault: Vault; id: Id } {
  const type = v.entityTypes[fields.typeId];
  const e: Entity = {
    id: newId('ent'),
    typeId: fields.typeId,
    name: fields.name,
    aliases: [],
    note: fields.note ?? type?.template ?? '',
    props: { ...(type?.defaultProps ?? {}), ...(fields.props ?? {}) },
  };
  return { vault: put(v, 'entities', e), id: e.id };
}

export function updateEntity(v: Vault, id: Id, patch: Partial<Omit<Entity, 'id' | 'name'>>): Vault {
  const e = v.entities[id];
  if (!e) return v;
  const next: Entity = { ...e, ...patch };
  if ('image' in patch && !patch.image) delete next.image;
  return put(v, 'entities', next);
}

/** Rename and rewrite every link to it. */
export function renameEntityEverywhere(v: Vault, id: Id, name: string): Vault {
  const e = v.entities[id];
  if (!e || !name.trim() || e.name === name) return v;
  return renameEntity(v, id, name.trim());
}

export function deleteEntity(v: Vault, id: Id): Vault {
  const changeIds = Object.values(v.changes).filter((c) => c.entityId === id).map((c) => c.id);
  return drop(drop(v, 'changes', changeIds), 'entities', [id]);
}

// ---- Stories & chapters ----

export function addStory(v: Vault, name: string): { vault: Vault; id: Id } {
  const palette = ['#2563eb', '#d97706', '#059669', '#db2777', '#7c3aed', '#0891b2', '#65a30d', '#dc2626'];
  const n = Object.keys(v.stories).length;
  const s: Story = { id: newId('story'), name, color: palette[n % palette.length], order: n };
  return { vault: put(v, 'stories', s), id: s.id };
}

export function updateStory(v: Vault, id: Id, patch: Partial<Omit<Story, 'id'>>): Vault {
  const s = v.stories[id];
  return s ? put(v, 'stories', { ...s, ...patch }) : v;
}

export function addChapter(v: Vault, storyId: Id, title: string): { vault: Vault; id: Id } {
  const order = Math.max(-1, ...Object.values(v.chapters).filter((c) => c.storyId === storyId).map((c) => c.order)) + 1;
  const c: Chapter = { id: newId('ch'), storyId, title, order };
  return { vault: put(v, 'chapters', c), id: c.id };
}

export function updateChapter(v: Vault, id: Id, patch: Partial<Omit<Chapter, 'id'>>): Vault {
  const c = v.chapters[id];
  return c ? put(v, 'chapters', { ...c, ...patch }) : v;
}

export function deleteChapter(v: Vault, id: Id): Vault {
  let next = drop(v, 'chapters', [id]);
  for (const s of Object.values(v.scenes)) if (s.chapterId === id) next = put(next, 'scenes', { ...s, chapterId: null });
  return next;
}

// ---- Arcs ----

/** Appends an arc after the story's last one (order = max + 1). */
export function addArc(v: Vault, storyId: Id, title: string): { vault: Vault; id: Id } {
  const order = Math.max(-1, ...arcsOfStory(v, storyId).map((a) => a.order)) + 1;
  const a: Arc = { id: newId('arc'), storyId, title, order };
  return { vault: put(v, 'arcs', a), id: a.id };
}

export function updateArc(v: Vault, id: Id, patch: Partial<Omit<Arc, 'id'>>): Vault {
  const a = v.arcs[id];
  return a ? put(v, 'arcs', { ...a, ...patch }) : v;
}

/** Removes the arc and detaches its chapters (they stay in the story, without an arc). */
export function deleteArc(v: Vault, id: Id): Vault {
  if (!v.arcs[id]) return v;
  let next = drop(v, 'arcs', [id]);
  for (const c of Object.values(v.chapters)) {
    if (c.arcId !== id) continue;
    const detached: Chapter = { ...c };
    delete detached.arcId;
    next = put(next, 'chapters', detached);
  }
  return next;
}

/** Assigns a chapter to an arc of the same story, or clears its arc with `null`. */
export function setChapterArc(v: Vault, chapterId: Id, arcId: Id | null): Vault {
  const c = v.chapters[chapterId];
  if (!c) return v;
  const next: Chapter = { ...c };
  if (arcId === null) {
    delete next.arcId;
  } else {
    const arc = v.arcs[arcId];
    if (!arc || arc.storyId !== c.storyId) return v;
    next.arcId = arcId;
  }
  return put(v, 'chapters', next);
}

// ---- Scenes ----

export function updateSceneProse(v: Vault, id: Id, prose: string): Vault {
  const s = v.scenes[id];
  return s && s.prose !== prose ? put(v, 'scenes', { ...s, prose }) : v;
}

export function setSceneChapter(v: Vault, id: Id, chapterId: Id | null): Vault {
  const s = v.scenes[id];
  if (!s) return v;
  const next = { ...s, chapterId };
  if (chapterId !== null) delete next.someday;
  return put(v, 'scenes', next);
}

export function renameSceneEverywhere(v: Vault, id: Id, title: string): Vault {
  const s = v.scenes[id];
  if (!s || !title.trim() || s.title === title) return v;
  return renameScene(v, id, title.trim());
}

/** Move a scene up/down in its story's telling order. */
export function shiftSceneOrder(v: Vault, id: Id, delta: -1 | 1): Vault {
  const s = v.scenes[id];
  if (!s) return v;
  const list = Object.values(v.scenes)
    .filter((x) => x.storyId === s.storyId)
    .sort((a, b) => a.order - b.order);
  const i = list.findIndex((x) => x.id === id);
  const j = i + delta;
  if (j < 0 || j >= list.length) return v;
  [list[i], list[j]] = [list[j], list[i]];
  let next = v;
  list.forEach((x, k) => {
    if (x.order !== k) next = put(next, 'scenes', { ...x, order: k });
  });
  return next;
}

export function setMomentLabel(v: Vault, momentId: Id, label: string): Vault {
  const m = v.moments[momentId];
  if (!m) return v;
  const next: Moment = { ...m };
  if (label.trim()) next.label = label;
  else delete next.label;
  return put(v, 'moments', next);
}

/**
 * Sets or clears a moment's Concrete date/time anchor (e.g. "Autumn, 2026" or "2026-10-25").
 * Because Concrete acts as an absolute ordering constraint, rejects a Concrete that would create a time loop
 * with existing constraints or other Concretes.
 */
export function setMomentConcrete(v: Vault, momentId: Id, concrete: string): PlaceResult {
  const m = v.moments[momentId];
  if (!m) return { ok: true, vault: v };
  const next: Moment = { ...m };
  delete next.label;
  const trimmed = concrete.trim();
  if (trimmed) next.concrete = trimmed;
  else delete next.concrete;
  // Clear legacy `label` when `concrete` is updated so there isn't stale duplicate data.
  const candidate = put(v, 'moments', next);
  const g = buildGraph(candidate);
  if (g.cycle) {
    return {
      ok: false,
      error: `Concrete date “${trimmed}” conflicts with existing timeline order (it would create a time loop).`,
    };
  }
  return { ok: true, vault: candidate };
}

export function addSceneLabel(v: Vault, sceneId: Id, label: string): Vault {
  const s = v.scenes[sceneId];
  if (!s) return v;
  const labels = addLabelToList(s.labels, label);
  const next = { ...s };
  if (labels) next.labels = labels;
  else delete next.labels;
  return put(v, 'scenes', next);
}

export function removeSceneLabel(v: Vault, sceneId: Id, label: string): Vault {
  const s = v.scenes[sceneId];
  if (!s) return v;
  const labels = removeLabelFromList(s.labels, label);
  const next = { ...s };
  if (labels) next.labels = labels;
  else delete next.labels;
  return put(v, 'scenes', next);
}

export function addChapterLabel(v: Vault, chapterId: Id, label: string): Vault {
  const c = v.chapters[chapterId];
  if (!c) return v;
  const labels = addLabelToList(c.labels, label);
  const next = { ...c };
  if (labels) next.labels = labels;
  else delete next.labels;
  return put(v, 'chapters', next);
}

export function removeChapterLabel(v: Vault, chapterId: Id, label: string): Vault {
  const c = v.chapters[chapterId];
  if (!c) return v;
  const labels = removeLabelFromList(c.labels, label);
  const next = { ...c };
  if (labels) next.labels = labels;
  else delete next.labels;
  return put(v, 'chapters', next);
}

export function updateSceneSynopsis(v: Vault, id: Id, synopsis: string): Vault {
  const s = v.scenes[id];
  if (!s) return v;
  const trimmed = synopsis.trim();
  const next = { ...s };
  if (trimmed) next.synopsis = trimmed;
  else delete next.synopsis;
  return put(v, 'scenes', next);
}

export function setSceneSomeday(v: Vault, id: Id, someday: boolean): Vault {
  const s = v.scenes[id];
  if (!s) return v;
  const next = { ...s };
  if (someday) next.someday = true;
  else delete next.someday;
  return put(v, 'scenes', next);
}

export function setMomentTimeSkip(v: Vault, momentId: Id, timeSkip: string): Vault {
  const m = v.moments[momentId];
  if (!m) return v;
  const next = { ...m };
  const trimmed = timeSkip.trim();
  if (trimmed) next.timeSkip = trimmed;
  else delete next.timeSkip;
  return put(v, 'moments', next);
}

export function addMomentLabel(v: Vault, momentId: Id, label: string): Vault {
  const m = v.moments[momentId];
  if (!m) return v;
  const labels = addLabelToList(m.labels, label);
  const next = { ...m };
  if (labels) next.labels = labels;
  else delete next.labels;
  return put(v, 'moments', next);
}

export function removeMomentLabel(v: Vault, momentId: Id, label: string): Vault {
  const m = v.moments[momentId];
  if (!m) return v;
  const labels = removeLabelFromList(m.labels, label);
  const next = { ...m };
  if (labels) next.labels = labels;
  else delete next.labels;
  return put(v, 'moments', next);
}

const PROSE_PREFIX_RE = /^(note|warning|remember|todo|info|tip|idea|summary|action|log|dialogue|reason|scene|clue|outcome)$/i;

/**
 * Parses a quick shorthand commit string like:
 * - `"status = dead"` -> `{ op: 'set', property: 'status', value: 'dead' }`
 * - `"owner = [[Mira]]"` -> `{ op: 'set', property: 'owner', value: { kind: 'link', target: 'Mira' } }`
 * - `"status = dead — Falls defending the inn"` -> `{ op: 'set', property: 'status', value: 'dead', message: 'Falls defending the inn' }`
 * - `"Learns the truth about Bob"` -> `{ op: 'note', message: 'Learns the truth about Bob' }`
 */
export function parseQuickCommit(input: string): { op: StateChange['op']; property?: string; value?: StateChange['value']; message?: string } | null {
  const trimmed = input.replace(/\s*\r?\n\s*/g, ' ').trim();
  if (!trimmed) return null;
  const eqMatch = /^([a-zA-Z0-9_-]+)\s*(=|:(?!\/\/|\d))\s*(.+?)(?:\s*(?:—|--|\/\/)\s*(.+)|\s+-\s+(.+))?$/.exec(trimmed);
  if (eqMatch) {
    const property = eqMatch[1].trim();
    const sep = eqMatch[2];
    const isColonProse = sep === ':' && (PROSE_PREFIX_RE.test(property) || /^\d+$/.test(property));
    if (!isColonProse) {
      const rawVal = eqMatch[3].trim();
      const msg = (eqMatch[4] ?? eqMatch[5])?.trim();
      const linkMatch = /^\[\[([^\]]+)\]\]$/.exec(rawVal);
      let value: StateChange['value'] = rawVal;
      if (linkMatch) {
        const parsed = parseLinks(rawVal)[0];
        value = { kind: 'link', target: parsed ? parsed.target : linkMatch[1].split('|')[0].trim() };
      } else if (rawVal.toLowerCase() === 'true' || rawVal.toLowerCase() === 'false') {
        value = rawVal.toLowerCase() === 'true';
      } else if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(rawVal)) {
        value = Number(rawVal);
      }
      return {
        op: 'set',
        property,
        value,
        ...(msg ? { message: msg } : {}),
      };
    }
  }
  return { op: 'note', message: trimmed };
}

// ---- State changes ----

export function addChange(v: Vault, fields: Omit<StateChange, 'id' | 'order'>): { vault: Vault; id: Id } {
  // Order is within one anchor: one scene's changes, or the changes at one column.
  const order = Math.max(-1, ...Object.values(v.changes).filter((c) => c.sceneId === fields.sceneId && c.at === fields.at).map((c) => c.order)) + 1;
  const c: StateChange = { id: newId('chg'), order, ...fields };
  if (c.property === undefined) delete c.property;
  if (c.value === undefined) delete c.value;
  return { vault: put(v, 'changes', c), id: c.id };
}

export function updateChange(v: Vault, id: Id, patch: Partial<Omit<StateChange, 'id'>>): Vault {
  const c = v.changes[id];
  if (!c) return v;
  const next = { ...c, ...patch };
  if (next.property === undefined) delete next.property;
  if (next.value === undefined) delete next.value;
  return put(v, 'changes', next);
}

/**
 * Commit a new version of an entity's page (and optionally its name) at an anchor (after a scene, or at a
 * timeline column) — a "living page" revision. One revision per (entity, anchor): committing again at the same
 * anchor amends it. Fields equal to the page as it stood before the anchor are left out (unchanged).
 * `before` is the page/name just before it (from the resolver). Returns the same vault when nothing would change.
 */
export function commitRevision(
  v: Vault,
  fields: { entityId: Id; anchor: Anchor; note: string; name?: string; message?: string; before: { note: string; name: string } },
): { vault: Vault; id: Id | null } {
  const existing = Object.values(v.changes).find((c) => c.op === 'revise' && c.entityId === fields.entityId && sameAnchor(c, fields.anchor));
  const name = fields.name?.trim();
  const patch: Partial<StateChange> = {};
  if (fields.note !== fields.before.note) patch.note = fields.note;
  if (name && name !== fields.before.name) patch.rename = name;
  const message = fields.message?.trim();
  if (patch.note === undefined && patch.rename === undefined) {
    // Nothing differs from the earlier page: an amended revision that now matches is removed.
    return existing ? { vault: drop(v, 'changes', [existing.id]), id: null } : { vault: v, id: null };
  }
  if (existing) {
    const next: StateChange = { ...existing };
    delete next.note;
    delete next.rename;
    Object.assign(next, patch);
    if (message) next.message = message;
    return { vault: put(v, 'changes', next), id: existing.id };
  }
  const added = addChange(v, { ...anchorFields(fields.anchor), entityId: fields.entityId, op: 'revise', ...patch, ...(message ? { message } : {}) });
  return added;
}

export function deleteChange(v: Vault, id: Id): Vault {
  return drop(v, 'changes', [id]);
}

// ---- Queries ----

export function scenesOfStory(v: Vault, storyId: Id) {
  return Object.values(v.scenes)
    .filter((s) => s.storyId === storyId)
    .sort((a, b) => a.order - b.order);
}

export function arcsOfStory(v: Vault, storyId: Id): Arc[] {
  return Object.values(v.arcs)
    .filter((a) => a.storyId === storyId)
    .sort((a, b) => a.order - b.order);
}

export function chaptersOfStory(v: Vault, storyId: Id) {
  return Object.values(v.chapters)
    .filter((c) => c.storyId === storyId)
    .sort((a, b) => a.order - b.order);
}

export function sortedStories(v: Vault) {
  return Object.values(v.stories).sort((a, b) => a.order - b.order);
}

export function sortedTypes(v: Vault) {
  return Object.values(v.entityTypes).sort((a, b) => a.name.localeCompare(b.name));
}
