import { describe, it, expect } from 'vitest';
import { barToColumn, centreOn, clampView, columnToBar, dragEdge, easeOutCubic, fitZoom, nextStart, panView, scrollForAnchor, stepZoom, tweenAt, viewForRange, windowOf, zoomAnchor, zoomRange } from './zoom';

const MIN = 4;
const MAX = 420;
const LANE = 800;

describe('scrollForAnchor', () => {
  it('keeps the column at the requested viewport x', () => {
    // Column 20 at zoom 50 sits at header 210 + 1000 = 1210 in content; viewport x 300 means scrollLeft 910.
    expect(scrollForAnchor(20, 50, 300, 210)).toBe(910);
  });

  it('never goes negative', () => {
    expect(scrollForAnchor(0, 50, 300, 210)).toBe(0);
  });
});

describe('fitZoom', () => {
  it('makes all columns exactly fill the lane', () => {
    expect(fitZoom(100, 1000, MIN, MAX)).toBeCloseTo(10);
    expect(columnToBar(100, 1000, 100)).toBe(1000);
  });

  it('clamps to the zoom range', () => {
    expect(fitZoom(10000, 500, MIN, MAX)).toBe(MIN);
    expect(fitZoom(1, 5000, MIN, MAX)).toBe(MAX);
  });
});

describe('zoomRange', () => {
  it('starts at fit-all, and never goes below the floor', () => {
    expect(zoomRange(9, 900, MIN, MAX)).toEqual({ min: 100, max: MAX });
    expect(zoomRange(10000, 500, MIN, MAX).min).toBe(MIN);
  });
});

describe('clampView', () => {
  const range = { min: 10, max: MAX };

  it('keeps the zoom within the range', () => {
    expect(clampView({ zoom: 2, scroll: 0 }, 100, LANE, range).zoom).toBe(10);
    expect(clampView({ zoom: 9999, scroll: 0 }, 100, LANE, range).zoom).toBe(MAX);
  });

  it('never scrolls past the end of the work', () => {
    // 100 columns at zoom 20 is 2000px; a lane of 800px can scroll at most 1200px.
    expect(clampView({ zoom: 20, scroll: 5000 }, 100, LANE, range).scroll).toBe(1200);
    expect(clampView({ zoom: 20, scroll: -5 }, 100, LANE, range).scroll).toBe(0);
  });

  it('at fit-all the window is the whole work and cannot scroll', () => {
    const fit = { zoom: 10, scroll: 300 };
    const v = clampView(fit, 80, LANE, { min: 10, max: MAX });
    expect(v).toEqual({ zoom: 10, scroll: 0 });
    expect(windowOf(v, LANE)).toEqual({ from: 0, to: 80 });
  });
});

describe('easeOutCubic', () => {
  it('starts at 0, ends at 1, and is ahead of linear in the middle', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it('clamps out-of-range progress', () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(3)).toBe(1);
  });
});

describe('tweenAt', () => {
  it('interpolates zoom geometrically and scroll linearly', () => {
    const tw = { from: { zoom: 10, scroll: 0 }, to: { zoom: 40, scroll: 800 } };
    const mid = tweenAt(tw, 0.5);
    // Geometric midpoint of 10 and 40 under ease-out is past sqrt(400)=20.
    expect(mid.zoom).toBeGreaterThan(20);
    expect(mid.zoom).toBeLessThan(40);
    expect(mid.scroll).toBeGreaterThan(0);
    expect(mid.scroll).toBeLessThan(800);
    expect(tweenAt(tw, 0)).toEqual({ zoom: 10, scroll: 0 });
    expect(tweenAt(tw, 1)).toEqual({ zoom: 40, scroll: 800 });
  });
});

describe('windowOf', () => {
  it('reports the columns visible at this view', () => {
    // Scrolled 500px at 10px per column: columns 50..130 fill an 800px lane.
    expect(windowOf({ zoom: 10, scroll: 500 }, LANE)).toEqual({ from: 50, to: 130 });
  });

  it('starts at column 0 when not scrolled', () => {
    expect(windowOf({ zoom: 20, scroll: 0 }, LANE)).toEqual({ from: 0, to: 40 });
  });
});

describe('dragEdge', () => {
  const start = { from: 50, to: 130 };

  it('dragging the end handle moves only the right edge', () => {
    const w = windowOf(dragEdge(start, 'end', 100, LANE, MIN, MAX), LANE);
    expect(w.from).toBeCloseTo(50, 6);
    expect(w.to).toBeCloseTo(100, 6);
  });

  it('dragging the start handle moves only the left edge', () => {
    const w = windowOf(dragEdge(start, 'start', 60, LANE, MIN, MAX), LANE);
    expect(w.from).toBeCloseTo(60, 6);
    expect(w.to).toBeCloseTo(130, 6);
  });

  it('a clamped zoom stops the handle short of the pointer but keeps the opposite edge', () => {
    const wide = dragEdge(start, 'end', 10000, LANE, MIN, MAX);
    expect(wide.zoom).toBe(MIN);
    expect(windowOf(wide, LANE).from).toBeCloseTo(50, 6);
    const narrow = dragEdge(start, 'start', 500, LANE, MIN, MAX);
    expect(narrow.zoom).toBe(MAX);
    expect(windowOf(narrow, LANE).to).toBeCloseTo(130, 6);
  });

  it('dragging an end handle past its opposite edge uses the maximum zoom', () => {
    expect(dragEdge(start, 'end', 20, LANE, MIN, MAX).zoom).toBe(MAX);
  });

  it('never scrolls negative', () => {
    expect(dragEdge({ from: 0, to: 100 }, 'end', -10, LANE, MIN, MAX).scroll).toBeGreaterThanOrEqual(0);
  });
});

