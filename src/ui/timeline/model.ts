// Timeline layout model: tracks (stories) with clips (scenes), chapter spans and arc spans.

import type { MomentGraph } from '../../core/graph';
import { momentRulerText } from '../../core/labels';
import { layoutTimeline, type Relation } from '../../core/timeline';
import type { Id, Scene, Story, Vault } from '../../core/types';

export interface ClipModel {
  scene: Scene;
  /** Column where the clip starts. */
  col: number;
  /** Columns the clip covers. */
  span: number;
  /** Row inside its track, so clips that overlap in time sit on different rows. */
  stack: number;
  floating: boolean;
}

export interface Span {
  id: Id;
  title: string;
  from: number;
  /** Exclusive end column. */
  to: number;
  count: number;
  /** A chapter or arc that other work cuts into is drawn as several parts: this is the 0-based part and how many there are. */
  part: number;
  parts: number;
}

export interface TrackModel {
  story: Story;
  clips: ClipModel[];
  stacks: number;
  chapters: Span[];
  arcs: Span[];
}

export interface TimelineModel {
  columns: number;
  tracks: TrackModel[];
  /** Column of each scene. */
  colOf: Map<Id, number>;
  /** Scenes by column (all stories). */
  byColumn: Map<number, Scene[]>;
  /** Moment Concretes (dates, seasons…) and event Labels by the column they sit in, in column order. */
  labels: { col: number; text: string }[];
}

/**
 * The parts of a chapter or arc in one track. A part is a run of that group's clips with none of the track's other
 * work starting between them, so a flashback written elsewhere in time makes its own part instead of stretching a bar
 * over everything in between. `clips` must be sorted by column.
 */
