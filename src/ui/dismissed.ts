// Problems the writer has dismissed, kept per browser against each problem's fingerprint (see store/problems.ts).

import { useSyncExternalStore } from 'react';

const KEY = 'lw-dismissed-problems';
const listeners = new Set<() => void>();

function load(): ReadonlySet<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

let current: ReadonlySet<string> = load();

export function setDismissed(id: string, dismissed: boolean): void {
  const next = new Set(current);
  if (dismissed) next.add(id);
  else next.delete(id);
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]));
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

export function useDismissed(): ReadonlySet<string> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
