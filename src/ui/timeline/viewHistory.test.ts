import { describe, expect, it } from 'vitest';
import { EMPTY_HISTORY, HISTORY_LIMIT, canTravel, goBack, goForward, recordJump } from './viewHistory';

const v = (zoom: number, scroll = 0) => ({ zoom, scroll });

describe('view history', () => {
  it('Back returns to where the jump started, and Forward returns to where Back was pressed', () => {
    const fit = v(10);
    const chapter = v(120, 900);
    let h = recordJump(EMPTY_HISTORY, fit); // about to jump from fit-all to a chapter
    const back = goBack(h, chapter)!;
    expect(back.view).toEqual(fit);
    h = back.history;
    expect(goForward(h, fit)!.view).toEqual(chapter);
  });

  it('a new jump after going back discards Forward', () => {
    let h = recordJump(EMPTY_HISTORY, v(10));
    h = goBack(h, v(120, 900))!.history;
    h = recordJump(h, v(10)); // jumped somewhere else instead
    expect(goForward(h, v(60))).toBeNull();
  });

  it('nothing to go back or forward to is a no-op, not an error', () => {
    expect(goBack(EMPTY_HISTORY, v(10))).toBeNull();
    expect(goForward(EMPTY_HISTORY, v(10))).toBeNull();
  });

  it('does not remember the same place twice in a row, even when it differs by a pixel', () => {
    let h = recordJump(EMPTY_HISTORY, v(40, 500));
    h = recordJump(h, v(40.1, 501));
    expect(h.back).toHaveLength(1);
  });

  it('keeps only the most recent views', () => {
    let h = EMPTY_HISTORY;
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) h = recordJump(h, v(10 + i * 10));
    expect(h.back).toHaveLength(HISTORY_LIMIT);
    expect(h.back[h.back.length - 1].zoom).toBe(10 + (HISTORY_LIMIT + 9) * 10);
  });

  it('Back skips a remembered view that is where we already are, so a click that moved nothing costs no press', () => {
    const fit = v(10);
    let h = recordJump(EMPTY_HISTORY, fit); // the real jump away from fit-all
    h = recordJump(h, v(120, 900)); // a range-bar click recorded where it started, and moved nothing
    expect(goBack(h, v(120, 900))!.view).toEqual(fit);
    expect(canTravel(EMPTY_HISTORY, v(10))).toEqual({ back: false, forward: false });
    expect(canTravel(h, v(120, 900))).toEqual({ back: true, forward: false });
  });
});
