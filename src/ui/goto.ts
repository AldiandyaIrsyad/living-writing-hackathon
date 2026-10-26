// Go-to queries for the command palette (Ctrl+K). Pure: no React, no DOM, no store.
//
//   :5      chapter 5 of the story (1-based, by chapter order)
//   :5.2    scene 2 of chapter 5 (scenes ordered by telling order)
//   :a2     arc 2 (by arc order)
//   :s12    scene 12 of the whole story (telling order)
//
// `>5` is accepted as well, but only when the rest looks like a go-to form; otherwise `>` keeps
// meaning "commands only".

import type { Arc, Chapter, Id, Scene, Story, Vault } from '../core/types';

export type GotoQuery =
  | { kind: 'empty' }
  | { kind: 'invalid'; input: string }
  | { kind: 'chapter'; n: number }
  | { kind: 'scene'; chapter: number; n: number }
  | { kind: 'arc'; n: number }
  | { kind: 'sceneNumber'; n: number };

/** A chapter, arc or scene the palette can open. Also used as a search row. */
export interface NavTarget {
  kind: 'chapter' | 'arc' | 'scene';
  storyId: Id;
  /** Story colour, for the row's dot. */
  color: string;
  /** 1-based number within the story (chapter order, arc order, or scene order). */
  number: number;
  /** Row label, e.g. "Chapter 3 · The Betrayal". */
  label: string;
  /** Secondary text. */
  meta: string;
  /** Scene to open; null when a chapter or arc has no scenes yet. */
  sceneId: Id | null;
  /** Strings a search matches: the title and the numbered form ("Chapter 3"). */
  texts: string[];
}

export interface GotoResolution {
  targets: NavTarget[];
  /** Explains an invalid or out-of-range query. Shown instead of targets. */
  message?: string;
}

const GO_BODY = /^(\d+(\.\d+)?|a\d+|s\d+)$/i;

/**
 * Reads a palette query as a go-to, or returns null when it is an ordinary search.
 * A leading `:` always means go-to; a leading `>` only when the rest is a go-to form.
 */
export function parseGoto(query: string): GotoQuery | null {
  const s = query.trimStart();
  if (s.startsWith(':')) return classify(s.slice(1).trim());
  if (s.startsWith('>')) {
    const body = s.slice(1).trim();
    return GO_BODY.test(body) ? classify(body) : null;
  }
  return null;
}

function classify(body: string): GotoQuery {
  if (body === '') return { kind: 'empty' };
  let m = /^(\d+)$/.exec(body);
  if (m) return { kind: 'chapter', n: Number(m[1]) };
  m = /^(\d+)\.(\d+)$/.exec(body);
  if (m) return { kind: 'scene', chapter: Number(m[1]), n: Number(m[2]) };
  m = /^a(\d+)$/i.exec(body);
  if (m) return { kind: 'arc', n: Number(m[1]) };
  m = /^s(\d+)$/i.exec(body);
  if (m) return { kind: 'sceneNumber', n: Number(m[1]) };
  return { kind: 'invalid', input: body };
}

/** Resolves a go-to query against one story. Falls back to the first story when `storyId` is unknown or null. */
export function resolveGoto(vault: Vault, storyId: Id | null, query: string): GotoResolution {
  const q = parseGoto(query);
  if (q === null || q.kind === 'empty') return { targets: [] };
  if (q.kind === 'invalid') {
    return {
      targets: [],
      message: `Couldn’t read “:${q.input}”. Try :5 for chapter 5, :5.2 for scene 2 of chapter 5, :a2 for arc 2 or :s12 for scene 12.`,
    };
  }

  const story = pickStory(vault, storyId);
  if (story === null) return { targets: [], message: 'There are no stories yet.' };
  const idx = storyIndex(vault, story);

  switch (q.kind) {
    case 'chapter':
      if (!inRange(q.n, idx.chapters.length)) return miss(`Chapter ${q.n}`, idx.chapters.length, 'chapter', 'chapters');
      return { targets: [chapterNav(idx, q.n - 1)] };
    case 'arc':
      if (!inRange(q.n, idx.arcs.length)) return miss(`Arc ${q.n}`, idx.arcs.length, 'arc', 'arcs');
      return { targets: [arcNav(idx, q.n - 1)] };
    case 'sceneNumber':
      if (!inRange(q.n, idx.scenes.length)) return miss(`Scene ${q.n}`, idx.scenes.length, 'scene', 'scenes');
      return { targets: [sceneNumberNav(idx, q.n - 1)] };
    case 'scene': {
      if (!inRange(q.chapter, idx.chapters.length)) return miss(`Chapter ${q.chapter}`, idx.chapters.length, 'chapter', 'chapters');
      const ch = idx.chapters[q.chapter - 1];
      const scenes = idx.scenes.filter((s) => s.chapterId === ch.id);
      if (scenes.length === 0) return { targets: [], message: `Chapter ${q.chapter} has no scenes yet.` };
      if (!inRange(q.n, scenes.length)) {
        return {
          targets: [],
          message: `Scene ${q.n} doesn't exist in chapter ${q.chapter}. It has ${countOf(scenes.length, 'scene', 'scenes')}.`,
        };
      }
      return { targets: [chapterSceneNav(idx, q.chapter, q.n, scenes[q.n - 1])] };
    }
  }
}

