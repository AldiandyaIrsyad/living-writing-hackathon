// A chapter as one markdown document. Every `# Heading` line starts a scene; the text under it is that
// scene's prose. Text above the first heading is an untitled first scene. Pure data, no React or CodeMirror.
//
// The editor keeps an "anchor" (a position that follows edits) on each scene's heading, so `reconcile` can tell
// which headings are existing scenes, which are new, and which scenes lost their heading (they merge upward).

import { findAuthorNotesOutsideCode, renameScene } from './links';
import { buildGraph } from './graph';
import { deleteScene, insertScene, type Relation } from './timeline';
import type { Id, Scene, StateChange, Vault } from './types';

/** A scene as shown in the chapter document. */
export interface DocScene {
  id: Id;
  title: string;
  prose: string;
}

/** Where a scene's heading line starts in the document text. `pos` is null once an edit deleted the heading. */
export interface Anchor {
  id: Id;
  pos: number | null;
  /** The untitled first scene: its text leads the document, so its anchor stays at the very start. */
  lead?: boolean;
}

export interface ParsedSection {
  /** Start of the heading line (0 for the untitled first section). */
  from: number;
  hasHeading: boolean;
  title: string;
  /** The scene's prose: the text under the heading without leading or trailing blank lines. */
  prose: string;
  /** Where `prose` starts in the document, so offsets inside a scene's prose can be mapped to the document. */
  proseFrom: number;
}

