// Standalone Event Bookmarks ("Labels"): milestones attached to chapters, scenes, or standalone moments on the timeline
// so the writer can track major events (e.g. "The Death of Hero Nora") even before writing a scene, and place scenes
// before, during, or after them. Pure TS — no React, no DOM.

import { buildGraph } from './graph';
import { addConstraint, constrainScenes, moveScenes, type PlaceResult, type Relation } from './timeline';
import { newId, type Chapter, type Id, type Moment, type Scene, type Vault } from './types';

export interface ResolvedLabel {
  name: string;
  chapters: Chapter[];
  scenes: Scene[];
  /** Moments belonging to this label (either via chapters/scenes or standalone milestone moments). */
  moments: Moment[];
  /** Chronologically earliest moment in this Label's span. */
  firstMomentId: Id | null;
  /** Chronologically latest moment in this Label's span. */
  lastMomentId: Id | null;
  /** Chronologically earliest scene in this Label's span (by MomentGraph layer / topoIndex). */
  firstScene: Scene | null;
  /** Chronologically latest scene in this Label's span (by MomentGraph endOf / topoIndex). */
  lastScene: Scene | null;
  /** Start column on the timeline (if any moments or scenes exist). */
  startCol: number | null;
  /** Exclusive end column on the timeline (if any moments or scenes exist). */
  endCol: number | null;
}

/** Normalizes a label name for case-insensitive matching. */
export function normalizeLabelKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Collects all unique Labels across chapters, scenes, and standalone moments in the vault, with their resolved span. */
export function allLabels(vault: Vault): ResolvedLabel[] {
  const graph = buildGraph(vault);
  const byKey = new Map<string, { name: string; chapters: Set<Id>; scenes: Set<Id>; moments: Set<Id> }>();

  const ensure = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const key = normalizeLabelKey(trimmed);
    let entry = byKey.get(key);
    if (!entry) {
      entry = { name: trimmed, chapters: new Set(), scenes: new Set(), moments: new Set() };
      byKey.set(key, entry);
    }
    return entry;
  };

  for (const m of Object.values(vault.moments)) {
    for (const l of m.labels ?? []) {
      const entry = ensure(l);
      if (entry) entry.moments.add(m.id);
    }
  }

  for (const ch of Object.values(vault.chapters)) {
    for (const l of ch.labels ?? []) {
      const entry = ensure(l);
      if (entry) entry.chapters.add(ch.id);
    }
  }

  for (const sc of Object.values(vault.scenes)) {
    for (const l of sc.labels ?? []) {
      const entry = ensure(l);
      if (entry) {
        entry.scenes.add(sc.id);
        entry.moments.add(sc.momentId);
      }
    }
    if (sc.chapterId && vault.chapters[sc.chapterId]) {
      for (const l of vault.chapters[sc.chapterId].labels ?? []) {
        const entry = ensure(l);
        if (entry) {
          entry.scenes.add(sc.id);
          entry.moments.add(sc.momentId);
        }
      }
    }
  }

  const out: ResolvedLabel[] = [];
  for (const entry of byKey.values()) {
    const chapters = [...entry.chapters]
      .map((id) => vault.chapters[id])
      .filter((c): c is Chapter => !!c)
      .sort((a, b) => a.order - b.order);
    const scenes = [...entry.scenes]
      .map((id) => vault.scenes[id])
      .filter((s): s is Scene => !!s)
      .sort((a, b) => graph.layerOf(a.momentId) - graph.layerOf(b.momentId) || graph.topoIndex(a.momentId) - graph.topoIndex(b.momentId) || a.order - b.order);
    const moments = [...entry.moments]
      .map((id) => vault.moments[id])
      .filter((m): m is Moment => !!m)
      .sort((a, b) => graph.layerOf(a.id) - graph.layerOf(b.id) || graph.topoIndex(a.id) - graph.topoIndex(b.id));

    let firstScene: Scene | null = null;
    let lastScene: Scene | null = null;
    let firstMomentId: Id | null = null;
    let lastMomentId: Id | null = null;
    let startCol: number | null = null;
    let endCol: number | null = null;

    for (const m of moments) {
      const col = graph.layerOf(m.id);
      const end = graph.endOf(m.id);
      if (startCol === null || col < startCol || (col === startCol && firstMomentId && graph.topoIndex(m.id) < graph.topoIndex(firstMomentId))) {
        startCol = col;
        firstMomentId = m.id;
      }
      if (endCol === null || end > endCol || (end === endCol && lastMomentId && graph.topoIndex(m.id) > graph.topoIndex(lastMomentId))) {
        endCol = end;
        lastMomentId = m.id;
      }
    }

    for (const s of scenes) {
      const col = graph.layerOf(s.momentId);
      const end = graph.endOf(s.momentId);
      if (!firstScene || col < graph.layerOf(firstScene.momentId) || (col === graph.layerOf(firstScene.momentId) && graph.topoIndex(s.momentId) < graph.topoIndex(firstScene.momentId))) {
        firstScene = s;
      }
      if (!lastScene || end > graph.endOf(lastScene.momentId) || (end === graph.endOf(lastScene.momentId) && graph.topoIndex(s.momentId) > graph.topoIndex(lastScene.momentId))) {
        lastScene = s;
      }
    }

    out.push({
      name: entry.name,
      chapters,
      scenes,
      moments,
      firstMomentId,
      lastMomentId,
      firstScene,
      lastScene,
      startCol,
      endCol,
    });
  }

  return out.sort((a, b) => (a.startCol ?? Infinity) - (b.startCol ?? Infinity) || a.name.localeCompare(b.name));
}

