// Manuscript export: a story's scenes in reading order, rendered as Markdown, plain text or a
// print-ready HTML book. Pure TS: no React, no DOM.

import type { Arc, Chapter, Id, Scene, Story, Vault } from './types';
import { findAuthorNotes, stripAuthorNotes } from './notes';
import { findEntity, findScene, parseLinks } from './links';
import type { ParsedLink } from './links';
import { renderMarkdown, splitFrontmatter } from './markdown';

export interface ManuscriptOptions {
  storyId: Id;
  /** Chapter ids to include, in any order; null = all chapters + scenes without a chapter. */
  chapterIds: Id[] | null;
  /** Default: true when chapterIds is null, false otherwise. */
  includeUnchaptered?: boolean;
  /** Scene titles as subheadings, "* * *" between scenes, or nothing. */
  sceneSeparator: 'titles' | 'breaks' | 'none';
  chapterHeadings: boolean;
  /** Default false: author notes are stripped. */
  keepNotes: boolean;
  /** Only scenes the writer marked done. Default false. */
  onlyDone?: boolean;
  /** Defaults to the story name. */
  title?: string;
  author?: string;
}

export interface ManuscriptChapter {
  /** null for the group of scenes without a chapter. */
  id: Id | null;
  title: string | null;
  arcTitle: string | null;
  scenes: { id: Id; title: string; text: string }[];
}

export interface Manuscript {
  title: string;
  author?: string;
  chapters: ManuscriptChapter[];
  wordCount: number;
}

const SCENE_BREAK = '* * *';
const HEADING_LINE_RE = /^\s{0,3}#{1,6}\s/;
const WORD_RE = /[\p{L}\p{N}]/u;
const HR_RE = /^\s*([*_-])(?:\s*\1){2,}\s*$/;

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

export function buildManuscript(vault: Vault, opts: ManuscriptOptions): Manuscript {
  const story: Story | undefined = vault.stories[opts.storyId];
  const title = opts.title?.trim() || story?.name.trim() || 'Untitled';
  const author = opts.author?.trim() || undefined;
  const includeUnchaptered = opts.includeUnchaptered ?? opts.chapterIds === null;
  const wanted = opts.chapterIds === null ? null : new Set(opts.chapterIds);

  const chapters = byOrder(Object.values(vault.chapters).filter((c) => c.storyId === opts.storyId));
  const chapterIds = new Set(chapters.map((c) => c.id));
  const scenes = byOrder(Object.values(vault.scenes).filter((s) => s.storyId === opts.storyId && (!opts.onlyDone || s.status === 'done')));

  const scenesByChapter = new Map<Id, Scene[]>();
  const loose: Scene[] = [];
  for (const s of scenes) {
    if (s.chapterId !== null && chapterIds.has(s.chapterId)) {
      const list = scenesByChapter.get(s.chapterId) ?? [];
      list.push(s);
      scenesByChapter.set(s.chapterId, list);
    } else {
      loose.push(s);
    }
  }

  const cache: LabelCache = new Map();
  const toChapter = (
    id: Id | null,
    chapterTitle: string | null,
    arcTitle: string | null,
    list: Scene[],
  ): ManuscriptChapter => ({
    id,
    title: chapterTitle,
    arcTitle,
    scenes: list.map((s) => ({
      id: s.id,
      title: s.title,
      text: cleanProse(s.prose, vault, opts.keepNotes, cache),
    })),
  });

  const out: ManuscriptChapter[] = [];
  for (const c of chapters) {
    if (wanted !== null && !wanted.has(c.id)) continue;
    out.push(toChapter(c.id, c.title, arcTitleOf(vault, c), scenesByChapter.get(c.id) ?? []));
  }
  if (includeUnchaptered && loose.length > 0) out.push(toChapter(null, null, null, loose));

  const wordCount = out.reduce(
    (sum, ch) => sum + ch.scenes.reduce((n, s) => n + countWords(s.text), 0),
    0,
  );
  return { title, author, chapters: out, wordCount };
}

