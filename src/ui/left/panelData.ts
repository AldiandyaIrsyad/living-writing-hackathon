// Pure helpers behind the left panels: no React, no DOM. Callers memoise the lists they build.
// Author notes are cached per scene/entity object, so an edit only re-scans the item it changed.

import { findAuthorNotesOutsideCode } from '../../core/links';
import type { AuthorNote } from '../../core/notes';
import type { Arc, Chapter, Entity, EntityType, Id, Scene, Vault } from '../../core/types';
import { fuzzyScore } from '../search';

/** Rows rendered at most in the world and notes lists; the rest are summarised. */
export const ROW_LIMIT = 400;

export function sortTypes(types: Vault['entityTypes']): EntityType[] {
  return Object.values(types).sort((a, b) => a.name.localeCompare(b.name));
}

export function matchesQuery(e: Entity, q: string): boolean {
  return q === '' || [e.name, ...e.aliases].some((text) => fuzzyScore(q, text) !== null);
}

export function indent(depth: number): string {
  return `${8 + depth * 14}px`;
}

export interface StoryCount {
  chapters: number;
  scenes: number;
}

export function countByStory(chapters: Vault['chapters'], scenes: Vault['scenes']): Map<Id, StoryCount> {
  const out = new Map<Id, StoryCount>();
  const slot = (storyId: Id): StoryCount => {
    let c = out.get(storyId);
    if (!c) {
      c = { chapters: 0, scenes: 0 };
      out.set(storyId, c);
    }
    return c;
  };
  for (const c of Object.values(chapters)) slot(c.storyId).chapters += 1;
  for (const s of Object.values(scenes)) slot(s.storyId).scenes += 1;
  return out;
}

export interface OutlineChapter {
  chapter: Chapter;
  scenes: Scene[];
}

export interface OutlineArc {
  arc: Arc;
  chapters: OutlineChapter[];
  sceneCount: number;
}

export interface Outline {
  /** Arcs in order, each with its chapters. */
  arcs: OutlineArc[];
  /** Chapters without a (valid) arc, after the arcs. */
  chapters: OutlineChapter[];
  /** Scenes without a (valid) chapter, at the end. */
  scenes: Scene[];
  /** Unplaced / Someday scenes kept in the Someday tray until placed. */
  someday: Scene[];
}

const EMPTY_OUTLINE: Outline = { arcs: [], chapters: [], scenes: [], someday: [] };

/** Arc → chapter → scene tree of one story, in telling order. */
export function buildOutline(
  storyId: Id | null,
  arcMap: Vault['arcs'],
  chapterMap: Vault['chapters'],
  sceneMap: Vault['scenes'],
): Outline {
  if (storyId === null) return EMPTY_OUTLINE;
  const arcList = Object.values(arcMap)
    .filter((a) => a.storyId === storyId)
    .sort((a, b) => a.order - b.order);
  const chapterList = Object.values(chapterMap)
    .filter((c) => c.storyId === storyId)
    .sort((a, b) => a.order - b.order);
  const chapterIds = new Set(chapterList.map((c) => c.id));
  const arcIds = new Set(arcList.map((a) => a.id));

  const sceneByChapter = new Map<Id, Scene[]>();
  const looseScenes: Scene[] = [];
  const somedayScenes: Scene[] = [];
  const storyScenes = Object.values(sceneMap)
    .filter((s) => s.storyId === storyId)
    .sort((a, b) => a.order - b.order);
  for (const s of storyScenes) {
    if (s.someday) {
      somedayScenes.push(s);
    } else if (s.chapterId !== null && chapterIds.has(s.chapterId)) {
      const list = sceneByChapter.get(s.chapterId);
      if (list) list.push(s);
      else sceneByChapter.set(s.chapterId, [s]);
    } else {
      looseScenes.push(s);
    }
  }

  const chaptersByArc = new Map<Id, OutlineChapter[]>();
  const looseChapters: OutlineChapter[] = [];
  for (const chapter of chapterList) {
    const entry: OutlineChapter = { chapter, scenes: sceneByChapter.get(chapter.id) ?? [] };
    if (chapter.arcId !== undefined && arcIds.has(chapter.arcId)) {
      const list = chaptersByArc.get(chapter.arcId);
      if (list) list.push(entry);
      else chaptersByArc.set(chapter.arcId, [entry]);
    } else {
      looseChapters.push(entry);
    }
  }

  const arcs = arcList.map((arc) => {
    const chapters = chaptersByArc.get(arc.id) ?? [];
    return { arc, chapters, sceneCount: chapters.reduce((n, c) => n + c.scenes.length, 0) };
  });
  return { arcs, chapters: looseChapters, scenes: looseScenes, someday: somedayScenes };
}

