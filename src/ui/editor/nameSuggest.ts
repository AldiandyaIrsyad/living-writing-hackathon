// Name suggestions while writing, like an IDE's: type a few letters of a character, place or thing that has a page and
// it is offered; Tab writes it as a [[link]]. Enter still starts a new line, since in prose it is not a choice.
// A per-browser preference, like the typewriter; the source reads the flag on every keystroke.

import { acceptCompletion, completionKeymap, completionStatus, selectedCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { KeyBinding } from '@codemirror/view';
import { useStore } from '../../store/store';

const KEY = 'lw-name-suggest';

function load(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

let on = load();

export function toggleNameSuggestions(): boolean {
  on = !on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // ignore
  }
  return on;
}

/** Completion `type` of these suggestions: the one kind Enter must not accept. */
const TYPE = 'name';

const link = (name: string, shown?: string): string => `[[${shown && shown !== name ? `${name}|${shown}` : name}]]`;

export function nameCompletion(ctx: CompletionContext): CompletionResult | null {
  if (!on) return null;
  const word = ctx.matchBefore(/\p{L}[\p{L}'’-]*$/u);
  if (!word || word.to - word.from < 2) return null;
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);
  if (before.lastIndexOf('[[') > before.lastIndexOf(']]')) return null; // inside a link: the [[ list is showing
  const typed = word.text.toLowerCase();
  const options: Completion[] = [];
  const seen = new Set<string>();
  const offer = (label: string, apply: string, detail: string, boost: number) => {
    if (seen.has(label)) return;
    seen.add(label);
    options.push({
      label,
      detail,
      type: TYPE,
      boost,
      apply: (view, _c, from, to) => view.dispatch({ changes: { from, to, insert: apply }, selection: { anchor: from + apply.length }, userEvent: 'input.complete' }),
    });
  };
  for (const e of Object.values(useStore.getState().vault.entities)) {
    const kind = useStore.getState().vault.entityTypes[e.typeId]?.name ?? 'page';
    for (const name of [e.name, ...e.aliases]) {
      if (name.toLowerCase().startsWith(typed)) offer(name, link(e.name, name), name === e.name ? kind : `alias of ${e.name}`, name === e.name ? 1 : 0);
      else {
        // Any later word of a longer name ("Hale" for Edric Hale) links to the page and keeps the word as written.
        const hit = name.split(/\s+/).slice(1).find((w) => w.toLowerCase().startsWith(typed));
        if (hit) offer(name, link(e.name, hit), `${kind} · ${hit}`, -1);
      }
    }
  }
  return options.length ? { from: word.from, options, validFor: /^[\p{L}'’-]*$/u } : null;
}

/** The completion keys, with Enter accepting only the [[ lists, and Tab accepting a suggestion of either kind. */
export const suggestionKeys: KeyBinding[] = [
  ...completionKeymap.filter((k) => k.key !== 'Enter'),
  { key: 'Enter', run: (view) => (selectedCompletion(view.state)?.type === TYPE ? false : acceptCompletion(view)) },
  { key: 'Tab', run: (view) => completionStatus(view.state) === 'active' && acceptCompletion(view) },
];
