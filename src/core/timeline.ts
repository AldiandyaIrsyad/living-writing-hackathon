// Timeline operations: placing scenes in relative time. All functions are pure and return new vaults.

import { buildGraph, type MomentGraph } from './graph';
import type { Constraint, Id, Moment, Scene, Vault } from './types';
import { newId } from './types';

/**
 * Where a dragged block goes relative to a target scene:
 * - before / after: wholly before / after the target's clip.
 * - same: the same moment (one column).
 * - during: starts `during` columns after the target's start, overlapping it (0 = the same start).
 */
export type Relation = 'before' | 'after' | 'same' | { during: number };
export type PlaceResult = { ok: true; vault: Vault } | { ok: false; error: string };

type Ordering = Exclude<Relation, 'same'>;

const TIMELINE = 'main';

/** Shallow-copy the collections that timeline ops mutate. New identities also invalidate the graph cache. */
function draft(v: Vault): Vault {
  return { ...v, moments: { ...v.moments }, constraints: { ...v.constraints }, scenes: { ...v.scenes } };
}

function validOffset(offset: number): boolean {
  return Number.isFinite(offset) && offset >= 0;
}

/**
 * Mutates the draft. Adds `before → after`, or a during-edge of `offset` columns when given, unless that
 * exact rule exists. A new during-edge replaces an older during-edge between the same two moments.
 */
function addEdge(v: Vault, before: Id, after: Id, offset?: number): void {
  if (before === after) return;
  const same = Object.values(v.constraints).filter((c) => c.before === before && c.after === after);
  if (same.some((c) => c.offset === offset)) return;
  if (offset !== undefined) for (const c of same) if (c.offset !== undefined) delete v.constraints[c.id];
  const c: Constraint = { id: newId('c'), before, after, timelineId: TIMELINE };
  if (offset !== undefined) c.offset = offset;
  v.constraints[c.id] = c;
}

function scenesAt(v: Vault, momentId: Id): Scene[] {
  return Object.values(v.scenes).filter((s) => s.momentId === momentId);
}

/**
 * Mutates the draft. Deletes a moment, keeping the order of everything around it:
 * every predecessor stays before every successor.
 */
function removeMomentBridged(v: Vault, momentId: Id): void {
  const touching = Object.values(v.constraints).filter((c) => c.before === momentId || c.after === momentId);
  const preds = touching.filter((c) => c.after === momentId).map((c) => c.before);
  const succs = touching.filter((c) => c.before === momentId).map((c) => c.after);
  for (const c of touching) delete v.constraints[c.id];
  delete v.moments[momentId];
  for (const p of preds) for (const s of succs) addEdge(v, p, s);
}

function isStandaloneMilestone(m: Moment | undefined): boolean {
  if (!m) return false;
  return Boolean(m.concrete || m.label || (m.labels && m.labels.length > 0));
}

function removeEmptyMoments(v: Vault, candidates: Iterable<Id>): void {
  for (const m of new Set(candidates)) {
    if (v.moments[m] && scenesAt(v, m).length === 0 && !isStandaloneMilestone(v.moments[m])) {
      removeMomentBridged(v, m);
    }
  }
}

function cycleError(v: Vault, g: MomentGraph): string {
  const names = (g.cycle ?? [])
    .flatMap((m) => scenesAt(v, m).map((s) => `"${s.title}"`))
    .slice(0, 4)
    .join(', ');
  return `That would create a time loop${names ? ` between ${names}` : ''}: a scene can't happen both before and after another.`;
}

function finish(v: Vault): PlaceResult {
  const g = buildGraph(v);
  return g.cycle ? { ok: false, error: cycleError(v, g) } : { ok: true, vault: v };
}

/**
 * Mutates the draft. Attaches a detached block of moments to the target moment: wholly after it, wholly
 * before it, or during it (each block source starts `during` columns after the target starts).
 */
