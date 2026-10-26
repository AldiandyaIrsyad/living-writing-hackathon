import type { Vault, Entity, Scene, TimePoint, Id, Props, PropValue, ScalarValue, StateChange } from './types';
import { slugify, isLink, LATEST } from './types';
import { findAuthorNotes, mayHaveNote, type AuthorNote } from './notes';

export type LinkTime =
  | { kind: 'context' } // no @ part: contextual time
  | { kind: 'latest' } // @latest
  | { kind: 'scene'; scene: string; edge: 'at' | 'before' | 'after' }; // @Scene Title, @before:Scene Title, @after:Scene Title

export interface ParsedLink {
  /** Full matched text incl. brackets, e.g. "![[norman#Bio@latest|Old man]]". */
  raw: string;
  /** Index in source text. */
  start: number;
  /** Exclusive end index in source text. */
  end: number;
  /** Started with "!". */
  embed: boolean;
  /** "norman" (trimmed). */
  target: string;
  /** "Bio" */
  heading?: string;
  /** "Old man" */
  alias?: string;
  time: LinkTime;
  /** Trimmed text after "@", e.g. "before:The Siege". */
  timeRaw?: string;
}

// ---------------------------------------------------------------------------
// Code masking
// ---------------------------------------------------------------------------

/**
 * Returns a string of identical length where fenced code blocks and inline code spans are
 * replaced by spaces (newlines are kept). Indices in the result map 1:1 onto `text`.
 */