/** Every chapter and arc in every story, for search. Chapters first within each story, then arcs. */
export function navItems(vault: Vault): NavTarget[] {
  const out: NavTarget[] = [];
  for (const story of storiesInOrder(vault)) {
    const idx = storyIndex(vault, story);
    idx.chapters.forEach((_, i) => out.push(chapterNav(idx, i)));
    idx.arcs.forEach((_, i) => out.push(arcNav(idx, i)));
  }
  return out;
}

// ---- internals ----

interface StoryIndex {
  story: Story;
  /** Scenes in telling order. */
  scenes: Scene[];
  chapters: Chapter[];
  arcs: Arc[];
}

const byOrder = <T extends { order: number }>(a: T, b: T): number => a.order - b.order;

function storiesInOrder(vault: Vault): Story[] {
  return Object.values(vault.stories).sort(byOrder);
}

function pickStory(vault: Vault, storyId: Id | null): Story | null {
  const stories = storiesInOrder(vault);
  return stories.find((s) => s.id === storyId) ?? stories[0] ?? null;
}

function storyIndex(vault: Vault, story: Story): StoryIndex {
  return {
    story,
    scenes: Object.values(vault.scenes).filter((s) => s.storyId === story.id).sort(byOrder),
    chapters: Object.values(vault.chapters).filter((c) => c.storyId === story.id).sort(byOrder),
    arcs: Object.values(vault.arcs).filter((a) => a.storyId === story.id).sort(byOrder),
  };
}

function inRange(n: number, count: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= count;
}

function countOf(n: number, noun: string, plural: string): string {
  return n === 1 ? `1 ${noun}` : `${n} ${plural}`;
}

function miss(what: string, count: number, noun: string, plural: string): GotoResolution {
  const have = count === 0 ? `no ${plural} yet` : countOf(count, noun, plural);
  return { targets: [], message: `${what} doesn't exist. The story has ${have}.` };
}

function sceneTitle(s: Scene): string {
  return s.title.trim() || 'Untitled scene';
}

/** "Chapter 3", or "Chapter 3 · Title" when the title says something else. */
function numbered(prefix: string, n: number, title: string): string {
  const base = `${prefix} ${n}`;
  const t = title.trim();
  return t === '' || t.toLowerCase() === base.toLowerCase() ? base : `${base} · ${t}`;
}

function opensLine(scene: Scene | undefined): string {
  return scene ? `opens “${sceneTitle(scene)}”` : 'no scenes yet';
}

function texts(...parts: string[]): string[] {
  return [...new Set(parts.filter((p) => p.trim() !== ''))];
}

function chapterNav(idx: StoryIndex, i: number): NavTarget {
  const ch = idx.chapters[i];
  const n = i + 1;
  const first = idx.scenes.find((s) => s.chapterId === ch.id);
  return {
    kind: 'chapter',
    storyId: idx.story.id,
    color: idx.story.color,
    number: n,
    label: numbered('Chapter', n, ch.title),
    meta: `${idx.story.name} · ${opensLine(first)}`,
    sceneId: first?.id ?? null,
    texts: texts(`Chapter ${n}`, ch.title),
  };
}

function arcNav(idx: StoryIndex, i: number): NavTarget {
  const arc = idx.arcs[i];
  const n = i + 1;
  const inArc = new Set(idx.chapters.filter((c) => c.arcId === arc.id).map((c) => c.id));
  const first = idx.scenes.find((s) => s.chapterId !== null && inArc.has(s.chapterId));
  return {
    kind: 'arc',
    storyId: idx.story.id,
    color: idx.story.color,
    number: n,
    label: arc.title.trim() || `Arc ${n}`,
    meta: `${idx.story.name} · ${opensLine(first)}`,
    sceneId: first?.id ?? null,
    texts: texts(`Arc ${n}`, arc.title),
  };
}

/** Scene `k` (1-based) of chapter `c` (1-based). */
function chapterSceneNav(idx: StoryIndex, c: number, k: number, scene: Scene): NavTarget {
  return {
    kind: 'scene',
    storyId: idx.story.id,
    color: idx.story.color,
    number: k,
    label: sceneTitle(scene),
    meta: `Chapter ${c} · scene ${k}`,
    sceneId: scene.id,
    texts: texts(sceneTitle(scene)),
  };
}

function sceneNumberNav(idx: StoryIndex, i: number): NavTarget {
  const scene = idx.scenes[i];
  return {
    kind: 'scene',
    storyId: idx.story.id,
    color: idx.story.color,
    number: i + 1,
    label: sceneTitle(scene),
    meta: `${idx.story.name} · scene ${i + 1} of ${idx.scenes.length}`,
    sceneId: scene.id,
    texts: texts(sceneTitle(scene)),
  };
}
