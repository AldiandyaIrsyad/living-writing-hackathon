// Word counts for prose, as a reader sees it. Pure: no React, no DOM.
//
// What is counted: the text the reader sees once the note is rendered. Dropped: YAML frontmatter,
// author notes (outside code), markdown syntax (heading hashes, blockquote and list markers,
// task boxes, emphasis markers, code fence lines, link targets and image sources).
// Kept: link text (`[[target|alias]]` shows the alias, `[[target]]` shows the target), code content,
// tags and any other visible text. Bare URLs count as one word.

import { findAuthorNotesOutsideCode, parseLinks, type ParsedLink } from './links';
import { stripNotes } from './notes';
import { splitFrontmatter } from './markdown';
import type { Arc, Chapter, Id, Scene, Vault } from './types';

/** Reading speed used for reading time. */
export const WORDS_PER_MINUTE = 230;

// A URL (up to a non-punctuation character), or a run of letters/marks/digits that may contain
// inner apostrophes or hyphens (don't, well-known) and digit separators (1,234 and 3.5 stay whole).
const URL_SRC = String.raw`(?:https?:\/\/|www\.)[^\s<>]*[^\s<>.,;:!?)\]}"'’”]`;
const WORD_SRC = String.raw`[\p{L}\p{M}\p{N}]+(?:(?:['’\-‑]|(?<=\p{N})[.,](?=\p{N}))[\p{L}\p{M}\p{N}]+)*`;
const WORD_RE = new RegExp(`${URL_SRC}|${WORD_SRC}`, 'giu');

// Chinese, Japanese, Thai and a few other scripts put no spaces between words, so a whole sentence matches WORD_RE as
// one run. Those runs are split into words by the platform's dictionary segmenter instead.
const SPACELESS_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
let segmenter: Intl.Segmenter | null | undefined;

function wordsInRun(run: string): number {
  if (!SPACELESS_RE.test(run)) return 1;
  segmenter ??= typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
  if (!segmenter) return 1;
  let n = 0;
  for (const part of segmenter.segment(run)) if (part.isWordLike) n++;
  return Math.max(1, n);
}

const FENCE_OPEN_RE = /^ {0,3}(?:(`{3,})(?!.*`)|(~{3,}))/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/;
const BLOCKQUOTE_RE = /^(?:[ \t]*>)+/;
const HEADING_RE = /^ {0,3}#{1,6}(?=[ \t]|$)/;
const CALLOUT_RE = /^[ \t]*\[!([A-Za-z][\w-]*)\][+-]?(.*)$/;
const LIST_RE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/;
const TASK_RE = /^[ \t]*\[[ xX]\](?=[ \t]|$)/;

/** The text a wikilink shows: its alias, else the target (with `#heading` when there is one). */
function linkDisplay(l: ParsedLink): string {
  if (l.alias !== undefined) return l.alias;
  return l.heading !== undefined ? `${l.target}#${l.heading}` : l.target;
}

/** Replaces every `[[...]]` / `![[...]]` (outside code) by the text it shows. */
function replaceWikilinks(text: string): string {
  const links = parseLinks(text);
  if (links.length === 0) return text;
  let out = '';
  let last = 0;
  for (const l of links) {
    out += text.slice(last, l.start) + linkDisplay(l);
    last = l.end;
  }
  return out + text.slice(last);
}

