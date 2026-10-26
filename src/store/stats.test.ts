import { describe, expect, it } from 'vitest';
import { addToDay, dayKey } from './stats';

describe('daily tally', () => {
  it('adds to the right day, and a day with no entry starts at zero', () => {
    expect(addToDay({}, '2026-10-22', 5)).toEqual({ '2026-10-22': 5 });
    expect(addToDay({ '2026-10-22': 5 }, '2026-10-22', 3)).toEqual({ '2026-10-22': 8 });
    expect(addToDay({ '2026-10-21': 9 }, '2026-10-22', 1)).toEqual({ '2026-10-21': 9, '2026-10-22': 1 });
  });

  it('keeps only the most recent 90 days', () => {
    let days: Record<string, number> = {};
    for (let i = 0; i < 100; i++) days = addToDay(days, dayKey(new Date(2026, 0, 1 + i)), 1);
    const kept = Object.keys(days);
    expect(kept).toHaveLength(90);
    expect(kept[0]).toBe(dayKey(new Date(2026, 0, 11)));
  });

  it('names a day in the writer’s own calendar with leading zeros, so days sort as text', () => {
    expect(dayKey(new Date(2026, 2, 4, 23, 59))).toBe('2026-03-04');
  });
});
