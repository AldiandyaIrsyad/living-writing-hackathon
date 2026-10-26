// State resolution: what an entity looks like at a point in relative time.

import { buildGraph, type MomentGraph } from './graph';
import type { Anchor, Id, PropValue, ScalarValue, StateChange, TimePoint, Vault } from './types';
import { isLink } from './types';

export interface PropState {
  value: PropValue;
  /** Scene whose change produced this value; null = base property, or a timeline-anchored change (see `at`). */
  sceneId: Id | null;
  /** Column a timeline-anchored change takes effect from. */
  at?: number;
  changeId: Id | null;
  /** Other values from changes with no known order relative to the winner. */
  ambiguous?: { value: PropValue; sceneId: Id }[];
}

export interface ResolvedEntity {
  entityId: Id;
  exists: boolean;
  props: Record<string, PropState>;
  /** Changes applied, in application order. */
  applied: StateChange[];
  /** Changes whose order relative to the viewed moment is unknown (or simultaneous). */
  unordered: StateChange[];
  /** The entity's page (markdown note) as of this time — base note or the latest applied revision. */
  note: string;
  /** Display name as of this time (base name or the latest applied rename). */
  name: string;
  /** The revision that produced `note`/`name`, if any (null = base page). */
  revision: StateChange | null;
}

/** One version of an entity's page: the base page, then one per revision, in story order. */
export interface PageVersion {
  /** The revision that made this version; null = the base page. */
  change: StateChange | null;
  note: string;
  name: string;
  prevNote: string;
  prevName: string;
}

export interface HistoryEntry {
  change: StateChange;
  before: PropValue | undefined;
  after: PropValue | undefined;
  existsBefore: boolean;
  existsAfter: boolean;
}

export function valueEquals(a: PropValue | undefined, b: PropValue | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => scalarEquals(x, b[i]));
  }
  return scalarEquals(a, b);
}

function scalarEquals(a: ScalarValue, b: ScalarValue): boolean {
  if (isLink(a) && isLink(b)) return a.target.toLowerCase() === b.target.toLowerCase();
  return a === b;
}

export function formatValue(v: PropValue | undefined): string {
  if (v === undefined) return '—';
  if (Array.isArray(v)) return v.map((x) => formatValue(x)).join(', ');
  if (isLink(v)) return `[[${v.target}]]`;
  return String(v);
}

function toList(v: PropValue | undefined): ScalarValue[] {
  if (v === undefined || v === '') return [];
  return Array.isArray(v) ? [...v] : [v];
}

function applyOp(current: PropValue | undefined, c: StateChange): PropValue | undefined {
  switch (c.op) {
    case 'set':
      return c.value;
    case 'remove':
      return undefined;
    case 'add': {
      const list = toList(current);
      for (const item of toList(c.value)) list.push(item);
      return list;
    }
    case 'removeItem': {
      const remove = toList(c.value);
      return toList(current).filter((x) => !remove.some((r) => scalarEquals(r, x)));
    }
    default:
      return current;
  }
}

function timeKey(tp: TimePoint): string {
  if (tp.kind === 'latest') return 'latest';
  if (tp.kind === 'position') return `@${tp.x}`;
  return `${tp.momentId}+${tp.includeSceneId ?? ''}`;
}

/**
 * Resolver bound to one vault snapshot. Cheap to create; caches per (entity, time point).
 * Create a new one whenever the vault changes.
 */
export class Resolver {
  readonly graph: MomentGraph;
  private readonly byEntity = new Map<Id, StateChange[]>();
  private readonly cache = new Map<string, ResolvedEntity>();

  constructor(
    readonly vault: Vault,
    graph?: MomentGraph,
  ) {
    this.graph = graph ?? buildGraph(vault);
    for (const c of Object.values(vault.changes)) {
      if (c.at === undefined && !(c.sceneId && vault.scenes[c.sceneId])) continue;
      let list = this.byEntity.get(c.entityId);
      if (!list) this.byEntity.set(c.entityId, (list = []));
      list.push(c);
    }
    for (const list of this.byEntity.values()) list.sort((a, b) => this.compare(a, b));
  }

  /** The moment of a scene-anchored change's scene; undefined for a timeline-anchored change. */
  momentOfChange(c: StateChange): Id | undefined {
    return c.at === undefined && c.sceneId ? this.vault.scenes[c.sceneId]?.momentId : undefined;
  }

  /** The column a change takes effect from: its own anchor, or the end of its scene's clip. */
  effectiveFrom(c: StateChange): number {
    return c.at ?? (c.sceneId ? this.clipEnd(c.sceneId) : 0);
  }