function attach(v: Vault, block: Id[], relation: Ordering, target: Id): void {
  const blockSet = new Set(block);
  const internal = Object.values(v.constraints).filter((c) => blockSet.has(c.before) && blockSet.has(c.after));
  const sources = block.filter((m) => !internal.some((c) => c.after === m));
  const sinks = block.filter((m) => !internal.some((c) => c.before === m));
  if (typeof relation === 'object') {
    for (const s of sources) addEdge(v, target, s, relation.during);
    return;
  }
  // Only end-to-start neighbours shape "right before / right after"; during-edges of the target are not inherited.
  const plain = Object.values(v.constraints).filter((c) => c.offset === undefined);
  if (relation === 'after') {
    const succs = plain.filter((c) => c.before === target && !blockSet.has(c.after)).map((c) => c.after);
    for (const s of sources) addEdge(v, target, s);
    for (const k of sinks) for (const s of succs) addEdge(v, k, s);
  } else {
    const preds = plain.filter((c) => c.after === target && !blockSet.has(c.before)).map((c) => c.before);
    for (const k of sinks) addEdge(v, k, target);
    for (const s of sources) for (const p of preds) addEdge(v, p, s);
  }
}

/**
 * Move mode: detach the scenes from where they are in time and drop them right before / right after /
 * at the same time as / during the target scene. Their order relative to each other is kept.
 */
export function moveScenes(vault: Vault, sceneIds: Id[], relation: Relation, targetSceneId: Id): PlaceResult {
  const target = vault.scenes[targetSceneId];
  if (!target) return { ok: false, error: 'Target scene not found.' };
  const moving = sceneIds.map((id) => vault.scenes[id]).filter((s): s is Scene => !!s);
  if (!moving.length) return { ok: false, error: 'Nothing to move.' };
  if (moving.some((s) => s.id === targetSceneId)) return { ok: false, error: "Can't place scenes relative to themselves." };
  if (typeof relation === 'object' && !validOffset(relation.during)) return { ok: false, error: 'Invalid position inside the scene.' };

  const v = draft(vault);
  const oldMoments = [...new Set(moving.map((s) => s.momentId))];

  if (relation === 'same') {
    for (const s of moving) {
      const next: Scene = { ...s, momentId: target.momentId };
      delete next.someday;
      v.scenes[s.id] = next;
    }
    removeEmptyMoments(v, oldMoments.filter((m) => m !== target.momentId));
    return finish(v);
  }

  // Fresh moments for the moving scenes, preserving their internal order.
  const g = buildGraph(vault);
  const oldSet = new Set(oldMoments);
  const fresh = new Map<Id, Id>();
  for (const m of oldMoments) {
    const nm: Moment = { id: newId('m'), timelineId: vault.moments[m]?.timelineId ?? TIMELINE };
    const label = vault.moments[m]?.label;
    const concrete = vault.moments[m]?.concrete;
    const labels = vault.moments[m]?.labels;
    const timeSkip = vault.moments[m]?.timeSkip;
    if (label !== undefined) nm.label = label;
    if (concrete !== undefined) nm.concrete = concrete;
    if (labels !== undefined) nm.labels = [...labels];
    if (timeSkip !== undefined) nm.timeSkip = timeSkip;
    v.moments[nm.id] = nm;
    fresh.set(m, nm.id);
  }
  for (const a of oldMoments)
    for (const b of oldMoments) {
      if (!g.isBefore(a, b)) continue;
      const implied = oldMoments.some((c) => g.isBefore(a, c) && g.isBefore(c, b));
      if (!implied) addEdge(v, fresh.get(a)!, fresh.get(b)!);
    }
  // During-edges inside the block are not "before", so they are copied as they are.
  for (const c of Object.values(vault.constraints)) {
    if (c.offset !== undefined && oldSet.has(c.before) && oldSet.has(c.after)) {
      addEdge(v, fresh.get(c.before)!, fresh.get(c.after)!, c.offset);
    }
  }
  for (const s of moving) {
    const next: Scene = { ...s, momentId: fresh.get(s.momentId)! };
    delete next.someday;
    v.scenes[s.id] = next;
  }
  removeEmptyMoments(v, oldMoments);
  attach(v, [...fresh.values()], relation, target.momentId);
  return finish(v);
}

/**
 * Constrain mode: keep existing placement and only add an ordering rule. This can fail if the rule
 * contradicts what is already known (a time loop).
 */