function byOrder<T extends { order: number }>(items: T[]): T[] {
  return items.sort((a, b) => a.order - b.order);
}

function arcTitleOf(vault: Vault, chapter: Chapter): string | null {
  if (chapter.arcId === undefined) return null;
  const arc: Arc | undefined = vault.arcs[chapter.arcId];
  return arc !== undefined && arc.storyId === chapter.storyId ? arc.title : null;
}

// ---------------------------------------------------------------------------
// Scene text processing
// ---------------------------------------------------------------------------

/** Per-build cache of link labels, so each target is looked up once. */
type LabelCache = Map<string, string>;

function linkLabel(vault: Vault, link: ParsedLink, cache: LabelCache): string {
  if (link.alias !== undefined) return link.alias;
  const hit = cache.get(link.target);
  if (hit !== undefined) return hit;
  const label = findEntity(vault, link.target)?.name ?? findScene(vault, link.target)?.title ?? link.target;
  cache.set(link.target, label);
  return label;
}

function replaceLinks(text: string, vault: Vault, cache: LabelCache): string {
  const links = parseLinks(text);
  if (links.length === 0) return text;
  let out = '';
  let last = 0;
  for (const link of links) {
    out += text.slice(last, link.start) + linkLabel(vault, link, cache);
    last = link.end;
  }
  return out + text.slice(last);
}

/**
 * The cleaned markdown of a scene: frontmatter dropped, author notes stripped (or kept as-is),
 * `[[links]]` and `![[embeds]]` replaced by plain text.
 */
function cleanProse(prose: string, vault: Vault, keepNotes: boolean, cache: LabelCache): string {
  let text = splitFrontmatter(prose).body;
  if (!keepNotes) text = stripAuthorNotes(text);
  return replaceLinks(text, vault, cache).trim();
}

type Segment = { kind: 'text' | 'note'; value: string };

/** Splits cleaned prose into plain markdown runs and author notes (kept notes only). */
function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const note of findAuthorNotes(text)) {
    if (note.start > last) out.push({ kind: 'text', value: text.slice(last, note.start) });
    out.push({ kind: 'note', value: note.text });
    last = note.end;
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
  return out;
}

function countWords(text: string): number {
  let n = 0;
  for (const line of text.split('\n')) {
    if (HEADING_LINE_RE.test(line)) continue;
    for (const token of line.split(/\s+/)) {
      if (WORD_RE.test(token)) n++;
    }
  }
  return n;
}

/** Strips markdown syntax from prose, keeping its paragraphs. */
function stripMarkdown(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      if (HR_RE.test(line)) return SCENE_BREAK;
      let s = line.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/^\s{0,3}>\s?/, '');
      s = s.replace(/^(\s*)[-+*]\s+/, '$1• ');
      s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
      s = s.replace(/`([^`]+)`/g, '$1');
      s = s.replace(/(\*\*|__)(?=\S)(.*?\S)\1/g, '$2');
      s = s.replace(/\*(?=\S)(.*?\S)\*/g, '$1');
      s = s.replace(/(^|[^\p{L}\p{N}])_(?=\S)(.*?\S)_(?![\p{L}\p{N}])/gu, '$1$2');
      s = s.replace(/~~(.*?)~~/g, '$1');
      return s.replace(/\\([\\`*_{}[\]()#+.!>~|-])/g, '$1');
    })
    .join('\n');
}

function proseToPlain(text: string): string {
  return segments(text)
    .map((seg) => {
      if (seg.kind === 'note') return seg.value === '' ? '' : `[Note: ${seg.value}]`;
      return stripMarkdown(seg.value);
    })
    .join('')
    .trim();
}

