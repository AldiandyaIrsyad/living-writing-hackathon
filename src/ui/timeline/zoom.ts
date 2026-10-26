// Pure zoom / scroll math for the timeline: the view (zoom + scroll), the limits of zoom (fit-all up to the
// maximum) and of scroll (never past the work), the range bar's window ↔ view conversions, anchored wheel
// zoom, the Fit tween and stepping between chapter or clip starts. No React, no store — unit tested in zoom.test.ts.

/** A view of the timeline: zoom (px per column) and the scroll offset that goes with it. */
export interface ViewState {
  zoom: number;
  scroll: number;
}

/** The columns on screen: [from, to). `to - from` is the visible width in columns. */
export interface ColumnWindow {
  from: number;
  to: number;
}

/** Which edge of the visible window a range-bar handle drags. */
export type WindowEdge = 'start' | 'end';

/** Tween duration for the animated Fit (ms). */
export const ZOOM_TWEEN_MS = 180;

export function clampZoom(z: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, z));
}

/** scrollLeft that keeps `col` at viewport x `px`. Never negative. */
export function scrollForAnchor(col: number, zoom: number, px: number, headerW: number): number {
  return Math.max(0, headerW + col * zoom - px);
}

/** The zoom at which `columns` columns exactly fill a lane `laneW` px wide, kept within [min, max]. */
export function fitZoom(columns: number, laneW: number, min: number, max: number): number {
  return clampZoom(laneW / Math.max(1, columns), min, max);
}

/** The zoom range of a work: from fit-all (the whole work fills the lane) up to `max`. Never below `floor`. */
export function zoomRange(columns: number, laneW: number, floor: number, max: number): { min: number; max: number } {
  return { min: fitZoom(columns, laneW, floor, max), max };
}

/**
 * Keeps a view inside the work: the zoom within the range, and a scroll that never shows anything past
 * either end of the `columns` (so at fit-all the scroll is 0 and the window fills the range bar).
 */
export function clampView(v: ViewState, columns: number, laneW: number, range: { min: number; max: number }): ViewState {
  const zoom = clampZoom(v.zoom, range.min, range.max);
  const maxScroll = Math.max(0, columns * zoom - laneW);
  return { zoom, scroll: Math.min(maxScroll, Math.max(0, v.scroll)) };
}

/** The columns visible in a lane `laneW` px wide at this view. */
export function windowOf(view: ViewState, laneW: number): ColumnWindow {
  const from = view.scroll / view.zoom;
  return { from, to: from + laneW / view.zoom };
}

/**
 * The view after one edge of the window has been dragged to column `col`. The opposite edge stays
 * where it was (`start.from` for an end drag, `start.to` for a start drag). A zoom clamped to the
 * limits stops the dragged edge short of the pointer; a non-positive span means the maximum zoom.
 */
export function dragEdge(start: ColumnWindow, edge: WindowEdge, col: number, laneW: number, min: number, max: number): ViewState {
  if (edge === 'end') {
    const span = col - start.from;
    const zoom = span > 0 ? clampZoom(laneW / span, min, max) : max;
    return { zoom, scroll: Math.max(0, start.from * zoom) };
  }
  const span = start.to - col;
  const zoom = span > 0 ? clampZoom(laneW / span, min, max) : max;
  return { zoom, scroll: Math.max(0, start.to * zoom - laneW) };
}

/** The view after the window body has been dragged `cols` columns from `start` (positive = later). */
export function panView(start: ViewState, cols: number): ViewState {
  return { zoom: start.zoom, scroll: Math.max(0, start.scroll + cols * start.zoom) };
}

/** The view that puts column `col` in the middle of a lane `laneW` px wide. */
export function centreOn(col: number, zoom: number, laneW: number): ViewState {
  return { zoom, scroll: Math.max(0, col * zoom - laneW / 2) };
}

/** x on the range bar (`barW` px wide, showing `extent` columns) of a column. */
export function columnToBar(col: number, barW: number, extent: number): number {
  return (col / Math.max(1, extent)) * barW;
}

/** The column under x on the range bar. Works for deltas too (no offset). */
export function barToColumn(x: number, barW: number, extent: number): number {
  return (x / Math.max(1, barW)) * extent;
}

/** Smooth start-fast, end-slow curve for zoom tweens. */
export function easeOutCubic(t: number): number {
  const c = 1 - Math.min(1, Math.max(0, t));
  return 1 - c * c * c;
}

export interface ViewTween {
  from: ViewState;
  to: ViewState;
}

/**
 * The view at progress `t` (0..1, linear time). Zoom interpolates geometrically so that equal
 * time steps feel like equal zoom steps; scroll interpolates linearly.
 */
export function tweenAt(tw: ViewTween, t: number): ViewState {
  if (t >= 1) return { zoom: tw.to.zoom, scroll: Math.max(0, tw.to.scroll) };
  const e = easeOutCubic(Math.max(0, t));
  const zoom = tw.from.zoom * Math.pow(tw.to.zoom / tw.from.zoom, e);
  const scroll = tw.from.scroll + (tw.to.scroll - tw.from.scroll) * e;
  return { zoom, scroll: Math.max(0, scroll) };
}

/**
 * The nearest start strictly after (dir 1) or before (dir -1) `at`, or null when there is none.
 * Order of `starts` does not matter.
 */
export function nextStart(starts: readonly number[], at: number, dir: 1 | -1): number | null {
  let best: number | null = null;
  for (const x of starts) {
    if (dir === 1 && x > at && (best === null || x < best)) best = x;
    if (dir === -1 && x < at && (best === null || x > best)) best = x;
  }
  return best;
}

/** Respect the user's reduced-motion setting: no zoom animation at all. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Which viewport x a zoom keeps still. Whatever you point at stays still; with no pointer (a key or button), the
 * playhead does; if the playhead is off screen, anchoring on it would make the view jump, so the lane centre does.
 * All positions are viewport x measured from the left edge of the timeline, the track header included.
 */
export function zoomAnchor(input: { pointerPx: number | null; playheadPx: number; headerW: number; laneW: number }): number {
  const { pointerPx, playheadPx, headerW, laneW } = input;
  if (pointerPx !== null) return pointerPx;
  if (playheadPx >= headerW && playheadPx <= headerW + laneW) return playheadPx;
  return headerW + laneW / 2;
}

/** Zoom factor of one key press. */
export const ZOOM_STEP = 1.4;

/** The zoom one step in (dir 1) or out (dir -1) from `zoom`, kept within [min, max]. */
export function stepZoom(zoom: number, dir: 1 | -1, min: number, max: number): number {
  return clampZoom(dir === 1 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP, min, max);
}

/** Share of the lane left empty on each side when a range is framed. */
const FRAME_MARGIN = 0.04;

/**
 * The view that frames columns [from, to) in a lane `laneW` px wide with a small margin each side. A range too small
 * for the maximum zoom is centred at the maximum; one wider than the work is brought back by clampView.
 */
export function viewForRange(from: number, to: number, laneW: number, min: number, max: number): ViewState {
  const span = Math.max(1, to - from) * (1 + 2 * FRAME_MARGIN);
  return centreOn((from + to) / 2, clampZoom(laneW / span, min, max), laneW);
}