export function constrainScenes(vault: Vault, sceneIds: Id[], relation: Relation, targetSceneId: Id): PlaceResult {
  const target = vault.scenes[targetSceneId];
  if (!target) return { ok: false, error: 'Target scene not found.' };
  const moving = sceneIds.map((id) => vault.scenes[id]).filter((s): s is Scene => !!s && s.id !== targetSceneId);
  if (!moving.length) return { ok: false, error: "Can't place a scene relative to itself." };
  if (typeof relation === 'object' && !validOffset(relation.during)) return { ok: false, error: 'Invalid position inside the scene.' };
  const T = target.momentId;
  const g = buildGraph(vault);
  const v = draft(vault);

  if (relation === 'same') {
    for (const s of moving) {
      const m = s.momentId;
      if (m === T) continue;
      if (g.reaches(m, T) || g.reaches(T, m)) {
        return { ok: false, error: cycleError(v, { cycle: [m, T] } as MomentGraph) };
      }
      const next: Scene = { ...s, momentId: T };
      delete next.someday;
      v.scenes[s.id] = next;
      if (scenesAt(v, m).length === 0) {
        // Merge the emptied moment into the target, keeping its constraints.
        for (const c of Object.values(v.constraints)) {
          if (c.before === m || c.after === m) {
            delete v.constraints[c.id];
            addEdge(v, c.before === m ? T : c.before, c.after === m ? T : c.after, c.offset);
          }
        }
        delete v.moments[m];
      }
    }
    return finish(v);
  }

  for (const s of moving) {
    if (s.someday) {
      const next: Scene = { ...s };
      delete next.someday;
      v.scenes[s.id] = next;
    }
    if (typeof relation === 'object') {
      // Already at the same moment: there is no "during" to add.
      if (s.momentId === T) continue;
      if (g.wouldCycle(T, s.momentId)) return { ok: false, error: cycleError(v, { cycle: [T, s.momentId] } as MomentGraph) };
      addEdge(v, T, s.momentId, relation.during);
      continue;
    }
    const [before, after] = relation === 'after' ? [T, s.momentId] : [s.momentId, T];
    if (g.wouldCycle(before, after)) return { ok: false, error: cycleError(v, { cycle: [before, after] } as MomentGraph) };
    addEdge(v, before, after);
  }
  return finish(v);
}

/** Add a moment-level constraint (from a placement panel). */
export function addConstraint(vault: Vault, before: Id, after: Id): PlaceResult {
  const g = buildGraph(vault);
  const v = draft(vault);
  if (g.wouldCycle(before, after)) return { ok: false, error: cycleError(v, { cycle: [before, after] } as MomentGraph) };
  addEdge(v, before, after);
  return finish(v);
}

export function removeConstraint(vault: Vault, constraintId: Id): Vault {
  const constraints = { ...vault.constraints };
  delete constraints[constraintId];
  return { ...vault, constraints };
}

/**
 * Stretch or shorten a scene's clip to `span` columns (rounded, at least 1; 1 removes the key).
 * This changes the layout only: order is unchanged, but later clips move to the end of this one.
 */
export function setSceneSpan(vault: Vault, sceneId: Id, span: number): Vault {
  const s = vault.scenes[sceneId];
  if (!s) return vault;
  const n = Number.isFinite(span) ? Math.max(1, Math.round(span)) : 1;
  const v = draft(vault);
  const next: Scene = { ...s };
  if (n === 1) delete next.span;
  else next.span = n;
  v.scenes[sceneId] = next;
  return v;
}

/**
 * Open an empty column at `col`: everything that starts at or after it moves one column right, in every
 * story, and nothing before it moves. A scene stretched across the cut grows by one column instead of
 * moving. Only ordering rules change (their lengths), except at column 0, which needs a spacer moment (see
 * `openLeadingColumn`). Columns past the end have nothing to open a gap before, so the vault comes back unchanged.
 */