// ---- Author notes ----

export interface NoteRow {
  key: string;
  kind: 'scene' | 'entity';
  /** Scene or entity id. */
  id: Id;
  /** Line shown above the text: "Chapter · Scene" or "Name · Type". */
  where: string;
  /** Searched along with the text. */
  label: string;
  text: string;
  /** Range in the scene's prose or the entity's note. */
  from: number;
  to: number;
}

export interface NoteGroup {
  key: string;
  title: string;
  color?: string;
  rows: NoteRow[];
}

const sceneNoteCache = new WeakMap<Scene, AuthorNote[]>();
const entityNoteCache = new WeakMap<Entity, AuthorNote[]>();

function cachedNotes<T extends object>(cache: WeakMap<T, AuthorNote[]>, item: T, text: string): AuthorNote[] {
  const hit = cache.get(item);
  if (hit) return hit;
  const notes = findAuthorNotesOutsideCode(text);
  cache.set(item, notes);
  return notes;
}

/** Number of author notes in the vault (scene prose and entity notes). */
export function countAuthorNotes(vault: Vault): number {
  let n = 0;
  for (const s of Object.values(vault.scenes)) n += cachedNotes(sceneNoteCache, s, s.prose).length;
  for (const e of Object.values(vault.entities)) n += cachedNotes(entityNoteCache, e, e.note).length;
  return n;
}

function sceneNoteRows(vault: Vault, scene: Scene): NoteRow[] {
  const chapter = scene.chapterId ? vault.chapters[scene.chapterId] : undefined;
  const title = scene.title || 'Untitled scene';
  const where = `${chapter?.title || 'No chapter'} · ${title}`;
  return cachedNotes(sceneNoteCache, scene, scene.prose).map((n) => ({
    key: `scene:${scene.id}:${n.start}`,
    kind: 'scene',
    id: scene.id,
    where,
    label: title,
    text: n.text,
    from: n.start,
    to: n.end,
  }));
}

/** Author notes grouped by story in reading order, then the entity notes under "World". */
export function collectNoteGroups(vault: Vault): NoteGroup[] {
  const perStory = new Map<Id, NoteRow[]>();
  for (const scene of Object.values(vault.scenes).sort((a, b) => a.order - b.order)) {
    const rows = sceneNoteRows(vault, scene);
    if (rows.length === 0) continue;
    const list = perStory.get(scene.storyId);
    if (list) list.push(...rows);
    else perStory.set(scene.storyId, rows);
  }

  const groups: NoteGroup[] = [];
  for (const story of Object.values(vault.stories).sort((a, b) => a.order - b.order)) {
    const rows = perStory.get(story.id);
    if (rows) groups.push({ key: story.id, title: story.name, color: story.color, rows });
  }

  const entityRows: NoteRow[] = [];
  for (const e of Object.values(vault.entities).sort((a, b) => a.name.localeCompare(b.name))) {
    const typeName = vault.entityTypes[e.typeId]?.name ?? 'Entity';
    for (const n of cachedNotes(entityNoteCache, e, e.note)) {
      entityRows.push({
        key: `entity:${e.id}:${n.start}`,
        kind: 'entity',
        id: e.id,
        where: `${e.name} · ${typeName}`,
        label: e.name,
        text: n.text,
        from: n.start,
        to: n.end,
      });
    }
  }
  if (entityRows.length > 0) groups.push({ key: 'world', title: 'World', rows: entityRows });
  return groups;
}