/** Finds a resolved label by name (case-insensitive). */
export function findLabel(vault: Vault, name: string): ResolvedLabel | undefined {
  const key = normalizeLabelKey(name);
  return allLabels(vault).find((l) => normalizeLabelKey(l.name) === key);
}

/**
 * Creates a standalone milestone on the timeline (a Moment with a Label and/or Concrete date, without needing a Scene yet).
 * Optionally places it `before` or `after` an existing moment.
 */
export function addStandaloneMilestone(
  vault: Vault,
  fields: { label?: string; concrete?: string; timeSkip?: string; beforeMomentId?: Id; afterMomentId?: Id },
): PlaceResult & { momentId?: Id } {
  const mId = newId('m');
  const m: Moment = { id: mId, timelineId: 'main' };
  if (fields.label?.trim()) m.labels = [fields.label.trim()];
  if (fields.concrete?.trim()) m.concrete = fields.concrete.trim();
  if (fields.timeSkip?.trim()) m.timeSkip = fields.timeSkip.trim();

  let next: Vault = { ...vault, moments: { ...vault.moments, [mId]: m } };
  if (fields.afterMomentId && vault.moments[fields.afterMomentId]) {
    const r = addConstraint(next, fields.afterMomentId, mId);
    if (!r.ok) return r;
    next = r.vault;
  }
  if (fields.beforeMomentId && vault.moments[fields.beforeMomentId]) {
    const r = addConstraint(next, mId, fields.beforeMomentId);
    if (!r.ok) return r;
    next = r.vault;
  }
  const g = buildGraph(next);
  if (g.cycle) {
    return { ok: false, error: 'That milestone would conflict with existing timeline order (time loop).' };
  }
  return { ok: true, vault: next, momentId: mId };
}

/**
 * Updates an existing milestone moment's labels, concrete date, or timeSkip.
 * Validates that any updated Concrete date does not create a time loop.
 */
export function updateStandaloneMilestone(
  vault: Vault,
  momentId: Id,
  patch: { labels?: string[]; concrete?: string; timeSkip?: string },
): PlaceResult {
  const m = vault.moments[momentId];
  if (!m) return { ok: true, vault };
  const next: Moment = { ...m };
  if ('labels' in patch) {
    const cleaned = (patch.labels ?? []).map((l) => l.trim()).filter(Boolean);
    if (cleaned.length > 0) next.labels = cleaned;
    else delete next.labels;
  }
  if ('concrete' in patch) {
    const c = patch.concrete?.trim();
    delete next.label;
    if (c) next.concrete = c;
    else delete next.concrete;
  }
  if ('timeSkip' in patch) {
    const ts = patch.timeSkip?.trim();
    if (ts) next.timeSkip = ts;
    else delete next.timeSkip;
  }
  const candidate: Vault = { ...vault, moments: { ...vault.moments, [momentId]: next } };
  const g = buildGraph(candidate);
  if (g.cycle) {
    return { ok: false, error: 'Updated milestone date conflicts with existing timeline order (time loop).' };
  }
  return { ok: true, vault: candidate };
}

