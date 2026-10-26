// The moment graph: a partial order of moments built from `before → after` constraints.
//
// Every edge has a length in columns: how far `after` starts from the start of `before`. Layers are
// longest paths over those lengths, so a moment's column is where its chain of clips has got to.
// Two reachability relations are precomputed as ancestor bitsets so queries are O(1):
// - `isBefore` means wholly before: `b` begins once `a` has ended. A strict edge gives that directly; a
//   "during" edge (length < the span of `before`) does not, but still carries on what is wholly before
//   `before` (a chain ending in a during-edge keeps its earlier part wholly before).
// - `wouldCycle` follows every edge: a during-edge is still an ordering.

import { concreteEdges } from './concrete';
import type { Id, Vault } from './types';

export interface Edge {
  before: Id;
  after: Id;
  /** Columns from the start of `before` to the start of `after`. Default: the span of `before`. */
  weight?: number;
  /** Strict edges make `before` happen before `after`. Default: weight >= the span of `before`. */
  strict?: boolean;
}

interface PredEdge {
  from: number;
  weight: number;
  strict: boolean;
}

class MinHeap {
  private a: number[] = [];
  get size() {
    return this.a.length;
  }
  push(v: number) {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p] <= a[i]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l] < a[m]) m = l;
        if (r < a.length && a[r] < a[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export class MomentGraph {
  /** Moment ids in deterministic topological order. */
  readonly order: Id[];
  /** Position of each moment in `order`. */
  readonly index: Map<Id, number>;
  /** Longest-path layer (0 = no predecessors): the first column the moment starts in. */
  readonly layer: number[];
  /** Span of each moment (by topo position): the largest span of the scenes at it, default 1. */
  private readonly spanAt: number[];
  /** Ids involved in a cycle, if the constraints are inconsistent (should never be persisted). */
  readonly cycle: Id[] | null;
  private readonly preds: PredEdge[][];
  private readonly succs: number[][];
  /**
   * Moments wholly before this moment's start (for isBefore): everything before a strict pred, the strict
   * preds themselves, and everything before a during-pred (it starts no earlier than that pred).
   */
  private readonly anc: Uint32Array[];
  private readonly words: number;
  private readonly constrained: Set<Id>;

  constructor(momentIds: Iterable<Id>, edges: Iterable<Edge>, spans: ReadonlyMap<Id, number> = new Map()) {
    const ids = [...new Set(momentIds)].sort();
    const tmpIndex = new Map(ids.map((id, i) => [id, i]));
    const n = ids.length;
    const spanOfId = (id: Id) => Math.max(1, spans.get(id) ?? 1);
    // One entry per ordered pair: parallel edges merge into the longest, and any strict one makes it strict.
    const merged = new Map<string, { a: number; b: number; weight: number; strict: boolean }>();
    this.constrained = new Set();
    for (const e of edges) {
      const a = tmpIndex.get(e.before);
      const b = tmpIndex.get(e.after);
      if (a === undefined || b === undefined) continue;
      this.constrained.add(e.before);
      this.constrained.add(e.after);
      const weight = Math.max(0, e.weight ?? spanOfId(e.before));
      const strict = e.strict ?? weight >= spanOfId(e.before);
      const key = `${a}>${b}`;
      const prev = merged.get(key);
      if (prev) {
        prev.weight = Math.max(prev.weight, weight);
        prev.strict = prev.strict || strict;
      } else merged.set(key, { a, b, weight, strict });
    }
    const outs: { to: number; weight: number; strict: boolean }[][] = ids.map(() => []);
    const indeg = new Array<number>(n).fill(0);
    for (const e of merged.values()) {
      outs[e.a].push({ to: e.b, weight: e.weight, strict: e.strict });
      indeg[e.b]++;
    }

    // Kahn's algorithm, ties broken by sorted id → deterministic.
    const heap = new MinHeap();
    for (let i = 0; i < n; i++) if (indeg[i] === 0) heap.push(i);
    const topo: number[] = [];
    while (heap.size) {
      const v = heap.pop();
      topo.push(v);
      for (const w of outs[v]) if (--indeg[w.to] === 0) heap.push(w.to);
    }
    let cycle: Id[] | null = null;
    if (topo.length < n) {
      const inTopo = new Set(topo);
      const rest: number[] = [];
      for (let i = 0; i < n; i++) if (!inTopo.has(i)) rest.push(i);
      cycle = rest.map((i) => ids[i]);
      topo.push(...rest);
    }
    this.cycle = cycle;

    // Re-index by topological position.
    const pos = new Array<number>(n);
    topo.forEach((v, p) => (pos[v] = p));
    this.order = topo.map((v) => ids[v]);
    this.index = new Map(this.order.map((id, p) => [id, p]));
    this.spanAt = this.order.map((id) => spanOfId(id));
    this.succs = this.order.map(() => []);
    this.preds = this.order.map(() => []);
    for (let v = 0; v < n; v++) {
      for (const w of outs[v]) {
        this.succs[pos[v]].push(pos[w.to]);
        this.preds[pos[w.to]].push({ from: pos[v], weight: w.weight, strict: w.strict });
      }
    }

    this.words = Math.max(1, Math.ceil(n / 32));
    this.anc = new Array(n);
    this.layer = new Array<number>(n).fill(0);
    for (let p = 0; p < n; p++) {
      const strictBits = new Uint32Array(this.words);
      let layer = 0;
      for (const { from: q, weight, strict } of this.preds[p]) {
        if (q >= p) continue; // only possible inside a cycle
        // Whatever is wholly before q's start is wholly before p's start too (p never starts before q does).
        const qa = this.anc[q];
        for (let w = 0; w < this.words; w++) strictBits[w] |= qa[w];
        // q itself is wholly before p only when p starts after q has ended.
        if (strict) strictBits[q >> 5] |= 1 << (q & 31);
        if (this.layer[q] + weight > layer) layer = this.layer[q] + weight;
      }
      this.anc[p] = strictBits;
      this.layer[p] = layer;
    }
  }

  has(id: Id): boolean {
    return this.index.has(id);
  }

  /** True if moment `a` is strictly before moment `b`: a chain of strict edges leads from a to b. */
  isBefore(a: Id, b: Id): boolean {
    const pa = this.index.get(a);
    const pb = this.index.get(b);
    if (pa === undefined || pb === undefined || pa === pb) return false;
    return (this.anc[pb][pa >> 5] & (1 << (pa & 31))) !== 0;
  }

  /** True if any chain of constraints (strict or during) leads from `a` to `b`. A search, so it is only used for edits. */
  reaches(a: Id, b: Id): boolean {
    const pa = this.index.get(a);
    const pb = this.index.get(b);
    if (pa === undefined || pb === undefined || pa === pb) return false;
    const seen = new Uint8Array(this.order.length);
    const stack = [pa];
    seen[pa] = 1;
    while (stack.length) {
      for (const w of this.succs[stack.pop()!]) {
        if (w === pb) return true;
        if (!seen[w]) {
          seen[w] = 1;
          stack.push(w);
        }
      }
    }
    return false;
  }

  /** Neither before nor after each other, and not the same moment. */
  isUnordered(a: Id, b: Id): boolean {
    return a !== b && !this.isBefore(a, b) && !this.isBefore(b, a);
  }

  topoIndex(id: Id): number {
    return this.index.get(id) ?? -1;
  }

  layerOf(id: Id): number {
    const p = this.index.get(id);
    return p === undefined ? 0 : this.layer[p];
  }

  /** Columns the moment's scenes take up: the largest span of them, default 1. */
  spanOf(id: Id): number {
    const p = this.index.get(id);
    return p === undefined ? 1 : this.spanAt[p];
  }

  /** The first column after the moment's clips: layer + span. */
  endOf(id: Id): number {
    return this.layerOf(id) + this.spanOf(id);
  }

  directPreds(id: Id): Id[] {
    const p = this.index.get(id);
    return p === undefined ? [] : this.preds[p].map((e) => this.order[e.from]);
  }

  directSuccs(id: Id): Id[] {
    const p = this.index.get(id);
    return p === undefined ? [] : this.succs[p].map((q) => this.order[q]);
  }

  /** Moments that take part in no constraint at all. */
  isFloating(id: Id): boolean {
    return this.has(id) && !this.constrained.has(id);
  }

  /** Adding `before → after` would create a cycle (during-edges count as orderings). */
  wouldCycle(before: Id, after: Id): boolean {
    return before === after || this.reaches(after, before);
  }

  /** Columns needed to show every clip: the largest end over all moments. */
  get columns(): number {
    let max = 0;
    for (let p = 0; p < this.layer.length; p++) max = Math.max(max, this.layer[p] + this.spanAt[p]);
    return max;
  }
}

/**
 * Builds the graph from a vault. A moment's span is the largest span of the scenes at it. A constraint
 * with an `offset` is a during-edge of that length; without one it runs from the end of `before`, and
 * the edge is strict unless the offset is shorter than the span of `before`.
 */
export function buildGraph(vault: Pick<Vault, 'moments' | 'constraints'> & { scenes?: Vault['scenes'] }): MomentGraph {
  const spans = new Map<Id, number>();
  for (const s of Object.values(vault.scenes ?? {})) {
    const span = Math.max(1, s.span ?? 1);
    if (span > (spans.get(s.momentId) ?? 1)) spans.set(s.momentId, span);
  }
  const edges: Edge[] = [];
  for (const c of Object.values(vault.constraints)) {
    const span = spans.get(c.before) ?? 1;
    edges.push({
      before: c.before,
      after: c.after,
      weight: c.offset ?? span,
      strict: c.offset === undefined || c.offset >= span,
    });
  }
  for (const ce of concreteEdges(vault.moments)) {
    const span = spans.get(ce.before) ?? 1;
    edges.push({
      before: ce.before,
      after: ce.after,
      weight: span,
      strict: true,
    });
  }
  return new MomentGraph(Object.keys(vault.moments), edges, spans);
}
