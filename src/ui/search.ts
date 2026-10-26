// Pure search helpers for the quick switcher, search view and tag view. No React or DOM.

import { momentConcrete } from '../core/concrete';
import { parseTags } from '../core/links';
import type { Id, Vault } from '../core/types';

const WORD_CHAR = /[\p{L}\p{N}]/u;
const SNIPPET_LENGTH = 80;

/**
 * Subsequence fuzzy match: every character of `query` must appear in `text`, in order.
 * Higher is better. Prefix matches, word starts and contiguous runs score extra; gaps and
 * long texts score a little less. Returns null when there is no match.
 * An empty query matches everything with score 0.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (q === '') return 0;
  const t = text.toLowerCase();

  let score = 0;
  let pos = 0;
  let prev = -2;
  for (const ch of q) {
    const at = t.indexOf(ch, pos);
    if (at === -1) return null;
    score += 1;
    if (at === prev + 1) score += 4; // contiguous run
    if (at === 0 || !WORD_CHAR.test(t[at - 1])) score += 3; // word start
    score -= (at - pos) * 0.2; // gap before this character
    prev = at;
    pos = at + 1;
  }
  if (t.startsWith(q)) score += 8; // prefix
  score -= t.length * 0.01; // shorter names win ties
  return score;
}

export interface SearchHit {
  kind: 'entity' | 'scene';
  id: Id;
  title: string;
  /** About 80 characters of source text around the first match. */
  snippet: string;
  /** Offset of the first match inside the matched field (name, alias, note, title or prose). */
  index: number;
}

export interface TextPart {
  text: string;
  match: boolean;
}

interface Ranked {
  /** 0 = matched a name or title, 1 = matched the body text. */
  rank: number;
  hit: SearchHit;
}

function firstMatch(needle: string, texts: string[]): { text: string; index: number } | null {
  for (const text of texts) {
    const index = text.toLowerCase().indexOf(needle);
    if (index !== -1) return { text, index };
  }
  return null;
}

function snippetAround(text: string, index: number, length: number): string {
  const pad = Math.max(0, Math.floor((SNIPPET_LENGTH - length) / 2));
  const start = Math.max(0, index - pad);
  const end = Math.min(text.length, index + length + pad);
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`;
}

function locate(
  needle: string,
  kind: SearchHit['kind'],
  id: Id,
  title: string,
  titles: string[],
  body: string,
): Ranked | null {
  const inTitle = firstMatch(needle, titles);
  const found = inTitle ?? firstMatch(needle, [body]);
  if (!found) return null;
  return {
    rank: inTitle ? 0 : 1,
    hit: { kind, id, title, snippet: snippetAround(found.text, found.index, needle.length), index: found.index },
  };
}

/**
 * Case-insensitive substring search over entity names, aliases and notes, and scene titles and prose.
 * Name and title matches come first. Blank queries return nothing.
 */
export function fullTextSearch(vault: Vault, query: string, limit = 50): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];

  const ranked: Ranked[] = [];
  for (const e of Object.values(vault.entities)) {
    const r = locate(needle, 'entity', e.id, e.name, [e.name, ...e.aliases], e.note);
    if (r) ranked.push(r);
  }
  for (const s of Object.values(vault.scenes)) {
    const chLabels = s.chapterId ? (vault.chapters[s.chapterId]?.labels ?? []) : [];
    const scLabels = [...(s.labels ?? []), ...chLabels];
    const concrete = momentConcrete(vault.moments[s.momentId]);
    const extraTitles = [...scLabels, ...(concrete ? [concrete] : [])];
    const r = locate(needle, 'scene', s.id, s.title, [s.title, ...extraTitles], s.prose);
    if (r) ranked.push(r);
  }
  ranked.sort((a, b) => a.rank - b.rank || a.hit.title.localeCompare(b.hit.title));
  return ranked.slice(0, limit).map((r) => r.hit);
}

interface Tagged {
  kind: 'entity' | 'scene';
  id: Id;
  title: string;
  tags: string[];
}

function tagged(vault: Vault): Tagged[] {
  const out: Tagged[] = [];
  for (const e of Object.values(vault.entities)) {
    out.push({ kind: 'entity', id: e.id, title: e.name, tags: parseTags(e.note) });
  }
  for (const s of Object.values(vault.scenes)) {
    out.push({ kind: 'scene', id: s.id, title: s.title, tags: parseTags(s.prose) });
  }
  return out;
}

/** Every tag used in notes or prose, with the number of entities and scenes using it. Sorted by tag. */
export function allTags(vault: Vault): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of tagged(vault)) {
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

export interface TaggedItem {
  kind: 'entity' | 'scene';
  id: Id;
  title: string;
}

/**
 * Entities and scenes tagged `tag` or any sub-tag of it (`tag/...`). A leading `#` is ignored.
 * Matching is on whole tags, so `magic` does not match `magicfire`.
 */
export function itemsWithTag(vault: Vault, tag: string): TaggedItem[] {
  const want = tag.trim().replace(/^#/, '');
  if (want === '') return [];
  const prefix = `${want}/`;
  return tagged(vault)
    .filter((item) => item.tags.some((t) => t === want || t.startsWith(prefix)))
    .map(({ kind, id, title }) => ({ kind, id, title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Splits `text` into plain and matching parts for highlighting (case-insensitive). */
export function splitMatches(text: string, query: string): TextPart[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [{ text, match: false }];
  const lower = text.toLowerCase();
  const parts: TextPart[] = [];
  let pos = 0;
  for (;;) {
    const at = lower.indexOf(needle, pos);
    if (at === -1) break;
    if (at > pos) parts.push({ text: text.slice(pos, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    pos = at + needle.length;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), match: false });
  return parts;
}