/** Strips the markdown syntax of one line that is outside code. */
function cleanLine(line: string): string {
  const quoted = BLOCKQUOTE_RE.test(line);
  let s = line.replace(BLOCKQUOTE_RE, '');
  s = s.replace(HEADING_RE, '');
  if (quoted) {
    const callout = CALLOUT_RE.exec(s);
    if (callout) s = callout[2].trim() === '' ? callout[1] : callout[2];
  }
  s = s.replace(LIST_RE, '').replace(TASK_RE, '');
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ''); // images show no text
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // link text stays, its target goes
  s = s.replace(/\[\^[^\]]*\]/g, ''); // footnote references
  s = s.replace(/`+/g, ''); // code span markers; the code itself stays
  return s.trim();
}

/** Strips markdown syntax line by line. Fenced code keeps its content and loses only the fence lines. */
function cleanMarkdown(text: string): string {
  const out: string[] = [];
  let fence: { ch: string; len: number } | null = null;
  for (const line of text.split('\n')) {
    if (fence === null) {
      const open = FENCE_OPEN_RE.exec(line);
      if (open) {
        const marker = open[1] ?? open[2];
        fence = { ch: marker[0], len: marker.length };
        out.push('');
      } else {
        out.push(cleanLine(line));
      }
      continue;
    }
    const close = FENCE_CLOSE_RE.exec(line);
    if (close && close[1][0] === fence.ch && close[1].length >= fence.len) {
      fence = null;
      out.push('');
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

/**
 * The visible prose of a document: frontmatter, author notes and markdown structure removed (heading
 * hashes, list and quote markers, fences, link targets), link text in place of wikilinks. Emphasis
 * characters stay in place; they never form words. What `countWords` counts.
 */
export function plainText(source: string): string {
  const { body } = splitFrontmatter(source);
  const notes = findAuthorNotesOutsideCode(body);
  const visible = notes.length === 0 ? body : stripNotes(body, notes);
  return cleanMarkdown(replaceWikilinks(visible));
}

/** Number of words a reader sees in a prose document. */
export function countWords(text: string): number {
  let n = 0;
  for (const m of plainText(text).matchAll(WORD_RE)) n += wordsInRun(m[0]);
  return n;
}

/** Whole minutes to read `words` at WORDS_PER_MINUTE: 0 for none, otherwise at least 1. */
export function readingMinutes(words: number): number {
  if (!(words > 0)) return 0;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

/** `1234` → `1,234`. */
export function formatCount(n: number): string {
  return Math.round(Math.max(0, n)).toLocaleString('en-US');
}

/** Short form for tight spaces: `999`, `1k`, `1.2k`, `12k`, `1.5M`. */
export function formatCompact(n: number): string {
  const v = Math.round(Math.max(0, n));
  if (v < 1000) return String(v);
  if (v < 1_000_000) {
    const k = v / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

// ---------------------------------------------------------------------------
// Per-scene cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  prose: string;
  count: number;
}

const sceneCache = new Map<Id, CacheEntry>();

/** Word count of one scene. Recounts only when the scene's prose string changes. */
export function sceneWordCount(scene: Pick<Scene, 'id' | 'prose'>): number {
  const hit = sceneCache.get(scene.id);
  if (hit !== undefined && hit.prose === scene.prose) return hit.count;
  const count = countWords(scene.prose);
  sceneCache.set(scene.id, { prose: scene.prose, count });
  return count;
}

/** Drops cached counts of scenes that no longer exist in the vault. */
function pruneSceneCache(vault: Vault): void {
  for (const id of sceneCache.keys()) {
    if (!(id in vault.scenes)) sceneCache.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Story totals
// ---------------------------------------------------------------------------

export interface StoryWordCounts {
  /** Words of all scenes in the story. */
  total: number;
  /**
   * Words per chapter of the story. Every chapter of the story has an entry (0 when empty).
   * The `null` key appears only when some scene is outside a chapter of this story.
   */
  byChapter: Map<Id | null, number>;
  /**
   * Words per arc of the story. Every arc has an entry. The `null` key collects chapters without
   * a valid arc and loose scenes, and appears only when it has words in it.
   */
  byArc: Map<Id | null, number>;
  /** Words per scene of the story. */
  byScene: Map<Id, number>;
}

/** Word totals of one story: overall, per chapter, per arc and per scene. */
export function storyWordCounts(vault: Vault, storyId: Id): StoryWordCounts {
  pruneSceneCache(vault);
  const chapters = Object.values(vault.chapters).filter((c: Chapter) => c.storyId === storyId);
  const chapterIds = new Set(chapters.map((c) => c.id));
  const arcIds = new Set(
    Object.values(vault.arcs)
      .filter((a: Arc) => a.storyId === storyId)
      .map((a) => a.id),
  );

  const byChapter = new Map<Id | null, number>();
  const byArc = new Map<Id | null, number>();
  const byScene = new Map<Id, number>();
  for (const c of chapters) byChapter.set(c.id, 0);
  for (const id of arcIds) byArc.set(id, 0);

  let total = 0;
  for (const s of Object.values(vault.scenes)) {
    if (s.storyId !== storyId) continue;
    const words = sceneWordCount(s);
    byScene.set(s.id, words);
    total += words;

    const chapterKey = s.chapterId !== null && chapterIds.has(s.chapterId) ? s.chapterId : null;
    byChapter.set(chapterKey, (byChapter.get(chapterKey) ?? 0) + words);

    const chapter = chapterKey === null ? undefined : vault.chapters[chapterKey];
    const arcKey = chapter?.arcId !== undefined && arcIds.has(chapter.arcId) ? chapter.arcId : null;
    byArc.set(arcKey, (byArc.get(arcKey) ?? 0) + words);
  }

  return { total, byChapter, byArc, byScene };
}
