// Light/dark theme, stored per browser.

import { useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';
const listeners = new Set<() => void>();

function initial(): Theme {
  try {
    const saved = localStorage.getItem('lw-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // ignore
  }
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let theme: Theme = initial();
if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;

export function getTheme(): Theme {
  return theme;
}

export function setTheme(t: Theme): void {
  theme = t;
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem('lw-theme', t);
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

export function toggleTheme(): void {
  setTheme(theme === 'dark' ? 'light' : 'dark');
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => theme,
  );
}