  /**
   * Deterministic total order: by the column the change takes effect from, which agrees with the partial order
   * (a scene wholly before another ends before it starts). Ties: scene-anchored first, in moment order, then by `order`.
   */
  compare(a: StateChange, b: StateChange): number {
    const fa = this.effectiveFrom(a);
    const fb = this.effectiveFrom(b);
    if (fa !== fb) return fa - fb;
    const ma = this.momentOfChange(a);
    const mb = this.momentOfChange(b);
    if (ma !== undefined && mb !== undefined) {
      const ta = this.graph.topoIndex(ma);
      const tb = this.graph.topoIndex(mb);
      if (ta !== tb) return ta - tb;
      if (a.sceneId !== b.sceneId) return a.sceneId! < b.sceneId! ? -1 : 1;
      return a.order - b.order;
    }
    if (ma !== undefined) return -1;
    if (mb !== undefined) return 1;
    return a.order - b.order || (a.id < b.id ? -1 : 1);
  }

  /**
   * Whether a change counts as made in a scene: it is attached to it, or it sits on the timeline after the scene's
   * clip starts, up to and including the moment it ends. This is what "changes in this scene" means for a change
   * that belongs to no scene.
   */
  fallsIn(c: StateChange, sceneId: Id): boolean {
    if (c.at === undefined) return c.sceneId === sceneId;
    const s = this.vault.scenes[sceneId];
    return !!s && this.graph.layerOf(s.momentId) < c.at && c.at <= this.clipEnd(sceneId);
  }

  changesDuring(entityId: Id, sceneId: Id): StateChange[] {
    return this.changesFor(entityId).filter((c) => this.fallsIn(c, sceneId));
  }

  /** Every change, of any entity, that counts as made in the scene. */
  changesInScene(sceneId: Id): StateChange[] {
    return Object.values(this.vault.changes).filter((c) => this.fallsIn(c, sceneId));
  }

  private sceneEnds?: Map<number, Id[]>;

  /** The scenes a change counts as made in: its own scene, or the clips the timeline column it follows falls in. */
  scenesOfChange(c: StateChange): Id[] {
    if (c.at === undefined) return c.sceneId && this.vault.scenes[c.sceneId] ? [c.sceneId] : [];
    if (!this.sceneEnds) {
      const byColumn = new Map<number, Id[]>();
      for (const s of Object.values(this.vault.scenes)) {
        const from = this.graph.layerOf(s.momentId);
        for (let col = from + 1; col <= this.clipEnd(s.id); col++) {
          const list = byColumn.get(col);
          if (list) list.push(s.id);
          else byColumn.set(col, [s.id]);
        }
      }
      this.sceneEnds = byColumn;
    }
    return this.sceneEnds.get(c.at) ?? [];
  }

  changesFor(entityId: Id): StateChange[] {
    return this.byEntity.get(entityId) ?? [];
  }

  /** Playhead position just before (start) or just after (end) a scene's clip. */
  atClip(sceneId: Id, edge: 'start' | 'end'): TimePoint {
    const s = this.vault.scenes[sceneId];
    if (!s) return { kind: 'latest' };
    return { kind: 'position', x: edge === 'start' ? this.graph.layerOf(s.momentId) : this.clipEnd(sceneId) };
  }

  /** The column where a scene's clip ends: its start plus its own span. Its changes take effect here. */
  clipEnd(sceneId: Id): number {
    const s = this.vault.scenes[sceneId];
    return this.graph.layerOf(s.momentId) + Math.max(1, s.span ?? 1);
  }

  atScene(sceneId: Id, includeOwn = false): TimePoint {
    const s = this.vault.scenes[sceneId];
    if (!s) return { kind: 'latest' };
    return includeOwn ? { kind: 'moment', momentId: s.momentId, includeSceneId: sceneId } : { kind: 'moment', momentId: s.momentId };
  }

  entityAt(entityId: Id, tp: TimePoint): ResolvedEntity {
    const key = `${entityId}|${timeKey(tp)}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const result = this.compute(entityId, (c) => this.classify(c, tp));
    this.cache.set(key, result);
    return result;
  }

  /**
   * The entity as it stood just before an edit anchored here: every change that sorts earlier. For a scene this is
   * the state entering it; on the timeline, what took effect before that column, plus scene-anchored changes
   * ending in it (they sort ahead of timeline ones there).
   */
  entityBefore(entityId: Id, anchor: Anchor): ResolvedEntity {
    if (!('at' in anchor)) return this.entityAt(entityId, this.atScene(anchor.sceneId, false));
    const key = `${entityId}|<${anchor.at}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const probe: StateChange = { id: '', entityId, op: 'note', at: anchor.at, order: -Infinity };
    const result = this.compute(entityId, (c) => (this.compare(c, probe) < 0 ? 'applied' : null));
    this.cache.set(key, result);
    return result;
  }

