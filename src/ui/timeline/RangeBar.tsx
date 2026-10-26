// The range bar under the timeline: the whole work in miniature, with the visible window and the playhead.
// Drag a window edge to zoom (the opposite edge stays put), drag the window to scroll, press anywhere
// else to centre the view there, double-click to fit the whole work. Hovering shows the arc, chapter and
// scene under the cursor; chapter ticks mark where chapters start. Window ↔ view math is in zoom.ts.

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { buildColumnIndex, describeColumn, TimelineTip } from './HoverPreview';
import type { TimelineModel } from './model';
import { barToColumn, centreOn, clampView, columnToBar, dragEdge, panView, windowOf, type ColumnWindow, type ViewState, type WindowEdge } from './zoom';
import './hover.css';

const BAR_H = 30;
/** Width of the grab area for each window edge (px). */
const HANDLE_W = 8;

type Grab = { kind: 'edge'; edge: WindowEdge } | { kind: 'body' } | { kind: 'centre' };

/** A pointer drag in progress. Everything it needs is captured at press time, so frames never read stale props. */
interface Drag {
  grab: Grab;
  bar: HTMLDivElement;
  startX: number;
  startView: ViewState;
  startWin: ColumnWindow;
  laneW: number;
  extent: number;
  range: { min: number; max: number };
  onView: (v: ViewState) => void;
}

interface RangeBarProps {
  model: TimelineModel;
  /** The current view: zoom, and the scroll offset (scrollLeft of the lanes). */
  view: ViewState;
  /** Visible lane width in px (scroller width minus the track-header column). */
  laneW: number;
  /** Columns the bar stands for (the scrollable content, tail included). */
  extent: number;
  /** Zoom limits: the smallest is fit-all (the whole work fills the bar), the largest the maximum zoom. */
  minZoom: number;
  maxZoom: number;
  headerW: number;
  playhead: number;
  onView: (v: ViewState) => void;
  /** A drag or click on the bar is about to move the view away from `from`. */
  onGestureStart?: (from: ViewState) => void;
  onFit: () => void;
}

/** The column under a pointer, clamped to the work: nothing before column 0 or past the last one. */
function columnUnder(d: Drag, clientX: number): number {
  const box = d.bar.getBoundingClientRect();
  return Math.min(d.extent, Math.max(0, barToColumn(clientX - box.left, box.width, d.extent)));
}

function applyDrag(d: Drag, clientX: number): void {
  let next: ViewState;
  if (d.grab.kind === 'body') {
    const box = d.bar.getBoundingClientRect();
    next = panView(d.startView, barToColumn(clientX - d.startX, box.width, d.extent));
  } else if (d.grab.kind === 'edge') {
    // An edge stops at the ends of the work; the zoom stops at fit-all (or the maximum), whichever is hit.
    next = dragEdge(d.startWin, d.grab.edge, columnUnder(d, clientX), d.laneW, d.range.min, d.range.max);
  } else {
    next = centreOn(columnUnder(d, clientX), d.startView.zoom, d.laneW);
  }
  d.onView(clampView(next, d.extent, d.laneW, d.range));
}