describe('panView', () => {
  it('shifts the scroll by whole columns at the current zoom', () => {
    expect(panView({ zoom: 10, scroll: 100 }, 5)).toEqual({ zoom: 10, scroll: 150 });
  });

  it('never scrolls before the start', () => {
    expect(panView({ zoom: 10, scroll: 100 }, -50)).toEqual({ zoom: 10, scroll: 0 });
  });
});

describe('centreOn', () => {
  it('puts the column in the middle of the lane', () => {
    const w = windowOf(centreOn(100, 10, LANE), LANE);
    expect((w.from + w.to) / 2).toBeCloseTo(100, 6);
  });

  it('never scrolls before the start', () => {
    expect(centreOn(5, 10, LANE).scroll).toBe(0);
  });
});

describe('range bar mapping', () => {
  it('maps columns to bar pixels and back', () => {
    expect(columnToBar(50, 1000, 200)).toBe(250);
    expect(barToColumn(250, 1000, 200)).toBe(50);
  });

  it('treats a bar with no width or extent without dividing by zero', () => {
    expect(Number.isFinite(columnToBar(5, 0, 0))).toBe(true);
    expect(Number.isFinite(barToColumn(5, 0, 0))).toBe(true);
  });
});

describe('nextStart', () => {
  const starts = [7, 0, 3, 3, 12];

  it('finds the next start after the playhead', () => {
    expect(nextStart(starts, 3, 1)).toBe(7);
    expect(nextStart(starts, 0, 1)).toBe(3);
    expect(nextStart(starts, 12, 1)).toBeNull();
  });

  it('finds the previous start before the playhead', () => {
    expect(nextStart(starts, 7, -1)).toBe(3);
    expect(nextStart(starts, 3, -1)).toBe(0);
    expect(nextStart(starts, 0, -1)).toBeNull();
  });

  it('handles an empty list', () => {
    expect(nextStart([], 4, 1)).toBeNull();
  });
});

describe('zoomAnchor', () => {
  const base = { headerW: 210, laneW: LANE };

  it('prefers the pointer, then a visible playhead, then the lane centre', () => {
    expect(zoomAnchor({ ...base, pointerPx: 500, playheadPx: 300 })).toBe(500);
    expect(zoomAnchor({ ...base, pointerPx: null, playheadPx: 300 })).toBe(300);
    expect(zoomAnchor({ ...base, pointerPx: null, playheadPx: 100 })).toBe(210 + LANE / 2); // scrolled off to the left
    expect(zoomAnchor({ ...base, pointerPx: null, playheadPx: 5000 })).toBe(210 + LANE / 2); // and to the right
  });

  it('a zoom about the anchor leaves the anchored column under the same x, unless the scroll clamped', () => {
    const range = { min: MIN, max: MAX };
    for (const [zoom, scroll, px, factor] of [[40, 900, 500, 1.4], [40, 900, 500, 1 / 1.4], [100, 3000, 250, 2], [12, 0, 700, 3]]) {
      const col = (scroll + px - 210) / zoom;
      const z = zoom * factor;
      const v = clampView({ zoom: z, scroll: scrollForAnchor(col, z, px, 210) }, 400, LANE, range);
      const unclamped = scrollForAnchor(col, z, px, 210);
      if (v.scroll === unclamped) expect(210 + col * v.zoom - v.scroll).toBeCloseTo(px);
    }
  });
});

describe('stepZoom', () => {
  it('stops at the ends of the range instead of passing them', () => {
    expect(stepZoom(MAX, 1, MIN, MAX)).toBe(MAX);
    expect(stepZoom(MIN, -1, MIN, MAX)).toBe(MIN);
  });

  it('one step out undoes one step in', () => {
    expect(stepZoom(stepZoom(60, 1, MIN, MAX), -1, MIN, MAX)).toBeCloseTo(60);
  });
});

describe('viewForRange', () => {
  it('frames the whole range with a margin on each side', () => {
    const v = viewForRange(20, 30, LANE, MIN, MAX);
    const w = windowOf(v, LANE);
    expect(w.from).toBeLessThan(20);
    expect(w.to).toBeGreaterThan(30);
    expect(w.to - w.from).toBeLessThan(12); // tight: the range is 10 columns
  });

  it('centres a range too short for the maximum zoom, at the maximum', () => {
    const v = viewForRange(50, 51, LANE, MIN, MAX);
    expect(v.zoom).toBe(MAX);
    const w = windowOf(v, LANE);
    expect((w.from + w.to) / 2).toBeCloseTo(50.5);
  });

  it('cannot scroll before the start of the work', () => {
    expect(viewForRange(0, 3, LANE, MIN, MAX).scroll).toBe(0);
  });

  it('a range wider than the work ends up as fit-all once clamped', () => {
    const range = zoomRange(100, LANE, MIN, MAX);
    const v = clampView(viewForRange(0, 100, LANE, range.min, range.max), 100, LANE, range);
    expect(v).toEqual({ zoom: 8, scroll: 0 });
  });
});
