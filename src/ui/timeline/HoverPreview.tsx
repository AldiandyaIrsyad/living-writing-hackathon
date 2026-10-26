// Hover preview over the timeline: a ghost line at the column under the cursor and a tooltip with the
// arc, chapter and scenes there. Enter opens the first scene at that column. Hidden over the track
// headers and while something is being dragged. Also exports the per-column lookup and the tooltip
// shell, which the range bar reuses.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Scene } from '../../core/types';
import { useStore } from '../../store/store';
import type { ClipModel, Span, TimelineModel, TrackModel } from './model';
import './hover.css';

export interface HoverPreviewProps {
  model: TimelineModel;
  zoom: number;
  /** Width of the sticky track-header column, in px. */
  headerW: number;
  /** The scrolled content element (ruler + tracks); positions are relative to its left edge + headerW. */
  contentRef: RefObject<HTMLDivElement | null>;
}

/** The scenes one track has in one column. */
export interface TrackScenes {
  track: number;
  scenes: Scene[];
}

/** What the timeline has at one column: where the story is, and which scenes sit there. */
export interface ColumnInfo {
  col: number;
  /** Track the arc, chapter and scenes come from; null when nothing is there. */
  track: TrackModel | null;
  arc?: string;
  chapter?: string;
  scenes: Scene[];
}

/** Columns a clip covers. `span` may be added to clips later; without it a clip is one column. */
function spanOf(clip: ClipModel): number {
  const span = (clip as ClipModel & { span?: number }).span ?? 1;
  return Math.max(1, Math.floor(span));
}

/** Scenes per column, grouped by track in track order. Built once per model so lookups are O(1). */
export function buildColumnIndex(model: TimelineModel): Map<number, TrackScenes[]> {
  const index = new Map<number, TrackScenes[]>();
  model.tracks.forEach((t, ti) => {
    for (const clip of t.clips) {
      for (let c = clip.col; c < clip.col + spanOf(clip); c++) {
        let list = index.get(c);
        if (!list) index.set(c, (list = []));
        // Tracks are visited in order, so this track's entries for a column are always the last ones.
        const last = list[list.length - 1];
        if (last?.track === ti) last.scenes.push(clip.scene);
        else list.push({ track: ti, scenes: [clip.scene] });
      }
    }
  });
  return index;
}

function titleAt(spans: Span[], col: number): string | undefined {
  return spans.find((s) => s.from <= col && col < s.to)?.title;
}

/**
 * The column's contents. The track under the cursor (`preferred`) wins when it has scenes or a
 * chapter or arc here; otherwise the first track that has scenes here; otherwise the first track
 * with a chapter or arc spanning it.
 */
export function describeColumn(model: TimelineModel, index: Map<number, TrackScenes[]>, col: number, preferred?: number): ColumnInfo {
  const here = index.get(col) ?? [];
  const hasSpan = (ti: number) => titleAt(model.tracks[ti].chapters, col) !== undefined || titleAt(model.tracks[ti].arcs, col) !== undefined;
  const hasScenes = (ti: number) => here.some((h) => h.track === ti);
  let ti: number | undefined;
  if (preferred !== undefined && (hasScenes(preferred) || hasSpan(preferred))) ti = preferred;
  else if (here.length) ti = here[0].track;
  else {
    const first = model.tracks.findIndex((_, i) => hasSpan(i));
    if (first >= 0) ti = first;
  }
  if (ti === undefined) return { col, track: null, scenes: [] };
  const track = model.tracks[ti];
  return {
    col,
    track,
    arc: titleAt(track.arcs, col),
    chapter: titleAt(track.chapters, col),
    scenes: here.find((h) => h.track === ti)?.scenes ?? [],
  };
}

/** "Arc II · Chapter 5", or whichever of the two exists. */
export function locationOf(info: ColumnInfo): string {
  return [info.arc, info.chapter].filter(Boolean).join(' · ');
}

/** Index of the `.tl-track` row under an element, among the rows of `content`; null outside a row. */
function trackIndexOf(el: Element, content: HTMLElement): number | null {
  const row = el.closest('.tl-track');
  if (!row || row.parentElement !== content) return null;
  let i = -1;
  for (let n: Element | null = row; n; n = n.previousElementSibling) if (n.classList.contains('tl-track')) i++;
  return i;
}

