// What folder sync should do with each file once the folder may have changed behind the app's back. Pure.
//
// Three versions of the vault's files meet: `base` is what both sides agreed on last time, `ours` is the vault serialised
// now, `theirs` is the folder now. A file that only one side changed goes with that side; a file both changed is merged
// line by line when the edits are in different places, and is a conflict when they are not. Deleting a file one side
// edited is a conflict too: neither a silent resurrection nor a silent deletion. A path missing from a map means no file.

import { mergeText } from './merge';

export type Decision =
  /** Both sides already agree: nothing to do. `text` is the shared content (null: both have no file). */
  | { action: 'keep'; text: string | null }
  /** Only this side changed the file: the folder should get `text` (null: delete it). */
  | { action: 'write'; text: string | null }
  /** Only the folder changed the file: take `text` into the vault (null: it was deleted there). */
  | { action: 'read'; text: string | null }
  /** Both changed it in different places: the merged text goes to both. */
  | { action: 'merge'; text: string }
  /** Both changed it in the same place, or one deleted it and the other edited it. The writer decides. */
  | { action: 'conflict' };

const eol = (s: string | undefined): string | undefined => s?.replace(/\r\n/g, '\n');

export function planSync(
  base: ReadonlyMap<string, string>,
  ours: ReadonlyMap<string, string>,
  theirs: ReadonlyMap<string, string>,
): Map<string, Decision> {
  const plan = new Map<string, Decision>();
  for (const path of new Set([...base.keys(), ...ours.keys(), ...theirs.keys()])) {
    const b = base.get(path);
    const o = ours.get(path);
    const t = theirs.get(path);
    // An editor that re-saves a file with other line endings has not changed it.
    if (eol(o) === eol(t)) plan.set(path, { action: 'keep', text: o ?? null });
    else if (eol(o) === eol(b)) plan.set(path, { action: 'read', text: t ?? null });
    else if (eol(t) === eol(b)) plan.set(path, { action: 'write', text: o ?? null });
    else if (b !== undefined && o !== undefined && t !== undefined) {
      const merged = mergeText(b, o, t);
      plan.set(path, merged.clean ? { action: 'merge', text: merged.text } : { action: 'conflict' });
    } else plan.set(path, { action: 'conflict' });
  }
  return plan;
}

/** The paths the writer must decide about. */
export function conflictsOf(plan: ReadonlyMap<string, Decision>): string[] {
  return [...plan].filter(([, d]) => d.action === 'conflict').map(([path]) => path);
}

export type Choice = 'mine' | 'theirs';

/**
 * The files that result from a plan once every conflict has a choice: "mine" is our version, "theirs" the folder's
 * (either may be no file at all). Files whose result is no file are left out. Returns the conflicts that still lack a
 * choice instead when there are any, so nothing is ever settled by guessing.
 */
export function settle(
  plan: ReadonlyMap<string, Decision>,
  ours: ReadonlyMap<string, string>,
  theirs: ReadonlyMap<string, string>,
  choices: Readonly<Record<string, Choice>> = {},
): { files: Map<string, string> } | { unresolved: string[] } {
  const files = new Map<string, string>();
  const unresolved: string[] = [];
  for (const [path, d] of plan) {
    let text: string | null | undefined;
    if (d.action !== 'conflict') text = d.text;
    else if (choices[path] === 'mine') text = ours.get(path);
    else if (choices[path] === 'theirs') text = theirs.get(path);
    else unresolved.push(path);
    if (typeof text === 'string') files.set(path, text);
  }
  return unresolved.length > 0 ? { unresolved } : { files };
}