export function maskCode(text: string): string {
  const out = text.split('');
  const n = text.length;
  const mask = (from: number, to: number): void => {
    for (let k = from; k < to; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  // Fenced code blocks (line based).
  let fence: { ch: string; len: number } | null = null;
  let lineStart = 0;
  while (lineStart <= n) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = n;
    const line = text.slice(lineStart, lineEnd);
    if (fence === null) {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (open) {
        fence = { ch: open[1][0], len: open[1].length };
        mask(lineStart, lineEnd);
      }
    } else {
      mask(lineStart, lineEnd);
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/.exec(line);
      if (close && close[1][0] === fence.ch && close[1].length >= fence.len) {
        fence = null;
      }
    }
    if (lineEnd >= n) break;
    lineStart = lineEnd + 1;
  }

  // Inline code spans. A span closes with a backtick run of the same length; it may not cross a blank line.
  let i = 0;
  while (i < n) {
    const c = out[i];
    if (c === '\\' && out[i + 1] === '`') {
      i += 2;
      continue;
    }
    if (c !== '`') {
      i++;
      continue;
    }
    let j = i;
    while (j < n && out[j] === '`') j++;
    const runLen = j - i;
    let k = j;
    let close = -1;
    while (k < n) {
      if (out[k] === '`') {
        let e = k;
        while (e < n && out[e] === '`') e++;
        if (e - k === runLen) {
          close = k;
          break;
        }
        k = e;
        continue;
      }
      if (out[k] === '\n' && isBlankLineAt(text, k + 1)) break;
      k++;
    }
    if (close >= 0) {
      mask(i, close + runLen);
      i = close + runLen;
    } else {
      i = j;
    }
  }
  return out.join('');
}

function isBlankLineAt(text: string, k: number): boolean {
  let p = k;
  while (p < text.length && (text[p] === ' ' || text[p] === '\t')) p++;
  return p >= text.length || text[p] === '\n' || text[p] === '\r';
}

/** Blanks author notes (outside code, see maskCode) in an already code-masked string. */
function maskNotes(masked: string): string {
  if (!mayHaveNote(masked)) return masked;
  const out = masked.split('');
  for (const n of findAuthorNotes(masked)) {
    for (let k = n.start; k < n.end; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  }
  return out.join('');
}

/**
 * Author notes (`%% … %%` / `<!-- … -->` / `// …` to end of line) that are not inside code, in order. Positions index
 * into `text`. Use this for anything that must agree with what the editor shows as a note.
 */
export function findAuthorNotesOutsideCode(text: string): AuthorNote[] {
  if (!mayHaveNote(text)) return [];
  return findAuthorNotes(maskCode(text)).map((n) => {
    const raw = text.slice(n.start, n.end);
    const inner = n.syntax === 'percent' ? raw.slice(2, -2) : n.syntax === 'html' ? raw.slice(4, -3) : raw.slice(2);
    return { ...n, text: inner.trim() };
  });
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Splits the alias off at the first `|` (or `\|`). */
function splitAlias(inner: string): { leftEnd: number; alias?: string } {
  const pipe = inner.indexOf('|');
  if (pipe === -1) return { leftEnd: inner.length };
  const leftEnd = pipe > 0 && inner[pipe - 1] === '\\' ? pipe - 1 : pipe;
  const alias = inner.slice(pipe + 1).trim();
  return { leftEnd, alias: alias === '' ? undefined : alias };
}

function parseTime(t: string): LinkTime {
  if (t === '') return { kind: 'context' };
  if (t.toLowerCase() === 'latest') return { kind: 'latest' };
  const m = /^(before|after)\s*:\s*(.*)$/i.exec(t);
  if (m) {
    return { kind: 'scene', scene: m[2].trim(), edge: m[1].toLowerCase() === 'before' ? 'before' : 'after' };
  }
  return { kind: 'scene', scene: t, edge: 'at' };
}

export function parseLinkInner(
  inner: string,
): Pick<ParsedLink, 'target' | 'heading' | 'alias' | 'time' | 'timeRaw'> {
  const { leftEnd, alias } = splitAlias(inner);
  const left = inner.slice(0, leftEnd);

  let rest = left;
  let time: LinkTime = { kind: 'context' };
  let timeRaw: string | undefined;
  const at = left.indexOf('@');
  if (at !== -1) {
    rest = left.slice(0, at);
    const t = left.slice(at + 1).trim();
    timeRaw = t === '' ? undefined : t;
    time = parseTime(t);
  }

  const hash = rest.indexOf('#');
  const target = (hash === -1 ? rest : rest.slice(0, hash)).trim();
  const heading = hash === -1 ? undefined : rest.slice(hash + 1).trim() || undefined;

  return { target, heading, alias, time, timeRaw };
}

/**
 * Finds every `[[...]]` / `![[...]]` in `text`, skipping fenced and inline code and author
 * notes. Links are single-line, and `]]` closes the first link.
 */
export function parseLinks(text: string): ParsedLink[] {
  const masked = maskNotes(maskCode(text));
  const result: ParsedLink[] = [];
  let i = 0;
  for (;;) {
    const open = masked.indexOf('[[', i);
    if (open === -1) break;
    const close = masked.indexOf(']]', open + 2);
    if (close === -1) break;
    const nl = masked.indexOf('\n', open + 2);
    if (nl !== -1 && nl < close) {
      i = open + 1;
      continue;
    }
    const innerStart = open + 2;
    const inner = text.slice(innerStart, close);
    const lastOpen = inner.lastIndexOf('[[');
    if (lastOpen !== -1) {
      i = innerStart + lastOpen;
      continue;
    }
    const embed = open > 0 && masked[open - 1] === '!';
    const start = embed ? open - 1 : open;
    const end = close + 2;
    i = end;
    const parsed = parseLinkInner(inner);
    if (parsed.target === '') continue;
    result.push({
      raw: text.slice(start, end),
      start,
      end,
      embed,
      target: parsed.target,
      heading: parsed.heading,
      alias: parsed.alias,
      time: parsed.time,
      timeRaw: parsed.timeRaw,
    });
  }
  return result;
}

/**
 * Turns the first plain mention of `name` (a whole word, any case, outside code, author notes and links) into a link,
 * spelled as the text has it. Null when the text never mentions it plainly.
 */
export function linkFirstMention(text: string, name: string): string | null {
  const masked = maskNotes(maskCode(text)).split('');
  for (const l of parseLinks(text)) for (let k = l.start; k < l.end; k++) masked[k] = ' ';
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return null;
  const m = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').exec(masked.join(''));
  if (!m) return null;
  const end = m.index + m[0].length;
  return `${text.slice(0, m.index)}[[${text.slice(m.index, end)}]]${text.slice(end)}`;
}

/** Inverse of parseLinkInner/parseLinks: builds the link text from its parts. */
export function formatLink(p: {
  target: string;
  heading?: string;
  alias?: string;
  timeRaw?: string;
  embed?: boolean;
}): string {
  let inner = p.target;
  if (p.heading) inner += `#${p.heading}`;
  if (p.timeRaw) inner += `@${p.timeRaw}`;
  if (p.alias) inner += `|${p.alias}`;
  return `${p.embed ? '!' : ''}[[${inner}]]`;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Entities by the slug of each name they answer to, in the order findEntity prefers them: names, then aliases, then past names. */
interface EntityIndex {
  changes: Vault['changes'];
  names: Map<string, Entity>;
  aliases: Map<string, Entity>;
  renames: Map<string, Entity>;
}

// Looking an entity up used to scan every entity (slugifying each) for every link; with hundreds of entities and
// thousands of links that dominated whole-vault passes. The index is rebuilt only when the entities or the changes
// (a revision can rename) are replaced, which is what an edit does.
const entityIndexes = new WeakMap<Vault['entities'], EntityIndex>();

function entityIndex(vault: Pick<Vault, 'entities' | 'changes'>): EntityIndex {
  const hit = entityIndexes.get(vault.entities);
  if (hit && hit.changes === vault.changes) return hit;
  const first = (map: Map<string, Entity>, name: string, e: Entity) => {
    const slug = slugify(name);
    if (slug !== '' && !map.has(slug)) map.set(slug, e);
  };
  const index: EntityIndex = { changes: vault.changes, names: new Map(), aliases: new Map(), renames: new Map() };
  const entities = Object.values(vault.entities);
  for (const e of entities) first(index.names, e.name, e);
  for (const e of entities) for (const a of e.aliases) first(index.aliases, a, e);
  // A name the entity carries at some point in story time (a revision's rename), e.g. [[Aragorn]].
  for (const c of Object.values(vault.changes)) {
    if (c.op === 'revise' && c.rename !== undefined && vault.entities[c.entityId]) first(index.renames, c.rename, vault.entities[c.entityId]);
  }
  entityIndexes.set(vault.entities, index);
  return index;
}

export function findEntity(vault: Vault, target: string): Entity | undefined {
  const slug = slugify(target);
  if (slug === '') return undefined;
  const index = entityIndex(vault);
  return index.names.get(slug) ?? index.aliases.get(slug) ?? index.renames.get(slug);
}

export function findScene(vault: Vault, title: string): Scene | undefined {
  const slug = slugify(title);
  if (slug === '') return undefined;
  return Object.values(vault.scenes).find((s) => slugify(s.title) === slug);
}

export function resolveLinkTime(vault: Vault, time: LinkTime, contextSceneId?: Id): TimePoint | null {
  switch (time.kind) {
    case 'context': {
      const scene: Scene | undefined = contextSceneId !== undefined ? vault.scenes[contextSceneId] : undefined;
      return scene ? { kind: 'moment', momentId: scene.momentId } : { kind: 'latest' };
    }
    case 'latest':
      return { ...LATEST };
    case 'scene': {
      const scene = findScene(vault, time.scene);
      if (!scene) return null;
      if (time.edge === 'after') {
        return { kind: 'moment', momentId: scene.momentId, includeSceneId: scene.id };
      }
      return { kind: 'moment', momentId: scene.momentId };
    }
  }
}

// ---------------------------------------------------------------------------
// Refactoring (rename)
// ---------------------------------------------------------------------------

interface LinkEdit {
  /** Replacement for the target text. */
  target?: string;
  /** Replacement for the scene title in the `@...` time part. */
  sceneTitle?: string;
}

/** Rewrites only the requested parts of a link's raw text; everything else is kept byte-for-byte. */
function editRaw(p: ParsedLink, edit: LinkEdit): string {
  const open = p.embed ? 3 : 2;
  const inner = p.raw.slice(open, p.raw.length - 2);
  const edits: Array<{ from: number; to: number; text: string }> = [];

  const lead = inner.length - inner.trimStart().length;
  if (edit.target !== undefined) {
    edits.push({ from: lead, to: lead + p.target.length, text: edit.target });
  }

  if (edit.sceneTitle !== undefined && p.time.kind === 'scene') {
    const { leftEnd } = splitAlias(inner);
    const at = inner.slice(0, leftEnd).indexOf('@');
    if (at !== -1) {
      const seg = inner.slice(at + 1, leftEnd);
      const segLead = seg.length - seg.trimStart().length;
      const trimmed = seg.trim();
      const prefix = /^(?:before|after)\s*:\s*/i.exec(trimmed)?.[0] ?? '';
      const from = at + 1 + segLead;
      edits.push({ from, to: from + trimmed.length, text: prefix + edit.sceneTitle });
    }
  }

  let s = inner;
  for (const ed of edits.sort((a, b) => b.from - a.from)) {
    s = s.slice(0, ed.from) + ed.text + s.slice(ed.to);
  }
  return p.raw.slice(0, open) + s + ']]';
}

/** Applies `edit` to every link in `text` that it selects (null = leave as is). */
function rewriteText(text: string, edit: (p: ParsedLink) => LinkEdit | null): string {
  const links = parseLinks(text);
  let out = '';
  let last = 0;
  let changed = false;
  for (const p of links) {
    const e = edit(p);
    if (!e) continue;
    changed = true;
    out += text.slice(last, p.start) + editRaw(p, e);
    last = p.end;
  }
  if (!changed) return text;
  return out + text.slice(last);
}

/** Maps link targets inside a property value. Returns the same value when nothing changes. */
function mapLinkTargets(v: PropValue, fn: (target: string) => string | null): PropValue {
  if (Array.isArray(v)) {
    let changed = false;
    const out = v.map((x) => {
      const y = mapScalar(x, fn);
      if (y !== x) changed = true;
      return y;
    });
    return changed ? out : v;
  }
  return mapScalar(v, fn);
}

function mapScalar(x: ScalarValue, fn: (target: string) => string | null): ScalarValue {
  if (isLink(x)) {
    const t = fn(x.target);
    if (t !== null) return { ...x, target: t };
  }
  return x;
}

function mapProps(props: Props, fn: (target: string) => string | null): Props {
  let changed = false;
  const out: Props = {};
  for (const [key, value] of Object.entries(props)) {
    const nv = mapLinkTargets(value, fn);
    if (nv !== value) changed = true;
    out[key] = nv;
  }
  return changed ? out : props;
}

function mapChanges(
  changes: Record<Id, StateChange>,
  fn: (target: string) => string | null,
): Record<Id, StateChange> {
  let changed = false;
  const out: Record<Id, StateChange> = {};
  for (const [id, c] of Object.entries(changes)) {
    if (c.value !== undefined) {
      const nv = mapLinkTargets(c.value, fn);
      if (nv !== c.value) {
        changed = true;
        out[id] = { ...c, value: nv };
        continue;
      }
    }
    out[id] = c;
  }
  return changed ? out : changes;
}

/** Points every link to `from` in the text at `to` instead (a misspelt [[Mria]] becomes [[Mira]]), keeping the rest of each link. */
export function retargetLinks(text: string, from: string, to: string): string {
  const slug = slugify(from);
  return rewriteText(text, (p) => (slugify(p.target) === slug ? { target: to } : null));
}

export function renameEntity(vault: Vault, entityId: Id, newName: string): Vault {
  const entity = vault.entities[entityId];
  if (!entity) return { ...vault };
  const oldSlug = slugify(entity.name);
  const matchTarget = (target: string): boolean => slugify(target) === oldSlug;
  const linkEdit = (p: ParsedLink): LinkEdit | null => (matchTarget(p.target) ? { target: newName } : null);
  const targetFn = (target: string): string | null => (matchTarget(target) ? newName : null);

  const entities: Record<Id, Entity> = {};
  let entitiesChanged = false;
  for (const [id, e] of Object.entries(vault.entities)) {
    const note = rewriteText(e.note, linkEdit);
    const props = mapProps(e.props, targetFn);
    const isSelf = id === entityId;
    if (note === e.note && props === e.props && !isSelf) {
      entities[id] = e;
      continue;
    }
    entitiesChanged = true;
    entities[id] = {
      ...e,
      name: isSelf ? newName : e.name,
      note,
      props,
    };
  }

  const scenes: Record<Id, Scene> = {};
  let scenesChanged = false;
  for (const [id, s] of Object.entries(vault.scenes)) {
    const prose = rewriteText(s.prose, linkEdit);
    if (prose === s.prose) {
      scenes[id] = s;
    } else {
      scenesChanged = true;
      scenes[id] = { ...s, prose };
    }
  }

  const changes = mapChanges(vault.changes, targetFn);

  return {
    ...vault,
    entities: entitiesChanged ? entities : vault.entities,
    scenes: scenesChanged ? scenes : vault.scenes,
    changes,
  };
}

export function renameScene(vault: Vault, sceneId: Id, newTitle: string): Vault {
  const scene = vault.scenes[sceneId];
  if (!scene) return { ...vault };
  const oldSlug = slugify(scene.title);

  const edit = (p: ParsedLink): LinkEdit | null => {
    const out: LinkEdit = {};
    let any = false;
    if (p.time.kind === 'scene' && slugify(p.time.scene) === oldSlug) {
      out.sceneTitle = newTitle;
      any = true;
    }
    // `[[Old Title]]` points at the scene by title, unless an entity of that name exists.
    if (slugify(p.target) === oldSlug && findEntity(vault, p.target) === undefined) {
      out.target = newTitle;
      any = true;
    }
    return any ? out : null;
  };

  const entities: Record<Id, Entity> = {};
  let entitiesChanged = false;
  for (const [id, e] of Object.entries(vault.entities)) {
    const note = rewriteText(e.note, edit);
    if (note === e.note) {
      entities[id] = e;
    } else {
      entitiesChanged = true;
      entities[id] = { ...e, note };
    }
  }

  const scenes: Record<Id, Scene> = {};
  for (const [id, s] of Object.entries(vault.scenes)) {
    const prose = rewriteText(s.prose, edit);
    const title = id === sceneId ? newTitle : s.title;
    if (prose === s.prose && title === s.title) {
      scenes[id] = s;
    } else {
      scenes[id] = { ...s, title, prose };
    }
  }

  return {
    ...vault,
    entities: entitiesChanged ? entities : vault.entities,
    scenes,
  };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/**
 * Validates a raw tag body (text after `#`). Trailing slashes are dropped.
 * Returns null if it is not a tag (empty, starts with a non-word char, or all digits).
 */
export function normalizeTag(raw: string): string | null {
  const tag = raw.replace(/\/+$/, '');
  if (!/^[\p{L}\p{N}_][\p{L}\p{N}_\-/]*$/u.test(tag)) return null;
  if (!/\D/.test(tag)) return null;
  return tag;
}

export function parseTags(text: string): string[] {
  // Mask code, author notes and wikilinks so `#` inside them is never a tag.
  const masked = maskNotes(maskCode(text)).split('');
  for (const p of parseLinks(text)) {
    for (let k = p.start; k < p.end; k++) {
      if (masked[k] !== '\n') masked[k] = ' ';
    }
  }
  const haystack = masked.join('');

  const seen = new Set<string>();
  const re = /(^|\s)#([\p{L}\p{N}_\-/]+)/gu;
  for (const m of haystack.matchAll(re)) {
    const tag = normalizeTag(m[2]);
    if (tag !== null) seen.add(tag);
  }
  return [...seen];
}
