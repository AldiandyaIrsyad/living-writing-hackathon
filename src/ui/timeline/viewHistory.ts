// Back and forward through where the timeline was looking, like a map. Only deliberate jumps (Fit, zoom to a
// chapter, the zoom keys) are remembered; wheel and scroll streams are not, or Back would crawl pixel by pixel.
// Pure: the panel keeps one of these in a ref.

import type { ViewState } from './zoom';

export interface ViewHistory {
  back: ViewState[];
  forward: ViewState[];
}

export const EMPTY_HISTORY: ViewHistory = { back: [], forward: [] };

/** Most views kept each way. */
export const HISTORY_LIMIT = 20;

/** Views closer than this (px of zoom, px of scroll) count as the same place. */
const SAME_ZOOM = 0.5;
const SAME_SCROLL = 4;

function same(a: ViewState, b: ViewState): boolean {
  return Math.abs(a.zoom - b.zoom) < SAME_ZOOM && Math.abs(a.scroll - b.scroll) < SAME_SCROLL;
}

/** The writer is about to jump away from `current`: remember it, and forget what Forward held (a new path). */
export function recordJump(h: ViewHistory, current: ViewState): ViewHistory {
  const top = h.back[h.back.length - 1];
  const back = top && same(top, current) ? h.back : [...h.back, current].slice(-HISTORY_LIMIT);
  return { back, forward: [] };
}

/** The stack without views that are where we already are (a click that moved nothing leaves one behind). */
function withoutHere(stack: ViewState[], current: ViewState): ViewState[] {
  let end = stack.length;
  while (end > 0 && same(stack[end - 1], current)) end--;
  return stack.slice(0, end);
}

/** One step back from `current`; null when there is nowhere to go. */
export function goBack(h: ViewHistory, current: ViewState): { view: ViewState; history: ViewHistory } | null {
  const back = withoutHere(h.back, current);
  const view = back[back.length - 1];
  if (!view) return null;
  return { view, history: { back: back.slice(0, -1), forward: [...h.forward, current].slice(-HISTORY_LIMIT) } };
}

/** One step forward from `current`; null when there is nowhere to go. */
export function goForward(h: ViewHistory, current: ViewState): { view: ViewState; history: ViewHistory } | null {
  const forward = withoutHere(h.forward, current);
  const view = forward[forward.length - 1];
  if (!view) return null;
  return { view, history: { back: [...h.back, current].slice(-HISTORY_LIMIT), forward: forward.slice(0, -1) } };
}

/** Whether Back or Forward would go anywhere from `current`. */
export function canTravel(h: ViewHistory, current: ViewState): { back: boolean; forward: boolean } {
  return { back: goBack(h, current) !== null, forward: goForward(h, current) !== null };
}
