// State queries: "which entities, at this point in the story, are like this?" Written as
//
//   where type=Person status=dead #noble at latest
//   where location=[[the keep]] status!=dead at "The Fall of Ashford"
//
// Terms are `name=value` / `name!=value` (a property, or `type` for the entity's type), `#tag`, `gone` (retired or not yet
// existing; without it only entities that exist are returned) and a last `at playhead` | `at latest` | `at Scene title`.
// Pure: parsing, printing and running, with the vault and a resolver passed in.

import { findEntity, findScene, normalizeTag, parseTags } from './links';
import type { Resolver } from './resolve';
import { isLink, LATEST, slugify, type Id, type PropValue, type TimePoint, type Vault } from './types';

export interface Term {
  /** A property name, or `type` (the entity type's name). */
  name: string;
  op: '=' | '!=';
  /** What the author wrote; empty means "unset". A [[link]] is kept with its brackets. */
  value: string;
}

export type When = { kind: 'playhead' } | { kind: 'latest' } | { kind: 'scene'; title: string };

export interface StateQuery {
  terms: Term[];
  tags: string[];
  /** Entities that exist at that time (default), or the ones that do not. */
  gone: boolean;
  when: When;
}

export type ParseResult = { ok: true; query: StateQuery } | { ok: false; error: string };

const TERM = /([\p{L}\p{N}_-]+)(!=|=)("[^"]*"|\[\[[^\]]*\]\]|[^\s"]*)/uy;

const unquote = (v: string) => (v.startsWith('"') && v.endsWith('"') && v.length >= 2 ? v.slice(1, -1) : v);

/** Reads the part of a palette query after the word `where`. */
export function parseStateQuery(text: string): ParseResult {
  let rest = text.trim();
  let when: When = { kind: 'playhead' };
  const at = /(?:^|\s)at\s+(?:"([^"]*)"|(\S.*?))\s*$/iu.exec(rest);
  if (at) {
    const word = (at[1] ?? at[2]).trim();
    if (at[1] === undefined && /^playhead$/i.test(word)) when = { kind: 'playhead' };
    else if (at[1] === undefined && /^latest$/i.test(word)) when = { kind: 'latest' };
    else if (word === '') return { ok: false, error: 'Say which scene after “at”.' };
    else when = { kind: 'scene', title: word };
    rest = rest.slice(0, at.index).trim();
  }

  const q: StateQuery = { terms: [], tags: [], gone: false, when };
  let pos = 0;
  while (pos < rest.length) {
    if (/\s/.test(rest[pos])) {
      pos++;
      continue;
    }
    TERM.lastIndex = pos;
    const t = TERM.exec(rest);
    if (t) {
      q.terms.push({ name: t[1], op: t[2] as Term['op'], value: unquote(t[3]) });
      pos = TERM.lastIndex;
      continue;
    }
    const word = /^\S+/u.exec(rest.slice(pos))![0];
    if (word.startsWith('#')) {
      const tag = normalizeTag(word.slice(1));
      if (tag === null) return { ok: false, error: `“${word}” is not a tag.` };
      q.tags.push(tag);
    } else if (/^gone$/i.test(word)) q.gone = true;
    else if (!/^exists$/i.test(word)) return { ok: false, error: `Did not understand “${word}”. Use name=value, #tag, gone or at …` };
    pos += word.length;
  }
  return { ok: true, query: q };
}

const needsQuotes = (v: string) => v === '' || (!/^\[\[[^\]]*\]\]$/.test(v) && /[\s"=!#]/.test(v));

/** The query as text, in a fixed order, so `parseStateQuery(formatStateQuery(q))` gives `q` back. */
export function formatStateQuery(q: StateQuery): string {
  const parts: string[] = q.terms.map((t) => `${t.name}${t.op}${needsQuotes(t.value) ? `"${t.value}"` : t.value}`);
  for (const tag of q.tags) parts.push(`#${tag}`);
  if (q.gone) parts.push('gone');
  if (q.when.kind === 'latest') parts.push('at latest');
  else if (q.when.kind === 'scene') parts.push(`at "${q.when.title}"`);
  return parts.join(' ');
}

/** The point in time a query asks about, or null when it names a scene that does not exist. */
export function whenToTimePoint(vault: Vault, when: When, playhead: number): TimePoint | null {
  if (when.kind === 'playhead') return { kind: 'position', x: playhead };
  if (when.kind === 'latest') return LATEST;
  const scene = findScene(vault, when.title);
  return scene ? { kind: 'moment', momentId: scene.momentId, includeSceneId: scene.id } : null;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Whether a stored value is the wanted one: a list matches when any item does; a link matches by the page it points at. */
function valueMatches(vault: Vault, actual: PropValue | undefined, wanted: string): boolean {
  if (wanted === '') return actual === undefined || actual === '' || (Array.isArray(actual) && actual.length === 0);
  if (actual === undefined) return false;
  const items = Array.isArray(actual) ? actual : [actual];
  const wantedTarget = /^\[\[(.*)\]\]$/.exec(wanted)?.[1];
  const wantedEntity = findEntity(vault, wantedTarget ?? wanted)?.id;
  return items.some((item) => {
    if (isLink(item)) {
      const same = findEntity(vault, item.target)?.id;
      return same !== undefined && same === wantedEntity ? true : slugify(item.target) === slugify(wantedTarget ?? wanted);
    }
    if (wantedTarget !== undefined) return false;
    return norm(String(item)) === norm(wanted);
  });
}

/** The entities that match, in the order of their names as of that time. */
export function runStateQuery(vault: Vault, resolver: Resolver, query: StateQuery, tp: TimePoint): Id[] {
  const out: { id: Id; name: string }[] = [];
  for (const e of Object.values(vault.entities)) {
    const state = resolver.entityAt(e.id, tp);
    if (state.exists === query.gone) continue;
    const matches = query.terms.every((t) => {
      const actual = norm(t.name) === 'type' ? vault.entityTypes[e.typeId]?.name : state.props[t.name]?.value;
      const ok = valueMatches(vault, actual, t.value);
      return t.op === '=' ? ok : !ok;
    });
    if (!matches) continue;
    if (query.tags.length > 0) {
      const have = parseTags(state.note);
      if (!query.tags.every((want) => have.some((h) => h === want || h.startsWith(`${want}/`)))) continue;
    }
    out.push({ id: e.id, name: state.name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name)).map((x) => x.id);
}

/** Runs a query as asked: at the playhead, at the latest point, or after a named scene. */
export function answerStateQuery(vault: Vault, resolver: Resolver, query: StateQuery, playhead: number): { ok: true; ids: Id[] } | { ok: false; error: string } {
  const tp = whenToTimePoint(vault, query.when, playhead);
  if (!tp) return { ok: false, error: `There is no scene called “${query.when.kind === 'scene' ? query.when.title : ''}”.` };
  return { ok: true, ids: runStateQuery(vault, resolver, query, tp) };
}
