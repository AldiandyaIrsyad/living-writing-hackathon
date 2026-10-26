// Find and replace across the vault. Pure: finding makes a list of matches, replacing applies a chosen subset in one go.
//
// Some text is never touched: link targets (replacing "Norman" must not break [[Norman]]), code, frontmatter and, unless
// asked, author notes. A link's alias, the words shown in the page, is ordinary text.

import { maskCode, parseLinks } from './links';
import { splitFrontmatter } from './markdown';
import { findAuthorNotes } from './notes';
import type { Id, Vault } from './types';

export interface FindOptions {
  query: string;
  /** Treat the query as a regular expression. Otherwise it is literal text. */
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Also search and change author notes (`%% … %%`). Off by default. */
  includeNotes: boolean;
  /** Where to look. */
  scope: { prose: boolean; entityNotes: boolean; revisions: boolean };
}

export type Field = 'prose' | 'entity-note' | 'revision-note';

export interface Match {
  /** Unique and stable for one find: which document and field, and where. */
  key: string;
  field: Field;
  /** The scene (prose), the entity (entity-note), or the change (revision-note). */
  id: Id;
  /** What to show for it: the scene's title or the entity's name. */
  where: string;
  start: number;
  end: number;
  text: string;
  /** The line around the match, for context. */
  before: string;
  after: string;
  /** What the regular expression captured, for `$1` in the replacement. */
  groups: (string | undefined)[];
}

export type FindResult = { ok: true; matches: Match[] } | { ok: false; error: string };