/**
 * Deletes a standalone milestone (or clears milestone metadata if scenes still inhabit that moment).
 * Bridges incoming -> outgoing constraints (`pred -> succ`) so surrounding scenes do not collapse to column 0.
 */
export function deleteStandaloneMilestone(vault: Vault, momentId: Id): Vault {
  const m = vault.moments[momentId];
  if (!m) return vault;
  const hasScenes = Object.values(vault.scenes).some((s) => s.momentId === momentId);
  if (hasScenes) {
    const next: Moment = { id: m.id, timelineId: m.timelineId };
    return { ...vault, moments: { ...vault.moments, [momentId]: next } };
  }
  const allConstraints = Object.values(vault.constraints);
  const preds = allConstraints.filter((c) => c.after === momentId).map((c) => c.before);
  const succs = allConstraints.filter((c) => c.before === momentId).map((c) => c.after);
  const constraints = { ...vault.constraints };
  for (const c of allConstraints) {
    if (c.before === momentId || c.after === momentId) delete constraints[c.id];
  }
  const moments = { ...vault.moments };
  delete moments[momentId];
  let next: Vault = { ...vault, moments, constraints };
  for (const p of preds) {
    for (const s of succs) {
      if (p !== s) {
        const r = addConstraint(next, p, s);
        if (r.ok) next = r.vault;
      }
    }
  }
  return next;
}

/**
 * Resolves placing a scene `before`, `after`, or `same` (at/during) a Label into a target scene (or standalone moment) and Relation.
 */
export function resolveLabelTarget(
  vault: Vault,
  labelName: string,
  relation: 'before' | 'after' | 'same',
  excludeSceneIds: Id[] = [],
): { targetSceneId?: Id; targetMomentId: Id; relation: Relation } | { error: string } {
  const label = findLabel(vault, labelName);
  if (!label) return { error: `Label “${labelName}” not found.` };
  const candidates = label.scenes.filter((s) => !excludeSceneIds.includes(s.id));
  const graph = buildGraph(vault);

  if (candidates.length > 0) {
    const sorted = [...candidates].sort(
      (a, b) => graph.layerOf(a.momentId) - graph.layerOf(b.momentId) || graph.topoIndex(a.momentId) - graph.topoIndex(b.momentId),
    );
    if (relation === 'before') {
      return { targetSceneId: sorted[0].id, targetMomentId: sorted[0].momentId, relation: 'before' };
    }
    if (relation === 'same') {
      return { targetSceneId: sorted[0].id, targetMomentId: sorted[0].momentId, relation: 'same' };
    }
    const byEnd = [...candidates].sort(
      (a, b) => graph.endOf(b.momentId) - graph.endOf(a.momentId) || graph.topoIndex(b.momentId) - graph.topoIndex(a.momentId),
    );
    return { targetSceneId: byEnd[0].id, targetMomentId: byEnd[0].momentId, relation: 'after' };
  }

  // Fallback to standalone milestone moments when the Label has no scenes yet!
  const excludedMoments = new Set(excludeSceneIds.map((id) => vault.scenes[id]?.momentId).filter(Boolean));
  const momentCandidates = label.moments.filter((m) => !excludedMoments.has(m.id));
  if (momentCandidates.length === 0) {
    return { error: `Label “${label.name}” has no other moments on the timeline yet.` };
  }
  if (relation === 'before' || relation === 'same') {
    return { targetMomentId: momentCandidates[0].id, relation };
  }
  return { targetMomentId: momentCandidates[momentCandidates.length - 1].id, relation: 'after' };
}

