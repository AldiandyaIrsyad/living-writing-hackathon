// Typewriter scrolling: while on, the line being written stays vertically centred instead of drifting to the bottom edge.
// A per-browser preference, like the theme; the extension reads the flag on every update, so toggling needs no reconfigure.

import { EditorView } from '@codemirror/view';

export const TYPEWRITER_CLASS = 'cm-typewriter';

const KEY = 'lw-typewriter';

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

let on = load();

export function typewriterOn(): boolean {
  return on;
}

export function toggleTypewriter(): boolean {
  on = !on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // ignore
  }
  return on;
}

export const typewriter = EditorView.updateListener.of((u) => {
  // Room under the last line, or the end of the text could never reach the middle (styled in styles.css).
  u.view.dom.classList.toggle(TYPEWRITER_CLASS, on);
  if (!on || !u.view.hasFocus || !(u.docChanged || u.selectionSet)) return;
  const head = u.state.selection.main.head;
  // An update cannot dispatch while it is being applied.
  queueMicrotask(() => u.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) }));
});
