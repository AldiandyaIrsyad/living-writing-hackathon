import MarkdownIt from 'markdown-it';
import type { StateCore, StateInline, Token } from 'markdown-it';
import YAML from 'yaml';
import type { ParsedLink } from './links';
import { findAuthorNotesOutsideCode, parseLinkInner, normalizeTag } from './links';
import { stripNotes, type AuthorNote } from './notes';

export interface LinkResolution {
  resolved: boolean;
  kind?: 'entity' | 'scene';
  id?: string;
  display?: string;
}

export interface RenderContext {
  resolveLink(link: ParsedLink): LinkResolution;
  /** Return HTML for an embed. depth starts at 1. If absent, embeds render as a plain link. */
  renderEmbed?(link: ParsedLink, depth: number): string;
  /** Current depth, default 0. Embedding stops at depth >= 3. */
  depth?: number;
  /**
   * Author notes are hidden unless this is true. When true, each note renders as a muted
   * `<span class="author-note">` with its text escaped (no links or formatting inside).
   */
  showNotes?: boolean;
}

/** Maximum nesting depth for embeds (`![[x]]` inside an embed inside an embed ...). */
const MAX_EMBED_DEPTH = 3;

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

// Empty block (`---` directly followed by `---`) is tried first so it cannot swallow a later `---`.
const FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n(?:---[ \t]*(?:\r?\n|$)|([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$))/;

/**
 * Splits a leading `---` YAML block off the document. `data` is null when there is no
 * frontmatter, or when it is present but is not a YAML mapping (the block is still stripped).
 */
export function splitFrontmatter(text: string): { data: Record<string, unknown> | null; body: string } {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return { data: null, body: text };
  const body = text.slice(m[0].length);
  const yamlText = m[1] ?? '';
  let data: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = YAML.parse(yamlText);
    if (parsed === null || parsed === undefined) {
      data = {};
    } else if (typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    data = null;
  }
  return { data, body };
}

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function formatFrontmatterValue(v: unknown): string {
  if (Array.isArray(v)) return v.map(formatScalar).join(', ');
  return formatScalar(v);
}

function renderFrontmatterTable(data: Record<string, unknown>): string {
  const rows = Object.entries(data)
    .map(([key, value]) => `<tr><th>${esc(key)}</th><td>${esc(formatFrontmatterValue(value))}</td></tr>`)
    .join('');
  return `<table class="frontmatter"><tbody>${rows}</tbody></table>\n`;
}

// ---------------------------------------------------------------------------
// markdown-it plugin: wikilinks, embeds, tags, callouts, task lists
// ---------------------------------------------------------------------------

type MdEnv = {
  ctx: RenderContext;
  depth: number;
};

type WikiMeta = {
  link: ParsedLink;
  /** Embed rendered as a block (paragraph consisting only of the embed). */
  block: boolean;
};

type TagMeta = {
  tag: string;
};

const WIKI_TOKEN = 'lw_wikilink';
const TAG_TOKEN = 'lw_tag';
const CALLOUT_OPEN = 'lw_callout_open';
const CALLOUT_CLOSE = 'lw_callout_close';
const TASK_BOX = 'lw_task_checkbox';

/** Inline rule: `[[...]]` and `![[...]]`. Offsets in `link` are relative to the inline source. */
function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  const max = state.posMax;
  let open = start;
  let embed = false;
  if (src.charCodeAt(start) === 0x21 /* ! */) {
    embed = true;
    open = start + 1;
  }
  if (src.charCodeAt(open) !== 0x5b || src.charCodeAt(open + 1) !== 0x5b) return false;

  const innerStart = open + 2;
  const close = src.indexOf(']]', innerStart);
  if (close === -1 || close + 2 > max) return false;
  const inner = src.slice(innerStart, close);
  if (inner.includes('\n') || inner.includes('[[')) return false;

  const parsed = parseLinkInner(inner);
  if (parsed.target === '') return false;

  const end = close + 2;
  if (!silent) {
    const token = state.push(WIKI_TOKEN, '', 0);
    const meta: WikiMeta = {
      link: {
        raw: src.slice(start, end),
        start,
        end,
        embed,
        target: parsed.target,
        heading: parsed.heading,
        alias: parsed.alias,
        time: parsed.time,
        timeRaw: parsed.timeRaw,
      },
      block: false,
    };
    token.meta = meta;
  }
  state.pos = end;
  return true;
}

const TAG_BODY_RE = /^[\p{L}\p{N}_\-/]+/u;

