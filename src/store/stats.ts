// Today's writing: net words per day and an optional daily goal, kept per browser (not in the vault or its exports).

import { useSyncExternalStore } from 'react';
import { netWordsBetween } from '../core/networds';
import { useStore } from './store';

const DAYS_KEY = 'lw-writing-days';
const GOAL_KEY = 'lw-daily-goal';
const DAYS_KEPT = 90;

/** "2026-10-22" in the writer's own time zone. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The tally with `delta` added to `day`, keeping only the most recent days. */
export function addToDay(days: Readonly<Record<string, number>>, day: string, delta: number): Record<string, number> {
  const next = { ...days, [day]: (days[day] ?? 0) + delta };
  const keep = Object.keys(next).sort().slice(-DAYS_KEPT);
  return Object.fromEntries(keep.map((k) => [k, next[k]]));
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full disk: the tally just is not kept.
  }
}

const listeners = new Set<() => void>();
let days: Record<string, number> = read(DAYS_KEY, {});
let goal: number | null = read<number | null>(GOAL_KEY, null);
let snapshot = { today: 0, goal };

function refresh(): void {
  snapshot = { today: Math.max(0, days[dayKey(new Date())] ?? 0), goal };
  listeners.forEach((l) => l());
}
refresh();

/** Starts following the store. Call once the vault has loaded, so loading it is not counted as writing. */
export function startTrackingWriting(): void {
  useStore.subscribe((s, prev) => {
    if (s.vault === prev.vault || !s.loaded || !prev.loaded) return;
    const delta = netWordsBetween(prev.vault, s.vault);
    if (delta === 0) return;
    days = addToDay(days, dayKey(new Date()), delta);
    write(DAYS_KEY, days);
    refresh();
  });
}

export function setDailyGoal(words: number | null): void {
  goal = words !== null && words > 0 ? Math.round(words) : null;
  write(GOAL_KEY, goal);
  refresh();
}

export function getDailyGoal(): number | null {
  return goal;
}

export function useTodaysWriting(): { today: number; goal: number | null } {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}