export function RangeBar({ model, view, laneW, extent, minZoom, maxZoom, headerW, playhead, onView, onGestureStart, onFit }: RangeBarProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const latestX = useRef(0);
  const cols = Math.max(1, extent);
  const [tip, setTip] = useState<{ x: number; y: number; col: number } | null>(null);
  const index = useMemo(() => buildColumnIndex(model), [model]);
  const tipInfo = tip ? describeColumn(model, index, tip.col) : null;

  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = BAR_H * dpr;
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, BAR_H);
    const n = model.tracks.length || 1;
    const rowH = Math.max(2, Math.min(6, (BAR_H - 6) / n));
    const unit = w / cols;
    model.tracks.forEach((t, i) => {
      const y = 3 + i * rowH;
      g.globalAlpha = 0.28;
      g.fillStyle = t.story.color;
      for (const ch of t.chapters) g.fillRect(ch.from * unit, y, Math.max(1, (ch.to - ch.from) * unit - 1), rowH - 0.5);
      g.globalAlpha = 0.95;
      for (const clip of t.clips) g.fillRect(clip.col * unit, y, Math.max(1, unit - 0.5), rowH - 0.5);
    });
    // Chapter ticks for the first track that has chapters, drawn over the rows so chapter starts stand out.
    const ticks = model.tracks.find((t) => t.chapters.length);
    if (ticks) {
      g.globalAlpha = 1;
      g.fillStyle = ticks.story.color;
      for (const ch of ticks.chapters) g.fillRect(ch.from * unit, 0, 1.5, BAR_H);
    }
    g.globalAlpha = 1;
  }, [model, w, cols]);

  // Cancel any pending frame when the bar unmounts.
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  const win = windowOf(view, Math.max(1, laneW));
  const left = columnToBar(Math.min(cols, Math.max(0, win.from)), w, cols);
  const right = columnToBar(Math.min(cols, Math.max(0, win.to)), w, cols);
  // At fit-all the window is the whole bar; zoomed in, the parts outside it are shaded.
  const fullyFit = left <= 0.5 && right >= w - 0.5;

  /** Coalesce pointer moves into one view update per animation frame. */
  const schedule = (d: Drag, clientX: number) => {
    latestX.current = clientX;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      applyDrag(d, latestX.current);
    });
  };

  const endDrag = () => {
    const d = drag.current;
    if (d && frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
      applyDrag(d, latestX.current);
    }
    drag.current = null;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = bar.current;
    if (e.button !== 0 || !el) return;
    const part = (e.target as HTMLElement).closest<HTMLElement>('[data-part]')?.dataset.part;
    const grab: Grab = part === 'start' || part === 'end' ? { kind: 'edge', edge: part } : part === 'body' ? { kind: 'body' } : { kind: 'centre' };
    const d: Drag = {
      grab,
      bar: el,
      startX: e.clientX,
      startView: view,
      startWin: windowOf(view, Math.max(1, laneW)),
      laneW,
      extent: cols,
      range: { min: minZoom, max: maxZoom },
      onView,
    };
    drag.current = d;
    onGestureStart?.(view);
    el.setPointerCapture(e.pointerId);
    if (grab.kind === 'centre') {
      latestX.current = e.clientX;
      applyDrag(d, e.clientX);
    } else setTip(null);
  };

  return (
    <div className="tl-rangebar" data-testid="tl-rangebar" style={{ paddingLeft: headerW }}>
      <div className="tl-range-head faint small" style={{ width: headerW }} title="The whole work in miniature. Drag the window to scroll, its edges to zoom, double-click to fit.">
        Overview
      </div>
      <div
        className="tl-range-inner"
        ref={bar}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => {
          if (drag.current) {
            setTip(null);
            schedule(drag.current, e.clientX);
            return;
          }
          const box = bar.current?.getBoundingClientRect();
          if (!box) return;
          const col = Math.min(cols - 1, Math.max(0, Math.floor(barToColumn(e.clientX - box.left, box.width, cols))));
          setTip({ x: e.clientX, y: e.clientY, col });
        }}
        onPointerLeave={() => setTip(null)}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onDoubleClick={onFit}
      >
        <canvas ref={canvas} style={{ width: w, height: BAR_H }} />
        <div className="tl-range-shade" data-testid="tl-range-shade-start" style={{ left: 0, width: Math.max(0, left) }} />
        <div className="tl-range-shade" data-testid="tl-range-shade-end" style={{ left: right, width: Math.max(0, w - right) }} />
        <div
          className="tl-range-window"
          data-part="body"
          data-testid="tl-range-window"
          data-fit={fullyFit ? 'true' : 'false'}
          style={{ left, width: Math.max(0, right - left) }}
        />
        <div className="tl-range-handle" data-part="start" data-testid="tl-range-start" style={{ left }} />
        <div className="tl-range-handle" data-part="end" data-testid="tl-range-end" style={{ left: Math.max(0, right - HANDLE_W) }} />
        <div className="tl-range-ph" style={{ left: columnToBar(playhead, w, cols) }} />
      </div>
      {tip && tipInfo && (
        <TimelineTip x={tip.x} y={tip.y} testid="tl-range-hover">
          <div className="tl-tip-title">
            {[tipInfo.arc, tipInfo.chapter, tipInfo.scenes.length ? sceneLabel(tipInfo.scenes) : undefined].filter(Boolean).join(' · ') || 'Nothing here'}
          </div>
          <div className="tl-tip-sub">
            <span className="tl-tip-col">#{tipInfo.col + 1}</span>
          </div>
          <div className="tl-tip-hint">Click to centre · double-click to fit</div>
        </TimelineTip>
      )}
    </div>
  );
}

/** The first scene's title, with a count when there are more at this column. */
function sceneLabel(scenes: { title: string }[]): string {
  return scenes.length > 1 ? `${scenes[0].title} +${scenes.length - 1}` : scenes[0].title;
}