const WORD = '[\\p{L}\\p{N}_]';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The regular expression for a query, or why there is none. A literal "\n" also matches Windows line endings. */
export function compile(opts: FindOptions): { ok: true; re: RegExp } | { ok: false; error: string } {
  if (opts.query === '') return { ok: false, error: 'Nothing to find.' };
  let source = opts.regex ? opts.query : escapeRegExp(opts.query).replace(/\n/g, '\\r?\\n');
  if (opts.wholeWord) source = `(?<!${WORD})(?:${source})(?!${WORD})`;
  try {
    return { ok: true, re: new RegExp(source, opts.caseSensitive ? 'gu' : 'giu') };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Stretches of `text` that must not change. Sorted by start. */
function protectedRanges(text: string, includeNotes: boolean): [number, number][] {
  const out: [number, number][] = [];
  const frontmatterEnd = text.length - splitFrontmatter(text).body.length;
  if (frontmatterEnd > 0) out.push([0, frontmatterEnd]);
  for (const link of parseLinks(text)) {
    // Everything in the brackets except the words shown (the alias after "|").
    const pipe = link.alias === undefined ? -1 : link.raw.indexOf('|');
    if (pipe < 0) out.push([link.start, link.end]);
    else out.push([link.start, link.start + pipe + 1], [link.end - 2, link.end]);
  }
  const masked = maskCode(text);
  let from = -1;
  for (let i = 0; i <= text.length; i++) {
    const code = i < text.length && masked[i] !== text[i];
    if (code && from < 0) from = i;
    if (!code && from >= 0) {
      out.push([from, i]);
      from = -1;
    }
  }
  if (!includeNotes) for (const n of findAuthorNotes(masked)) out.push([n.start, n.end]);
  return out.sort((a, b) => a[0] - b[0]);
}

const overlaps = (ranges: [number, number][], start: number, end: number) => ranges.some(([a, b]) => start < b && a < end);

const CONTEXT = 40;

function matchesIn(text: string, re: RegExp, field: Field, id: Id, where: string, includeNotes: boolean): Match[] {
  const guard = protectedRanges(text, includeNotes);
  const out: Match[] = [];
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    // A match with no width has nothing to replace, and a loop that does not advance never ends.
    if (m[0].length === 0) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (overlaps(guard, start, end)) continue;
    const lineStart = Math.max(text.lastIndexOf('\n', start - 1) + 1, start - CONTEXT);
    const lineEndRaw = text.indexOf('\n', end);
    const lineEnd = Math.min(lineEndRaw < 0 ? text.length : lineEndRaw, end + CONTEXT);
    out.push({ key: `${field}:${id}:${start}`, field, id, where, start, end, text: m[0], before: text.slice(lineStart, start), after: text.slice(end, lineEnd), groups: m.slice(1) });
  }
  return out;
}

/** Every match of the query in the chosen places, in reading order of the documents. */
export function findMatches(vault: Vault, opts: FindOptions): FindResult {
  const compiled = compile(opts);
  if (!compiled.ok) return compiled;
  const { re } = compiled;
  const matches: Match[] = [];
  if (opts.scope.prose) {
    const scenes = Object.values(vault.scenes).sort((a, b) => (a.storyId < b.storyId ? -1 : a.storyId > b.storyId ? 1 : a.order - b.order));
    for (const s of scenes) matches.push(...matchesIn(s.prose, re, 'prose', s.id, s.title, opts.includeNotes));
  }
  if (opts.scope.entityNotes) {
    for (const e of Object.values(vault.entities).sort((a, b) => a.name.localeCompare(b.name))) matches.push(...matchesIn(e.note, re, 'entity-note', e.id, e.name, opts.includeNotes));
  }
  if (opts.scope.revisions) {
    for (const c of Object.values(vault.changes)) {
      if (c.op !== 'revise' || c.note === undefined) continue;
      matches.push(...matchesIn(c.note, re, 'revision-note', c.id, vault.entities[c.entityId]?.name ?? 'A page revision', opts.includeNotes));
    }
  }
  return { ok: true, matches };
}

/** `$&`, `$1`…`$99` and `$$` in a regex replacement; anything else stays as typed. */
function expand(template: string, m: Match): string {
  return template.replace(/\$(\$|&|\d{1,2})/g, (_all, what: string) => {
    if (what === '$') return '$';
    if (what === '&') return m.text;
    const n = Number(what);
    return n >= 1 && n <= m.groups.length ? (m.groups[n - 1] ?? '') : `$${what}`;
  });
}

/** Keeps "NORMAN" and "Norman" looking like themselves when the replacement is a single word. */
function matchCase(found: string, replacement: string): string {
  if (/\s/.test(replacement) || replacement === '') return replacement;
  const letters = [...found].filter((c) => c.toLowerCase() !== c.toUpperCase());
  if (letters.length > 1 && letters.every((c) => c === c.toUpperCase())) return replacement.toUpperCase();
  const first = [...found][0];
  if (first !== first.toLowerCase() && found.slice(first.length) === found.slice(first.length).toLowerCase()) return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  return replacement;
}

export interface ReplaceOptions {
  /** Take the replacement as a template for the regex captures. Off: it is used exactly as typed. */
  regex: boolean;
  preserveCase: boolean;
}

/**
 * Applies the replacement to exactly the given matches (from a `findMatches` of this same vault) and returns the new
 * vault. Documents the matches do not touch are the same objects as before; a vault with nothing to change comes back as is.
 */
export function replaceMatches(vault: Vault, matches: readonly Match[], replacement: string, opts: ReplaceOptions): Vault {
  const byDoc = new Map<string, Match[]>();
  for (const m of matches) {
    const key = `${m.field}:${m.id}`;
    const list = byDoc.get(key);
    if (list) list.push(m);
    else byDoc.set(key, [m]);
  }
  let scenes = vault.scenes;
  let entities = vault.entities;
  let changes = vault.changes;
  for (const list of byDoc.values()) {
    const { field, id } = list[0];
    const current = field === 'prose' ? vault.scenes[id]?.prose : field === 'entity-note' ? vault.entities[id]?.note : vault.changes[id]?.note;
    if (current === undefined) continue;
    let text = current;
    // From the end, so earlier positions stay valid.
    for (const m of [...list].sort((a, b) => b.start - a.start)) {
      if (text.slice(m.start, m.end) !== m.text) continue; // the text moved on since this find
      let out = opts.regex ? expand(replacement, m) : replacement;
      if (opts.preserveCase) out = matchCase(m.text, out);
      text = text.slice(0, m.start) + out + text.slice(m.end);
    }
    if (text === current) continue;
    if (field === 'prose') scenes = { ...scenes, [id]: { ...vault.scenes[id], prose: text } };
    else if (field === 'entity-note') entities = { ...entities, [id]: { ...vault.entities[id], note: text } };
    else changes = { ...changes, [id]: { ...vault.changes[id], note: text } };
  }
  return scenes === vault.scenes && entities === vault.entities && changes === vault.changes ? vault : { ...vault, scenes, entities, changes };
}