const FENCE_RE = /^\s{0,3}(```|~~~)/;
const HEADING_RE = /^\s{0,3}# (.*)$/;

/** Start offsets of every `# ` heading line outside code fences and author notes, with the heading's title. */
function findHeadings(text: string): { from: number; end: number; title: string }[] {
  const notes = findAuthorNotesOutsideCode(text);
  const out: { from: number; end: number; title: string }[] = [];
  let fenced = false;
  let from = 0;
  while (from <= text.length) {
    let end = text.indexOf('\n', from);
    if (end < 0) end = text.length;
    const line = text.slice(from, end);
    if (FENCE_RE.test(line)) fenced = !fenced;
    else if (!fenced) {
      const m = HEADING_RE.exec(line);
      if (m && !notes.some((n) => n.start < from && from < n.end)) out.push({ from, end, title: m[1].trim() });
    }
    from = end + 1;
  }
  return out;
}

/** Splits chapter text into its sections: the untitled lead (when it has text) and one per heading. */
export function parseChapterText(text: string): ParsedSection[] {
  const headings = findHeadings(text);
  const sections: ParsedSection[] = [];

  const body = (start: number, stop: number): { prose: string; proseFrom: number } => {
    let a = start;
    while (a < stop && text[a] === '\n') a++;
    let b = stop;
    while (b > a && text[b - 1] === '\n') b--;
    return { prose: text.slice(a, b), proseFrom: a };
  };

  const firstHeading = headings[0]?.from ?? text.length;
  const lead = body(0, firstHeading);
  if (lead.prose.trim() !== '') sections.push({ from: 0, hasHeading: false, title: '', ...lead });

  headings.forEach((h, i) => {
    const stop = headings[i + 1]?.from ?? text.length;
    sections.push({ from: h.from, hasHeading: true, title: h.title, ...body(Math.min(h.end + 1, text.length), stop) });
  });
  return sections;
}

/**
 * The chapter's text, and an anchor on each heading. A first scene without a title has no heading line: its
 * text leads the document.
 */
export function composeChapter(scenes: DocScene[]): { text: string; anchors: Anchor[] } {
  const parts: string[] = [];
  const anchors: Anchor[] = [];
  let length = 0;
  scenes.forEach((s, i) => {
    const untitledLead = i === 0 && s.title === '';
    const part = (untitledLead ? '' : `# ${s.title}\n`) + (s.prose === '' ? '' : `${untitledLead ? '' : '\n'}${s.prose}\n`);
    const sep = i === 0 ? '' : '\n';
    anchors.push(untitledLead ? { id: s.id, pos: 0, lead: true } : { id: s.id, pos: length + sep.length });
    parts.push(sep + part);
    length += sep.length + part.length;
  });
  return { text: parts.join(''), anchors };
}

export interface PlanSection {
  /** The existing scene this section is, or null for a scene to create. */
  id: Id | null;
  title: string;
  prose: string;
}

export interface ChapterPlan {
  sections: PlanSection[];
  /** Scenes whose heading is gone: everything they own moves into `into`. */
  merges: { from: Id; into: Id }[];
}

/**
 * Matches the document's sections to the chapter's existing scenes using the heading anchors.
 * - An anchor still on a heading line keeps its scene (renamed if the heading text changed).
 * - A heading without an anchor is a new scene.
 * - A scene whose heading was deleted merges into the scene above (or the one below when it was first).
 * The chapter never ends up with no scene while it had one: an emptied chapter keeps its first scene.
 */
export function reconcile(text: string, scenes: DocScene[], anchors: Anchor[]): ChapterPlan {
  const parsed = parseChapterText(text);
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const claimed = new Map<number, Id>();
  for (const scene of scenes) {
    const a = anchors.find((x) => x.id === scene.id);
    if (!a || a.pos === null) continue;
    const at = parsed.findIndex((p) => p.from === a.pos);
    if (at < 0) continue;
    const holder = claimed.get(at);
    if (holder === undefined) {
      claimed.set(at, scene.id);
      continue;
    }
    // Two anchors landed on one heading (the one above it was deleted): the scene named like the heading keeps it.
    const title = parsed[at].title;
    if (byId.get(holder)?.title !== title || byId.get(scene.id)?.title === title) claimed.set(at, scene.id);
  }

  // Nothing kept its anchor (the first scene lost its heading, or all text was replaced): the first scene lives on in the first section.
  if (claimed.size === 0 && scenes.length > 0 && parsed.length > 0) claimed.set(0, scenes[0].id);
  const sections: PlanSection[] = parsed.map((p, i) => ({ id: claimed.get(i) ?? null, title: p.title, prose: p.prose }));
  if (sections.length === 0 && scenes.length > 0) {
    sections.push({ id: scenes[0].id, title: scenes[0].title, prose: '' });
  }

  const kept = new Set(sections.flatMap((s) => (s.id ? [s.id] : [])));
  const merges: ChapterPlan['merges'] = [];
  scenes.forEach((s, i) => {
    if (kept.has(s.id)) return;
    const before = scenes.slice(0, i).reverse().find((x) => kept.has(x.id));
    const target = before ?? scenes.slice(i + 1).find((x) => kept.has(x.id));
    if (target) merges.push({ from: s.id, into: target.id });
  });
  return { sections, merges };
}

/** The scenes of a chapter in reading order. */
export function chapterScenes(vault: Vault, chapterId: Id): Scene[] {
  return Object.values(vault.scenes)
    .filter((s) => s.chapterId === chapterId)
    .sort((a, b) => a.order - b.order);
}

/** Moves a scene's state changes and hand-added cast into another scene. */
function mergeInto(v: Vault, from: Id, into: Id): Vault {
  const target = v.scenes[into];
  const source = v.scenes[from];
  if (!target || !source) return v;
  const changes: Record<Id, StateChange> = { ...v.changes };
  let order = Math.max(-1, ...Object.values(v.changes).filter((c) => c.sceneId === into).map((c) => c.order));
  for (const c of Object.values(v.changes).filter((x) => x.sceneId === from).sort((a, b) => a.order - b.order)) {
    changes[c.id] = { ...c, sceneId: into, order: ++order };
  }
  const cast = [...new Set([...(target.cast ?? []), ...(source.cast ?? [])])];
  const scenes = { ...v.scenes, [into]: cast.length ? { ...target, cast } : target };
  return { ...v, changes, scenes };
}

/**
 * Writes a plan into the vault: renames and re-texts the scenes, creates the new ones (right after the scene
 * above them in time; they can be dragged anywhere on the timeline afterwards), merges the scenes that lost
 * their heading and fixes the reading order. Returns the scene id of each section, in document order.
 */
export function applyChapterPlan(vault: Vault, chapterId: Id, plan: ChapterPlan): { vault: Vault; ids: Id[]; diverged: boolean } {
  const chapter = vault.chapters[chapterId];
  if (!chapter) return { vault, ids: [], diverged: false };
  const storyId = chapter.storyId;
  // Created scenes get an `order` past every old one, so the chapter's place in the reading order is read first.
  const oldOrders = plan.sections.flatMap((s) => (s.id && vault.scenes[s.id] ? [vault.scenes[s.id].order] : []));
  const firstOldOrder = oldOrders.length ? Math.min(...oldOrders) : Infinity;

  let v = vault;
  const ids: Id[] = [];
  let prev: Id | null = null;
  plan.sections.forEach((sec, i) => {
    if (sec.id && v.scenes[sec.id]) {
      const scene = v.scenes[sec.id];
      if (scene.prose !== sec.prose) v = { ...v, scenes: { ...v.scenes, [sec.id]: { ...scene, prose: sec.prose } } };
      ids.push(sec.id);
      prev = sec.id;
      return;
    }
    let relation: Relation | null = null;
    let target: Id | null = null;
    if (prev) {
      relation = 'after';
      target = prev;
    } else {
      const next = plan.sections.slice(i + 1).find((s) => s.id && v.scenes[s.id])?.id;
      if (next) {
        relation = 'before';
        target = next;
      } else {
        const graph = buildGraph(v);
        const last = Object.values(v.scenes)
          .filter((s) => s.storyId === storyId)
          .reduce<Scene | null>((best, s) => (best === null || graph.topoIndex(s.momentId) > graph.topoIndex(best.momentId) ? s : best), null);
        if (last) {
          relation = 'after';
          target = last.id;
        }
      }
    }
    const created = insertScene(v, { storyId, title: sec.title, chapterId, prose: sec.prose }, relation, target);
    v = created.vault;
    ids.push(created.sceneId);
    prev = created.sceneId;
  });

  // Renames come after the prose is in place, so the links they rewrite are rewritten in the new text.
  plan.sections.forEach((sec) => {
    const scene = sec.id ? v.scenes[sec.id] : undefined;
    if (!scene || sec.title === scene.title) return;
    v = sec.title.trim() ? renameScene(v, scene.id, sec.title) : { ...v, scenes: { ...v.scenes, [scene.id]: { ...scene, title: sec.title } } };
  });

  for (const m of plan.merges) {
    v = mergeInto(v, m.from, m.into);
    v = deleteScene(v, m.from);
  }

  // Reading order: place the chapter where its first old scene was, or last when all of it is new.
  const docOrder = ids;
  const inDoc = new Set(docOrder);
  const others = Object.values(v.scenes)
    .filter((s) => s.storyId === storyId && !inDoc.has(s.id))
    .sort((a, b) => a.order - b.order);
  const at = Number.isFinite(firstOldOrder) ? others.filter((s) => s.order < firstOldOrder).length : others.length;
  const sequence = [...others.slice(0, at), ...docOrder.map((id) => v.scenes[id]), ...others.slice(at)];
  sequence.forEach((s, i) => {
    if (s && s.order !== i) v = { ...v, scenes: { ...v.scenes, [s.id]: { ...s, order: i } } };
  });
  // A rename rewrote a [[link]] inside this chapter's own text: the editor must show the rewritten text.
  const diverged = plan.sections.some((sec, i) => v.scenes[ids[i]]?.prose !== sec.prose);
  return { vault: v, ids, diverged };
}