export function insertColumn(vault: Vault, col: number): Vault {
  const g = buildGraph(vault);
  if (!Number.isInteger(col) || col < 0 || col >= g.columns) return vault;
  if (col === 0) return openLeadingColumn(vault, g);
  const v = draft(vault);
  // A scene that covers the cut grows; the rules leaving it by "end of this scene" then follow on their own.
  const growing = new Set<Id>();
  for (const s of Object.values(vault.scenes)) {
    const start = g.layerOf(s.momentId);
    if (start < col && col < start + Math.max(1, s.span ?? 1)) {
      v.scenes[s.id] = { ...s, span: Math.max(1, s.span ?? 1) + 1 };
      growing.add(s.momentId);
    }
  }
  for (const c of Object.values(vault.constraints)) {
    const start = g.layerOf(c.before);
    const length = c.offset ?? g.spanOf(c.before);
    // Only rules whose target sits at or past the cut, from a start before it, stretch by one.
    if (start >= col || start + length < col) continue;
    if (c.offset === undefined && growing.has(c.before)) continue;
    v.constraints[c.id] = { ...c, offset: length + 1 };
  }
  return shiftAnchored(v, col, 1);
}

/**
 * The spacer: the scene-less moment that holds the empty columns before the first scene. Positions are relative, so
 * room before everything can only exist as a moment of its own, with a rule of N columns to each scene that starts
 * the timeline. At most one exists.
 */
function spacerOf(vault: Vault, g: MomentGraph): Id | undefined {
  return Object.keys(vault.moments).find(
    (m) => scenesAt(vault, m).length === 0 && !isStandaloneMilestone(vault.moments[m]) && g.directPreds(m).length === 0 && g.directSuccs(m).length > 0,
  );
}

/** Column 0: everything placed in time moves one column right, and the empty column 0 is the spacer's. */
function openLeadingColumn(vault: Vault, g: MomentGraph): Vault {
  const spacer = spacerOf(vault, g);
  // Placed scenes with nothing before them start the timeline. Floating scenes are not placed in time, so they stay.
  const starts = Object.keys(vault.moments).filter((m) => m !== spacer && scenesAt(vault, m).length > 0 && !g.isFloating(m) && g.directPreds(m).length === 0);
  if (!spacer && starts.length === 0) return vault;
  const v = draft(vault);
  const spacerId = spacer ?? newId('m');
  if (!spacer) v.moments[spacerId] = { id: spacerId, timelineId: TIMELINE };
  // Whatever the spacer already holds back grows by one, then each scene that starts the timeline gets its own rule.
  for (const c of Object.values(vault.constraints)) {
    if (c.before === spacerId) v.constraints[c.id] = { ...c, offset: (c.offset ?? 1) + 1 };
  }
  for (const m of starts) addEdge(v, spacerId, m, 1);
  return shiftAnchored(v, 0, 1);
}

/** Closes the empty column 0 the spacer holds: its rules each get one column shorter, and it goes when none are left. */
function closeLeadingColumn(vault: Vault, g: MomentGraph): Vault {
  const spacer = spacerOf(vault, g);
  if (!spacer) return vault;
  for (const s of Object.values(vault.scenes)) if (g.layerOf(s.momentId) === 0 && !g.isFloating(s.momentId)) return vault;
  const v = draft(vault);
  for (const c of Object.values(vault.constraints)) {
    if (c.before !== spacer) continue;
    const length = (c.offset ?? 1) - 1;
    if (length < 1) delete v.constraints[c.id];
    else v.constraints[c.id] = { ...c, offset: length };
  }
  if (!Object.values(v.constraints).some((c) => c.before === spacer)) delete v.moments[spacer];
  return shiftAnchored(v, 0, -1);
}

/** Timeline-anchored changes after the cut move with the content: a change taking effect past column `col` shifts by `by`. */
function shiftAnchored(v: Vault, col: number, by: 1 | -1): Vault {
  let changes = v.changes;
  for (const c of Object.values(v.changes)) {
    if (c.at === undefined || c.at <= col) continue;
    if (changes === v.changes) changes = { ...v.changes };
    changes[c.id] = { ...c, at: c.at + by };
  }
  return changes === v.changes ? v : { ...v, changes };
}

/**
 * The inverse of insertColumn: close an empty column, moving everything after it one column left. Only a column
 * no scene starts in or stretches across can close; any other (or one past the ends) comes back unchanged.
 */