/** A floating tooltip at the cursor, portalled to the body; flips to the other side at screen edges. */
export function TimelineTip({ x, y, testid, children }: { x: number; y: number; testid: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const gap = 16;
    const left = x + gap + width > window.innerWidth - 8 ? x - gap - width : x + gap;
    const top = y + gap + height > window.innerHeight - 8 ? y - gap - height : y + gap;
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(8, top)}px`;
  });
  return createPortal(
    <div ref={ref} className="tl-tip" role="tooltip" data-testid={testid} style={{ left: 0, top: 0 }}>
      {children}
    </div>,
    document.body,
  );
}

interface Hover {
  x: number;
  y: number;
  col: number;
  /** Track under the cursor, or null over the ruler and the gaps between tracks. */
  track: number | null;
  zone: 'ruler' | 'clip' | 'lane';
}

export function HoverPreview({ model, zoom, headerW, contentRef }: HoverPreviewProps) {
  const index = useMemo(() => buildColumnIndex(model), [model]);
  const [hover, setHover] = useState<Hover | null>(null);
  const hoverRef = useRef<Hover | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  // The ghost line lives inside the scrolled content, so it is portalled there once the element exists.
  useEffect(() => {
    setHost(contentRef.current);
  }, [contentRef]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    let frame: number | null = null;
    let latest: { clientX: number; clientY: number; target: Element; buttons: number } | null = null;
    let dragging = false;

    const show = (h: Hover | null) => {
      hoverRef.current = h;
      setHover(h);
    };

    /** Runs once per animation frame with the newest pointer position. */
    const flush = () => {
      frame = null;
      const p = latest;
      latest = null;
      if (!p) return;
      const onHeader = p.target.closest('.tl-track-head, .tl-ruler-head, .tl-addtrack') !== null;
      const x = p.clientX - el.getBoundingClientRect().left - headerW;
      if (dragging || p.buttons !== 0 || onHeader || x < 0) {
        show(null);
        return;
      }
      show({
        x: p.clientX,
        y: p.clientY,
        col: Math.floor(x / zoom),
        track: trackIndexOf(p.target, el),
        zone: p.target.closest('.tl-ruler') ? 'ruler' : p.target.closest('.tl-clip, .tl-span') ? 'clip' : 'lane',
      });
    };

    const onMove = (e: PointerEvent) => {
      latest = { clientX: e.clientX, clientY: e.clientY, target: e.target as Element, buttons: e.buttons };
      if (frame === null) frame = requestAnimationFrame(flush);
    };
    const onLeave = () => {
      latest = null;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      show(null);
    };
    const onDragStart = () => {
      dragging = true;
      show(null);
    };
    const onDragEnd = () => {
      dragging = false;
    };
    /** Enter opens the first scene at the hovered column (the track under the cursor first). */
    const onKey = (e: KeyboardEvent) => {
      const h = hoverRef.current;
      if (!h || e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const target = e.target as Element;
      // Only when focus is on the timeline or nowhere in particular, so typing in the editor is never intercepted.
      const inTimeline = target === document.body || target.closest('.timeline') !== null;
      if (!inTimeline || target.closest('button, a, input, select, textarea')) return;
      const first: Scene | undefined = describeColumn(model, index, h.col, h.track ?? undefined).scenes[0] ?? index.get(h.col)?.[0]?.scenes[0];
      if (!first) return;
      e.preventDefault();
      const s = useStore.getState();
      s.setPlayhead(h.col);
      s.navigate({ kind: 'scene', id: first.id });
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('dragstart', onDragStart);
    window.addEventListener('dragend', onDragEnd);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('dragstart', onDragStart);
      window.removeEventListener('dragend', onDragEnd);
      window.removeEventListener('keydown', onKey);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [contentRef, headerW, zoom, model, index]);

  if (!hover) return null;
  const info = describeColumn(model, index, hover.col, hover.track ?? undefined);
  const location = locationOf(info);
  const rulerLabel = model.labels.find((l) => l.col === hover.col)?.text;
  const hint =
    hover.zone === 'ruler'
      ? 'Click to move playhead · Enter opens scene'
      : hover.zone === 'clip'
        ? 'Click or Enter to open'
        : 'Double-click to add a scene · Enter opens scene';
  const shown = info.scenes.slice(0, 4);

  return (
    <>
      {host &&
        createPortal(<div className="tl-hover-line" data-testid="tl-hover-line" style={{ left: headerW + (hover.col + 0.5) * zoom }} />, host)}
      <TimelineTip x={hover.x} y={hover.y} testid="tl-hover">
        <div className="tl-tip-title">{location || rulerLabel || (info.scenes.length ? 'No chapter' : 'Nothing here')}</div>
        <div className="tl-tip-sub">
          {info.track && <span className="dot" style={{ background: info.track.story.color }} />}
          {info.track && <span className="tl-tip-story">{info.track.story.name}</span>}
          {location && rulerLabel && <span className="tl-tip-story">· {rulerLabel}</span>}
          <span className="tl-tip-col">#{info.col + 1}</span>
        </div>
        {shown.length > 0 && (
          <ul className="tl-tip-scenes">
            {shown.map((s) => (
              <li key={s.id}>
                {s.title}
                {s.synopsis && <span className="muted small"> — {s.synopsis}</span>}
              </li>
            ))}
            {info.scenes.length > shown.length && <li className="tl-tip-more">+{info.scenes.length - shown.length} more</li>}
          </ul>
        )}
        <div className="tl-tip-hint">{hint}</div>
      </TimelineTip>
    </>
  );
}
