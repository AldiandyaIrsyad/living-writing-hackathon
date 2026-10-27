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

// Look: the Timetable design (default) or the earlier warm one, stored per browser.

export type Look = 'timetable' | 'classic';

function initialLook(): Look {
  try {
    return localStorage.getItem('lw-look') === 'classic' ? 'classic' : 'timetable';
  } catch {
    return 'timetable';
  }
}

let look: Look = initialLook();
if (typeof document !== 'undefined') document.documentElement.dataset.look = look;

export function getLook(): Look {
  return look;
}

export function setLook(l: Look): void {
  look = l;
  document.documentElement.dataset.look = l;
  try {
    localStorage.setItem('lw-look', l);
  } catch {
    // ignore
  }
  listeners.forEach((fn) => fn());
}

export function toggleLook(): Look {
  setLook(look === 'timetable' ? 'classic' : 'timetable');
  return look;
}