/** Inline rule: `#tag`, `#tag/sub`. Must follow start of text or whitespace. */
function tagRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const pos = state.pos;
  if (src.charCodeAt(pos) !== 0x23 /* # */) return false;
  if (pos > 0 && !/\s/.test(src[pos - 1])) return false;

  const body = TAG_BODY_RE.exec(src.slice(pos + 1, state.posMax));
  if (!body) return false;
  const tag = normalizeTag(body[0]);
  if (tag === null) return false;

  if (!silent) {
    const token = state.push(TAG_TOKEN, '', 0);
    const meta: TagMeta = { tag };
    token.meta = meta;
  }
  state.pos = pos + 1 + tag.length;
  return true;
}

function canEmbed(env: MdEnv, link: ParsedLink): boolean {
  return env.ctx.renderEmbed !== undefined && env.depth < MAX_EMBED_DEPTH && env.ctx.resolveLink(link).resolved;
}

/** Core rule: an embed that is alone in its paragraph becomes a block embed. */
function markBlockEmbeds(state: StateCore): void {
  const env = state.env as unknown as MdEnv;
  const toks = state.tokens;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].type !== 'paragraph_open') continue;
    const inline = toks[i + 1];
    if (!inline || inline.type !== 'inline') continue;
    const significant = (inline.children ?? []).filter(
      (c) => c.type !== 'softbreak' && c.type !== 'hardbreak' && !(c.type === 'text' && c.content.trim() === ''),
    );
    if (significant.length !== 1 || significant[0].type !== WIKI_TOKEN) continue;
    const meta = significant[0].meta as WikiMeta;
    if (!meta.link.embed || !canEmbed(env, meta.link)) continue;
    meta.block = true;
    toks[i].hidden = true;
    const close = toks[i + 2];
    if (close && close.type === 'paragraph_close') close.hidden = true;
  }
}

const TASK_RE = /^\[([ xX])\](?:[ \t]+|$)/;

/** Core rule: `- [ ] item` / `- [x] item` become a disabled checkbox at the start of the item. */
function markTaskItems(state: StateCore): void {
  const toks = state.tokens;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].type !== 'list_item_open') continue;
    const paragraph = toks[i + 1];
    const inline = toks[i + 2];
    if (!paragraph || paragraph.type !== 'paragraph_open' || !inline || inline.type !== 'inline') continue;
    const children = inline.children ?? [];
    const first = children[0];
    if (!first || first.type !== 'text') continue;
    const m = TASK_RE.exec(first.content);
    if (!m) continue;

    first.content = first.content.slice(m[0].length);
    if (first.content === '') children.shift();

    const box = new state.Token(TASK_BOX, 'input', 0);
    box.meta = { checked: m[1] !== ' ' };
    children.unshift(box);
    inline.children = children;
    toks[i].attrSet('class', 'task');
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

const CALLOUT_RE = /^\[!([A-Za-z][\w-]*)\][+-]?[ \t]*(.*)$/;

/** Index of the blockquote_close matching the blockquote_open at `open`, or -1. */
function matchingBlockquoteClose(toks: Token[], open: number): number {
  let depth = 0;
  for (let j = open; j < toks.length; j++) {
    if (toks[j].type === 'blockquote_open') depth++;
    else if (toks[j].type === 'blockquote_close') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/** Core rule: `> [!type] Title` blockquotes become callouts. */
function markCallouts(state: StateCore): void {
  const toks = state.tokens;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].type !== 'blockquote_open') continue;
    const paragraph = toks[i + 1];
    const inline = toks[i + 2];
    if (!paragraph || paragraph.type !== 'paragraph_open' || !inline || inline.type !== 'inline') continue;
    const firstLine = inline.content.split('\n')[0];
    const m = CALLOUT_RE.exec(firstLine);
    if (!m) continue;
    const close = matchingBlockquoteClose(toks, i);
    if (close === -1) continue;

    const type = m[1].toLowerCase();
    const title = m[2].trim() || capitalize(type);

    // Drop the marker line; everything after the first line is the callout body.
    const children = inline.children ?? [];
    const brk = children.findIndex((c) => c.type === 'softbreak' || c.type === 'hardbreak');
    inline.children = brk === -1 ? [] : children.slice(brk + 1);
    if (inline.children.length === 0) {
      paragraph.hidden = true;
      const paragraphClose = toks[i + 3];
      if (paragraphClose && paragraphClose.type === 'paragraph_close') paragraphClose.hidden = true;
    }

    const open = toks[i];
    open.type = CALLOUT_OPEN;
    open.meta = {
      html: `<div class="callout callout-${esc(type)}"><div class="callout-title">${esc(title)}</div><div class="callout-body">\n`,
    };
    toks[close].type = CALLOUT_CLOSE;
  }
}