function proseToHtml(text: string): string {
  const notes: string[] = [];
  let src = '';
  for (const seg of segments(text)) {
    if (seg.kind === 'note') {
      src += `lwauthornote${notes.length}x`;
      notes.push(seg.value);
    } else {
      src += seg.value;
    }
  }
  if (src.trim() === '') return '';
  // Links are already plain text here, so the renderer never has to resolve anything.
  const { html } = renderMarkdown(src, { resolveLink: () => ({ resolved: false }) });
  const noteAt = (_match: string, i: string): string => noteHtml(notes[Number(i)] ?? '');
  return html
    .replace(/<p>\s*lwauthornote(\d+)x\s*<\/p>\n?/g, noteAt)
    .replace(/lwauthornote(\d+)x/g, noteAt);
}

function noteHtml(value: string): string {
  return value === '' ? '' : `<aside class="author-note">${escHtml(value)}</aside>`;
}

// ---------------------------------------------------------------------------
// Escaping and small helpers
// ---------------------------------------------------------------------------

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapes the characters that would otherwise start inline markdown syntax. */
function escMd(s: string): string {
  return s.replace(/([\\`*_[\]])/g, '\\$1');
}

/** Trimmed chapter title, or null when there is nothing to show as a heading. */
function headingOf(title: string | null): string | null {
  if (title === null) return null;
  const t = title.trim();
  return t === '' ? null : t;
}

function plainHeading(text: string, rule: '=' | '-'): string {
  const upper = text.toUpperCase();
  return `${upper}\n${rule.repeat(Math.max(3, upper.length))}`;
}

// ---------------------------------------------------------------------------
// Output formats
// ---------------------------------------------------------------------------

export function toMarkdown(m: Manuscript, opts: ManuscriptOptions): string {
  const blocks: string[] = [`# ${escMd(m.title)}`];
  if (m.author !== undefined) blocks.push(`*by ${escMd(m.author)}*`);
  for (const ch of m.chapters) {
    const chTitle = headingOf(ch.title);
    if (opts.chapterHeadings && chTitle !== null) blocks.push(`## ${escMd(chTitle)}`);
    ch.scenes.forEach((s, i) => {
      if (i > 0 && opts.sceneSeparator === 'breaks') blocks.push(SCENE_BREAK);
      const sceneTitle = s.title.trim();
      if (opts.sceneSeparator === 'titles' && sceneTitle !== '') blocks.push(`### ${escMd(sceneTitle)}`);
      if (s.text !== '') blocks.push(s.text);
    });
  }
  return `${blocks.join('\n\n')}\n`;
}

export function toPlainText(m: Manuscript, opts: ManuscriptOptions): string {
  const blocks: string[] = [plainHeading(m.title, '=')];
  if (m.author !== undefined) blocks.push(`by ${m.author}`);
  for (const ch of m.chapters) {
    const chTitle = headingOf(ch.title);
    if (opts.chapterHeadings && chTitle !== null) blocks.push(plainHeading(chTitle, '-'));
    ch.scenes.forEach((s, i) => {
      if (i > 0 && opts.sceneSeparator === 'breaks') blocks.push(SCENE_BREAK);
      const sceneTitle = s.title.trim();
      if (opts.sceneSeparator === 'titles' && sceneTitle !== '') blocks.push(sceneTitle);
      const text = proseToPlain(s.text);
      if (text !== '') blocks.push(text);
    });
  }
  return `${blocks.join('\n\n')}\n`;
}

const BOOK_CSS = `
@page { margin: 2.2cm 2.2cm 2.4cm; }
:root { color-scheme: light; }
* { box-sizing: border-box; }
html { background: #f7f4ee; }
body {
  margin: 0;
  background: #f7f4ee;
  color: #1f1c18;
  font-family: Georgia, 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Times New Roman', serif;
  font-size: 1.0625rem;
  line-height: 1.65;
  text-rendering: optimizeLegibility;
  font-variant-ligatures: common-ligatures;
}
.book { max-width: 36em; margin: 0 auto; padding: 4rem 1.5rem 6rem; }
.title-page { padding: 22vh 0 16vh; text-align: center; break-after: page; }
.book-title { margin: 0; font-size: 2.6rem; font-weight: normal; line-height: 1.2; }
.book-author { margin: 1.5rem 0 0; font-style: italic; color: #6b6259; }
.chapter h2 {
  margin: 4.5rem 0 2.25rem;
  font-size: 1.6rem;
  font-weight: normal;
  text-align: center;
  letter-spacing: 0.02em;
  break-before: page;
  break-after: avoid;
}
.scene-title {
  margin: 2.25rem 0 1rem;
  font-size: 1.1rem;
  font-weight: bold;
  font-style: italic;
  text-align: center;
  break-after: avoid;
}
.prose p { margin: 0; orphans: 2; widows: 2; }
.prose p + p { text-indent: 1.5em; }
.prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6 {
  margin: 1.5em 0 0.5em;
  font-size: 1.05em;
  font-weight: bold;
  break-after: avoid;
}
.prose blockquote { margin: 1em 2em; font-style: italic; }
.prose ul, .prose ol { margin: 0.75em 0; padding-left: 1.6em; }
.prose hr {
  width: 3em;
  margin: 2em auto;
  border: 0;
  border-top: 1px solid currentColor;
}
.prose a { color: inherit; text-decoration: none; }
.ornament {
  margin: 2.5rem 0;
  text-align: center;
  letter-spacing: 0.5em;
  color: #6b6259;
  break-after: avoid;
}
.author-note {
  display: block;
  margin: 1em 0;
  padding: 0.4em 0.9em;
  border-left: 3px solid #c9a27e;
  background: #f1e9de;
  color: #6b5a4a;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 0.85em;
}
@media print {
  html, body { background: #fff; }
  body { color: #000; font-size: 11.5pt; }
  .book { max-width: none; margin: 0; padding: 0; }
  .title-page { padding: 30vh 0 0; }
  .chapter h2 { break-before: page; }
  .prose a { color: #000; }
  .author-note { background: none; border-left-color: #999; color: #444; }
}
`;

export function toHTML(m: Manuscript, opts: ManuscriptOptions): string {
  const body: string[] = [];
  body.push('<section class="title-page">');
  body.push(`<h1 class="book-title">${escHtml(m.title)}</h1>`);
  if (m.author !== undefined) body.push(`<p class="book-author">by ${escHtml(m.author)}</p>`);
  body.push('</section>');

  for (const ch of m.chapters) {
    body.push('<section class="chapter">');
    const chTitle = headingOf(ch.title);
    if (opts.chapterHeadings && chTitle !== null) body.push(`<h2>${escHtml(chTitle)}</h2>`);
    ch.scenes.forEach((s, i) => {
      if (i > 0 && opts.sceneSeparator === 'breaks') body.push(`<p class="ornament">${SCENE_BREAK}</p>`);
      const sceneTitle = s.title.trim();
      if (opts.sceneSeparator === 'titles' && sceneTitle !== '') {
        body.push(`<h3 class="scene-title">${escHtml(sceneTitle)}</h3>`);
      }
      const html = proseToHtml(s.text);
      if (html !== '') body.push(`<div class="prose">\n${html}</div>`);
    });
    body.push('</section>');
  }

  const authorMeta = m.author !== undefined ? `<meta name="author" content="${escHtml(m.author)}">\n` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Living Writing">
${authorMeta}<title>${escHtml(m.title)}</title>
<style>${BOOK_CSS}</style>
</head>
<body>
<main class="book">
${body.join('\n')}
</main>
</body>
</html>
`;
}

const RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** A file name for the manuscript, safe on Windows, macOS and Linux. */
export function manuscriptFileName(m: Manuscript, ext: 'md' | 'txt' | 'html'): string {
  const kept = [...m.title]
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127 && !'<>:"/\\|?*'.includes(ch))
    .join('');
  let base = kept
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+/, '')
    .slice(0, 120)
    .replace(/[. ]+$/, '');
  if (base === '') base = 'manuscript';
  if (RESERVED_NAMES.test(base)) base = `_${base}`;
  return `${base}.${ext}`;
}