  /** Whether a change has happened at a time point, or is of unknown order against it. */
  private classify(c: StateChange, tp: TimePoint): 'applied' | 'unordered' | null {
    if (tp.kind === 'latest') return 'applied';
    if (tp.kind === 'position') return this.effectiveFrom(c) <= tp.x ? 'applied' : null;
    const m = this.momentOfChange(c);
    if (m === undefined) {
      // On the timeline: it has happened once the viewed moment starts, or, "just after this scene", once that scene ends.
      const x = tp.includeSceneId !== undefined && this.vault.scenes[tp.includeSceneId] ? this.clipEnd(tp.includeSceneId) : this.graph.layerOf(tp.momentId);
      return c.at! <= x ? 'applied' : null;
    }
    if (c.sceneId === tp.includeSceneId || this.graph.isBefore(m, tp.momentId)) return 'applied';
    return this.graph.isBefore(tp.momentId, m) ? null : 'unordered';
  }

  private compute(entityId: Id, decide: (c: StateChange) => 'applied' | 'unordered' | null): ResolvedEntity {
    const entity = this.vault.entities[entityId];
    const all = this.changesFor(entityId);
    const applied: StateChange[] = [];
    const unordered: StateChange[] = [];
    for (const c of all) {
      const d = decide(c);
      if (d === 'applied') applied.push(c);
      else if (d === 'unordered') unordered.push(c);
    }

    const props: Record<string, PropState> = {};
    for (const [k, v] of Object.entries(entity?.props ?? {})) props[k] = { value: v, sceneId: null, changeId: null };
    let exists = !all.some((c) => c.op === 'create');
    let note = entity?.note ?? '';
    let name = entity?.name ?? '';
    let revision: StateChange | null = null;
    // Last change per (property, scene) — candidates for ambiguity detection.
    const lastByProp = new Map<string, Map<Id, StateChange>>();

    for (const c of applied) {
      if (c.op === 'revise') {
        if (c.note !== undefined) note = c.note;
        if (c.rename !== undefined) name = c.rename;
        revision = c;
        continue;
      }
      if (c.op === 'create') {
        exists = true;
        continue;
      }
      if (c.op === 'retire') {
        exists = false;
        continue;
      }
      if (!c.property) continue;
      const next = applyOp(props[c.property]?.value, c);
      if (next === undefined) delete props[c.property];
      else props[c.property] = c.sceneId !== undefined && c.at === undefined ? { value: next, sceneId: c.sceneId, changeId: c.id } : { value: next, sceneId: null, at: c.at, changeId: c.id };
      if (c.at !== undefined || c.sceneId === undefined) {
        // A change on the timeline is ordered against everything: it settles any earlier disagreement.
        lastByProp.delete(c.property);
        continue;
      }
      let perScene = lastByProp.get(c.property);
      if (!perScene) lastByProp.set(c.property, (perScene = new Map()));
      perScene.set(c.sceneId, c);
    }

    for (const [prop, perScene] of lastByProp) {
      if (perScene.size < 2) continue;
      const cands = [...perScene.values()];
      const maximal = cands.filter(
        (c) => !cands.some((o) => o !== c && this.graph.isBefore(this.momentOfChange(c)!, this.momentOfChange(o)!)),
      );
      if (maximal.length < 2) continue;
      const winner = props[prop];
      const others = maximal
        .filter((c) => c.id !== winner?.changeId)
        .filter((c) => !valueEquals(applyOp(undefined, c), winner?.value));
      if (others.length && winner) {
        winner.ambiguous = others.map((c) => ({ value: applyOp(undefined, c) ?? '', sceneId: c.sceneId! }));
      }
    }

    return { entityId, exists, props, applied, unordered, note, name, revision };
  }

  /** The page's versions in story order: the base page first, then each revision. */
  pageHistory(entityId: Id): PageVersion[] {
    const entity = this.vault.entities[entityId];
    let note = entity?.note ?? '';
    let name = entity?.name ?? '';
    const out: PageVersion[] = [{ change: null, note, name, prevNote: '', prevName: '' }];
    for (const c of this.changesFor(entityId)) {
      if (c.op !== 'revise') continue;
      const prevNote = note;
      const prevName = name;
      if (c.note !== undefined) note = c.note;
      if (c.rename !== undefined) name = c.rename;
      out.push({ change: c, note, name, prevNote, prevName });
    }
    return out;
  }

  /** Every change to the entity in chronological order with before/after values. */
  history(entityId: Id): HistoryEntry[] {
    const entity = this.vault.entities[entityId];
    const values: Record<string, PropValue | undefined> = { ...(entity?.props ?? {}) };
    const changes = this.changesFor(entityId);
    let exists = !changes.some((c) => c.op === 'create');
    return changes.map((c) => {
      const existsBefore = exists;
      const before = c.property ? values[c.property] : undefined;
      if (c.op === 'create') exists = true;
      else if (c.op === 'retire') exists = false;
      else if (c.property) values[c.property] = applyOp(before, c);
      return { change: c, before, after: c.property ? values[c.property] : undefined, existsBefore, existsAfter: exists };
    });
  }
}