function renderWikilink(tokens: Token[], idx: number, _options: unknown, env: unknown): string {
  const meta = tokens[idx].meta as WikiMeta;
  const link = meta.link;
  const e = env as MdEnv;
  if (meta.block && e.ctx.renderEmbed) {
    const inner = e.ctx.renderEmbed(link, e.depth + 1);
    return `<div class="embed" data-link-target="${esc(link.target)}">${inner}</div>\n`;
  }

  const res = e.ctx.resolveLink(link);
  const fallback = link.heading ? `${link.target}#${link.heading}` : link.target;
  const display = link.alias ?? res.display ?? fallback;

  const attrs: string[] = [
    `class="${res.resolved ? 'wikilink' : 'wikilink unresolved'}"`,
    'href="#"',
    `data-link-raw="${esc(link.raw)}"`,
    `data-link-target="${esc(link.target)}"`,
  ];
  if (link.timeRaw !== undefined) attrs.push(`data-link-time="${esc(link.timeRaw)}"`);
  if (res.resolved && res.kind !== undefined) attrs.push(`data-kind="${esc(res.kind)}"`);
  if (res.resolved && res.id !== undefined) attrs.push(`data-id="${esc(res.id)}"`);
  return `<a ${attrs.join(' ')}>${esc(display)}</a>`;
}

function renderTag(tokens: Token[], idx: number): string {
  const { tag } = tokens[idx].meta as TagMeta;
  return `<a class="tag" href="#" data-tag="${esc(tag)}">#${esc(tag)}</a>`;
}

function renderCalloutOpen(tokens: Token[], idx: number): string {
  return (tokens[idx].meta as { html: string }).html;
}

function renderCalloutClose(): string {
  return '</div></div>\n';
}

function renderTaskBox(tokens: Token[], idx: number): string {
  const { checked } = tokens[idx].meta as { checked: boolean };
  return `<input type="checkbox" disabled${checked ? ' checked' : ''}> `;
}

function createMarkdownIt() {
  const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
  md.inline.ruler.before('link', 'lw_wikilink', wikilinkRule);
  md.inline.ruler.before('link', 'lw_tag', tagRule);
  md.core.ruler.after('inline', 'lw_block_embeds', markBlockEmbeds);
  md.core.ruler.after('inline', 'lw_task_items', markTaskItems);
  md.core.ruler.after('inline', 'lw_callouts', markCallouts);
  md.renderer.rules[WIKI_TOKEN] = renderWikilink;
  md.renderer.rules[TAG_TOKEN] = renderTag;
  md.renderer.rules[CALLOUT_OPEN] = renderCalloutOpen;
  md.renderer.rules[CALLOUT_CLOSE] = renderCalloutClose;
  md.renderer.rules[TASK_BOX] = renderTaskBox;
  return md;
}

const md = createMarkdownIt();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Private-use characters stand in for author notes while markdown-it runs, so the note text
// never reaches the parser. Notes outside code only; code keeps its `%%` literally.
const NOTE_OPEN = '';
const NOTE_CLOSE = '';
const NOTE_MARK_RE = /(\d+)/g;

/**
 * Prepares the body for markdown-it. Hidden notes are removed entirely (so links inside them
 * are never seen). Shown notes become numbered placeholders, restored after rendering.
 */
function prepareBody(body: string, showNotes: boolean): { src: string; notes: AuthorNote[] } {
  const notes = findAuthorNotesOutsideCode(body);
  if (notes.length === 0) return { src: body, notes };
  if (!showNotes) return { src: stripNotes(body, notes), notes };
  let src = '';
  let last = 0;
  notes.forEach((n, i) => {
    src += body.slice(last, n.start) + `${NOTE_OPEN}${i}${NOTE_CLOSE}`;
    last = n.end;
  });
  return { src: src + body.slice(last), notes };
}

export function renderMarkdown(
  text: string,
  ctx: RenderContext,
): { html: string; frontmatter: Record<string, unknown> | null } {
  const { data, body } = splitFrontmatter(text);
  const env: MdEnv = { ctx, depth: ctx.depth ?? 0 };
  const prepared = prepareBody(body, ctx.showNotes === true);
  let html = md.render(prepared.src, env);
  if (ctx.showNotes === true && prepared.notes.length > 0) {
    const notes = prepared.notes;
    html = html.replace(NOTE_MARK_RE, (mark, idx: string) => {
      const note = notes[Number(idx)];
      return note ? `<span class="author-note">${esc(note.text)}</span>` : mark;
    });
  }
  const table = data !== null && Object.keys(data).length > 0 ? renderFrontmatterTable(data) : '';
  return { html: table + html, frontmatter: data };
}