function partsOf(clips: ClipModel[], keyOf: (c: ClipModel) => Id | null, titleOf: (id: Id) => string): Span[] {
  const byKey = new Map<Id, ClipModel[]>();
  for (const c of clips) {
    const k = keyOf(c);
    if (k === null) continue;
    let list = byKey.get(k);
    if (!list) byKey.set(k, (list = []));
    list.push(c);
  }
  const startAtOrAfter = (col: number) => {
    let lo = 0;
    let hi = clips.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (clips[mid].col < col) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const out: Span[] = [];
  for (const [id, list] of byKey) {
    const spans: Span[] = [];
    let cur: Span | null = null;
    for (const c of list) {
      const end = c.col + c.span;
      let cut = false;
      if (cur && c.col > cur.to) {
        for (let i = startAtOrAfter(cur.to); i < clips.length && clips[i].col < c.col; i++) {
          if (keyOf(clips[i]) !== id) {
            cut = true;
            break;
          }
        }
      }
      if (cur && !cut) {
        cur.from = Math.min(cur.from, c.col);
        cur.to = Math.max(cur.to, end);
        cur.count++;
      } else spans.push((cur = { id, title: titleOf(id), from: c.col, to: end, count: 1, part: 0, parts: 1 }));
    }
    spans.forEach((sp, i) => {
      sp.part = i;
      sp.parts = spans.length;
    });
    out.push(...spans);
  }
  return out.sort((a, b) => a.from - b.from);
}

export function buildTimelineModel(vault: Vault, graph: MomentGraph, hidden: Id[]): TimelineModel {
  const layout = layoutTimeline(vault, graph);
  const colOf = new Map<Id, number>();
  const byColumn = new Map<number, Scene[]>();
  const perStory = new Map<Id, ClipModel[]>();
  for (const cell of layout.cells) {
    const scene = vault.scenes[cell.sceneId];
    colOf.set(scene.id, cell.column);
    let col = byColumn.get(cell.column);
    if (!col) byColumn.set(cell.column, (col = []));
    col.push(scene);
    let list = perStory.get(scene.storyId);
    if (!list) perStory.set(scene.storyId, (list = []));
    list.push({ scene, col: cell.column, span: cell.span, stack: 0, floating: cell.floating });
  }

  const momentsByCol = new Map<number, import('../../core/types').Moment[]>();
  for (const m of Object.values(vault.moments)) {
    const c = graph.layerOf(m.id);
    let mList = momentsByCol.get(c);
    if (!mList) momentsByCol.set(c, (mList = []));
    mList.push(m);
  }

  const labels: { col: number; text: string }[] = [];
  const allCols = new Set<number>([...byColumn.keys(), ...momentsByCol.keys()]);
  const sortedCols = [...allCols].sort((a, b) => a - b);
  for (const colNum of sortedCols) {
    const colScenes = byColumn.get(colNum) ?? [];
    const colMoments = momentsByCol.get(colNum) ?? [];
    const text = momentRulerText(vault, colMoments, colScenes);
    if (text) labels.push({ col: colNum, text });
  }

  const tracks: TrackModel[] = Object.values(vault.stories)
    .sort((a, b) => a.order - b.order)
    .filter((s) => !hidden.includes(s.id))
    .map((story) => {
      const clips = (perStory.get(story.id) ?? []).sort((a, b) => a.col - b.col || a.scene.order - b.scene.order);
      // Greedy rows: each clip takes the first row whose last clip has ended by its start.
      const rowEnd: number[] = [];
      for (const c of clips) {
        let row = rowEnd.findIndex((end) => end <= c.col);
        if (row < 0) row = rowEnd.length;
        rowEnd[row] = c.col + c.span;
        c.stack = row;
      }
      const stacks = rowEnd.length;
      const chapterOf = (c: ClipModel) => (c.scene.chapterId && vault.chapters[c.scene.chapterId] ? c.scene.chapterId : null);
      const arcOf = (c: ClipModel) => {
        const ch = c.scene.chapterId ? vault.chapters[c.scene.chapterId] : undefined;
        return ch?.arcId && vault.arcs[ch.arcId] ? ch.arcId : null;
      };
      const chapters = partsOf(clips, chapterOf, (id) => vault.chapters[id].title);
      const arcs = partsOf(clips, arcOf, (id) => vault.arcs[id].title);
      return { story, clips, stacks, chapters, arcs };
    });

  return { columns: layout.columns, tracks, colOf, byColumn, labels };
}

/**
 * What a scene dropped or created "in this column" of a track is placed relative to:
 * - a scene starting in the column: the same time as it;
 * - else a clip stretched over the column (any story): during it, at that column;
 * - else right after the clip that ended last before the column;
 * - else (the column is before everything) right before the clip that starts next.
 * Null when the work has no clips to anchor to.
 */
export function targetForColumn(
  vault: Vault,
  model: Pick<TimelineModel, 'colOf' | 'byColumn'>,
  col: number,
  excludeIds: Id[] = [],
): { relation: Relation; sceneId: Id } | null {
  const starting = (model.byColumn.get(col) ?? []).filter((s) => !excludeIds.includes(s.id));
  if (starting.length) return { relation: 'same', sceneId: starting[0].id };
  let running: { start: number; sceneId: Id } | null = null;
  let ended: { end: number; sceneId: Id } | null = null;
  let next: { start: number; sceneId: Id } | null = null;
  for (const [sceneId, start] of model.colOf) {
    const scene = vault.scenes[sceneId];
    if (!scene || excludeIds.includes(sceneId)) continue;
    const end = start + Math.max(1, scene.span ?? 1);
    if (start < col && col < end) {
      if (!running || start > running.start) running = { start, sceneId };
    } else if (end <= col && (!ended || end > ended.end)) ended = { end, sceneId };
    else if (start > col && (!next || start < next.start)) next = { start, sceneId };
  }
  if (running) return { relation: { during: col - running.start }, sceneId: running.sceneId };
  if (ended) return { relation: 'after', sceneId: ended.sceneId };
  return next ? { relation: 'before', sceneId: next.sceneId } : null;
}

/** Geometry in px. Chapter and arc bands are thin labelled strips above the clips; clips are always scene clips. */
export interface Metrics {
  arcBand: number;
  chapterBand: number;
  clipH: number;
  gap: number;
  pad: number;
}

/** Width of the sticky story-name column, and height of the ruler (px). */
export const HEADER_W = 210;
export const RULER_H = 30;
/** Taller ruler when moments carry labels: the labels get a second line under the column numbers. */
export const RULER_LABEL_H = 46;

export const METRICS: Metrics = { arcBand: 16, chapterBand: 20, clipH: 52, gap: 4, pad: 6 };

export function trackHeight(t: TrackModel): number {
  const m = METRICS;
  return Math.max(52, m.pad * 2 + (t.arcs.length ? m.arcBand + 3 : 0) + (t.chapters.length ? m.chapterBand + 3 : 0) + t.stacks * (m.clipH + m.gap));
}

/** "‹ Chapter 2 ›": a mark on each side that has more of the chapter, so a split one reads as connected. */
export function partTitle(span: Pick<Span, 'part' | 'parts'>, text: string): string {
  return `${span.part > 0 ? '‹ ' : ''}${text}${span.part < span.parts - 1 ? ' ›' : ''}`;
}

/** Short form for narrow blocks: "Chapter 12" → "12", "Arc II: Ash" → "II". */
export function shortLabel(title: string): string {
  const m = /^(?:chapter|ch.?|arc|part|book)\s+(\w+)/i.exec(title.trim());
  if (m) return m[1];
  return title.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 3);
}