export function removeColumn(vault: Vault, col: number): Vault {
  const g = buildGraph(vault);
  if (!Number.isInteger(col) || col < 0 || col >= g.columns) return vault;
  if (col === 0) return closeLeadingColumn(vault, g);
  for (const s of Object.values(vault.scenes)) {
    const start = g.layerOf(s.momentId);
    if (start <= col && col < start + Math.max(1, s.span ?? 1)) return vault;
  }
  const v = draft(vault);
  for (const c of Object.values(vault.constraints)) {
    const start = g.layerOf(c.before);
    const length = c.offset ?? g.spanOf(c.before);
    // The mirror of insertColumn: rules that run from before the gap to past it get one column shorter.
    if (start >= col || start + length <= col) continue;
    const next = { ...c };
    if (length - 1 === g.spanOf(c.before)) delete next.offset;
    else next.offset = length - 1;
    v.constraints[c.id] = next;
  }
  return shiftAnchored(v, col, -1);
}

export interface NewSceneFields {
  storyId: Id;
  title: string;
  chapterId?: Id | null;
  prose?: string;
}

/**
 * Create a scene placed relative to a target scene (or floating when no target). The new scene goes
 * at the end of its story's telling order.
 */
export function insertScene(
  vault: Vault,
  fields: NewSceneFields,
  relation: Relation | null,
  targetSceneId: Id | null,
): { vault: Vault; sceneId: Id } {
  const v = draft(vault);
  const target = targetSceneId ? vault.scenes[targetSceneId] : undefined;
  const order = Math.max(-1, ...Object.values(vault.scenes).filter((s) => s.storyId === fields.storyId).map((s) => s.order)) + 1;
  let momentId: Id;
  if (target && relation === 'same') momentId = target.momentId;
  else {
    const m: Moment = { id: newId('m'), timelineId: TIMELINE };
    v.moments[m.id] = m;
    momentId = m.id;
  }
  const scene: Scene = {
    id: newId('sc'),
    storyId: fields.storyId,
    chapterId: fields.chapterId ?? null,
    title: fields.title,
    prose: fields.prose ?? '',
    momentId,
    order,
  };
  v.scenes[scene.id] = scene;
  if (target && relation && relation !== 'same') attach(v, [momentId], relation, target.momentId);
  return { vault: v, sceneId: scene.id };
}

/** Delete a scene, the changes attached to it, and its moment if no other scene uses it (bridging the order). */
export function deleteScene(vault: Vault, sceneId: Id): Vault {
  const s = vault.scenes[sceneId];
  if (!s) return vault;
  const v = draft(vault);
  delete v.scenes[sceneId];
  const changes = { ...vault.changes };
  for (const c of Object.values(changes)) if (c.sceneId === sceneId) delete changes[c.id];
  v.changes = changes;
  // A scene that is gone cannot be revisited.
  const reviewItems = { ...vault.reviewItems };
  for (const item of Object.values(reviewItems)) if (item.sceneId === sceneId) delete reviewItems[item.id];
  v.reviewItems = reviewItems;
  removeEmptyMoments(v, [s.momentId]);
  return v;
}

export interface TimelineCell {
  sceneId: Id;
  storyId: Id;
  momentId: Id;
  /** Column where the clip starts. */
  column: number;
  /** Columns the clip covers (default 1). */
  span: number;
  floating: boolean;
}

export interface TimelineLayout {
  columns: number;
  cells: TimelineCell[];
}

export function layoutTimeline(vault: Vault, graph: MomentGraph = buildGraph(vault)): TimelineLayout {
  const momentCount = Object.keys(vault.moments).length;
  const cells = Object.values(vault.scenes)
    .filter((s) => !s.someday)
    .map((s) => ({
      sceneId: s.id,
      storyId: s.storyId,
      momentId: s.momentId,
      column: graph.layerOf(s.momentId),
      span: Math.max(1, s.span ?? 1),
      floating: momentCount > 1 && graph.isFloating(s.momentId),
    }))
    .sort((a, b) => a.column - b.column || graph.topoIndex(a.momentId) - graph.topoIndex(b.momentId));
  return { columns: Math.max(graph.columns, 1), cells };
}