/** Constrain scenes relative to a Label (`before`, `after`, or `same` time as the Label's span). */
export function constrainScenesToLabel(
  vault: Vault,
  sceneIds: Id[],
  relation: 'before' | 'after' | 'same',
  labelName: string,
): PlaceResult {
  const resolved = resolveLabelTarget(vault, labelName, relation, sceneIds);
  if ('error' in resolved) return { ok: false, error: resolved.error };
  if (resolved.targetSceneId) {
    return constrainScenes(vault, sceneIds, resolved.relation, resolved.targetSceneId);
  }
  // Constrain directly against the standalone milestone moment
  let next = vault;
  for (const sid of sceneIds) {
    const s = next.scenes[sid];
    if (!s) continue;
    if (relation === 'same') {
      next = { ...next, scenes: { ...next.scenes, [sid]: { ...s, momentId: resolved.targetMomentId } } };
    } else {
      const [before, after] = relation === 'after' ? [resolved.targetMomentId, s.momentId] : [s.momentId, resolved.targetMomentId];
      const r = addConstraint(next, before, after);
      if (!r.ok) return r;
      next = r.vault;
    }
  }
  return { ok: true, vault: next };
}

/** Move scenes relative to a Label (`before`, `after`, or `same` time as the Label's span). */
export function moveScenesToLabel(
  vault: Vault,
  sceneIds: Id[],
  relation: 'before' | 'after' | 'same',
  labelName: string,
): PlaceResult {
  const resolved = resolveLabelTarget(vault, labelName, relation, sceneIds);
  if ('error' in resolved) return { ok: false, error: resolved.error };
  if (resolved.targetSceneId) {
    return moveScenes(vault, sceneIds, resolved.relation, resolved.targetSceneId);
  }
  // When the Label is a standalone milestone (no scenes yet), create a temporary proxy scene at that moment,
  // run moveScenes to detach the moving scenes from their old constraints and attach them to the milestone,
  // then remove the proxy scene.
  const proxyId = '__label_proxy__';
  const withProxy: Vault = {
    ...vault,
    scenes: {
      ...vault.scenes,
      [proxyId]: {
        id: proxyId,
        storyId: Object.keys(vault.stories)[0] ?? 'st_main',
        chapterId: null,
        momentId: resolved.targetMomentId,
        title: labelName,
        order: 0,
        prose: '',
      },
    },
  };
  const moved = moveScenes(withProxy, sceneIds, resolved.relation, proxyId);
  if (!moved.ok) return moved;
  const scenes = { ...moved.vault.scenes };
  delete scenes[proxyId];
  return { ok: true, vault: { ...moved.vault, scenes } };
}

/** Helper to add a label to a list of labels without duplicates. */
export function addLabelToList(labels: string[] | undefined, label: string): string[] | undefined {
  const trimmed = label.trim();
  if (!trimmed) return labels;
  const current = labels ?? [];
  const key = normalizeLabelKey(trimmed);
  if (current.some((l) => normalizeLabelKey(l) === key)) return current;
  return [...current, trimmed];
}

/** Helper to remove a label from a list of labels. Returns undefined when empty so optional field is omitted. */
export function removeLabelFromList(labels: string[] | undefined, label: string): string[] | undefined {
  if (!labels) return undefined;
  const key = normalizeLabelKey(label);
  const next = labels.filter((l) => normalizeLabelKey(l) !== key);
  return next.length > 0 ? next : undefined;
}

/** Format moments' Concretes, timeSkips, and Labels for display on the timeline ruler at a column. */
export function momentRulerText(vault: Vault, momentsAtCol: Moment[], scenesAtCol: Scene[]): string | undefined {
  const parts: string[] = [];
  const seen = new Set<string>();
  const pushUnique = (prefix: string, val: string) => {
    const k = `${prefix}:${normalizeLabelKey(val)}`;
    if (!seen.has(k)) {
      seen.add(k);
      parts.push(prefix ? `${prefix} ${val}` : val);
    }
  };

  for (const m of momentsAtCol) {
    const concrete = m.concrete ?? m.label;
    if (concrete) pushUnique('', concrete);
    if (m.timeSkip) pushUnique('⏳', m.timeSkip);
    for (const l of m.labels ?? []) pushUnique('🏷', l);
  }
  for (const s of scenesAtCol) {
    for (const l of s.labels ?? []) pushUnique('🏷', l);
    if (s.chapterId && vault.chapters[s.chapterId]) {
      for (const l of vault.chapters[s.chapterId].labels ?? []) pushUnique('🏷', l);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}
