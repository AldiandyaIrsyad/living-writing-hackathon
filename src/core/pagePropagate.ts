// Writing "upwards": lines added to an earlier version of an entity's page are offered to the later versions.
// Each revision stores the whole page from its scene on, so a line added in the past would otherwise be missing
// from every later version. Only pure additions flow forward: edits and deletions stay where they were made.
// Pure data, no React.

import { diffLines } from './diff';
import type { Id, Vault } from './types';

/** A run of lines added in one place, with the lines around it in the new text. */
export interface AddedBlock {
  lines: string[];
  /** Up to three lines right above the block in the new text. */
  before: string[];
  /** Up to three unchanged lines right below it. */
  after: string[];
  /** The nearest markdown heading above the block in the new text. */
  heading: string | null;
}

const HEADING_RE = /^(#{1,6})\s+\S/;
const norm = (line: string): string => line.trim();
const levelOf = (line: string): number => HEADING_RE.exec(line.trim())?.[1].length ?? 0;

/** The pure additions between two versions of a page, each with its surroundings. Replaced lines are not additions. */
export function addedBlocks(oldNote: string, newNote: string): AddedBlock[] {
  const diff = diffLines(oldNote, newNote);
  const newLines = diff.filter((d) => d.kind !== 'del').map((d) => d.text);
  const blocks: AddedBlock[] = [];
  let pos = 0; // index in newLines
  let heading: string | null = null;
  let i = 0;
  while (i < diff.length) {
    if (diff[i].kind === 'same') {
      if (HEADING_RE.test(diff[i].text.trim())) heading = diff[i].text.trim();
      pos++;
      i++;
      continue;
    }
    let j = i;
    while (j < diff.length && diff[j].kind !== 'same') j++;
    const hunk = diff.slice(i, j);
    const added = hunk.filter((d) => d.kind === 'add').map((d) => d.text);
    if (hunk.every((d) => d.kind === 'add')) {
      const after: string[] = [];
      for (let k = j; k < diff.length && diff[k].kind === 'same' && after.length < 3; k++) after.push(diff[k].text);
      blocks.push({ lines: added, before: newLines.slice(Math.max(0, pos - 3), pos), after, heading });
    }
    for (const line of added) {
      if (HEADING_RE.test(line.trim())) heading = line.trim();
    }
    pos += added.length;
    i = j;
  }
  return blocks;
}

/** Index to insert at so the block follows `before`: the longest tail of it found in the text, else null. */
function indexAfter(text: string[], before: string[]): number | null {
  for (let k = Math.min(3, before.length); k >= 1; k--) {
    const want = before.slice(-k).map(norm);
    if (k === 1 && want[0] === '') return null; // a lone blank line says nothing about where we are
    for (let i = k - 1; i < text.length; i++) {
      if (want.every((w, j) => norm(text[i - k + 1 + j]) === w)) return i + 1;
    }
  }
  return null;
}

/** Index to insert at so the block precedes `after`: the longest head of it found in the text, else null. */
function indexBefore(text: string[], after: string[]): number | null {
  for (let k = Math.min(3, after.length); k >= 1; k--) {
    const want = after.slice(0, k).map(norm);
    if (k === 1 && want[0] === '') return null;
    for (let i = 0; i + k <= text.length; i++) {
      if (want.every((w, j) => norm(text[i + j]) === w)) return i;
    }
  }
  return null;
}

/** After the last non-blank line of a range (or at its start when it is all blank). */
function afterLastContent(text: string[], from: number, to: number): number {
  let at = from;
  for (let i = from; i < to; i++) if (text[i].trim() !== '') at = i + 1;
  return at;
}

export type BlockPlacement =
  | { kind: 'present' }
  | { kind: 'after'; line: string }
  | { kind: 'before'; line: string }
  | { kind: 'top' }
  | { kind: 'section'; heading: string }
  | { kind: 'end' };

/** Puts one block into a version's lines. Returns where it went, and the new lines. */
function placeBlock(text: string[], block: AddedBlock): { placement: BlockPlacement; text: string[] } {
  const content = block.lines.filter((l) => l.trim() !== '');
  if (content.length === 0) return { placement: { kind: 'present' }, text };
  const have = new Set(text.map(norm));
  if (content.every((l) => have.has(norm(l)))) return { placement: { kind: 'present' }, text };

  const insert = (at: number, placement: BlockPlacement) => ({ placement, text: [...text.slice(0, at), ...block.lines, ...text.slice(at)] });

  if (block.before.length === 0) {
    const follow = indexBefore(text, block.after);
    return insert(follow ?? 0, { kind: 'top' });
  }
  const afterAnchor = indexAfter(text, block.before);
  if (afterAnchor !== null) {
    const last = [...block.before].reverse().find((l) => l.trim() !== '') ?? '';
    return insert(afterAnchor, { kind: 'after', line: last.trim() });
  }
  const beforeFollow = indexBefore(text, block.after);
  if (beforeFollow !== null) {
    let at = beforeFollow;
    while (at > 0 && text[at - 1].trim() === '') at--; // keep the blank line that separates it from what follows
    return insert(at, { kind: 'before', line: (block.after.find((l) => l.trim() !== '') ?? '').trim() });
  }

  if (block.heading !== null) {
    const h = text.findIndex((l) => norm(l) === block.heading);
    if (h >= 0) {
      const level = levelOf(block.heading);
      let end = text.length;
      for (let i = h + 1; i < text.length; i++) {
        const lv = levelOf(text[i]);
        if (lv > 0 && lv <= level) {
          end = i;
          break;
        }
      }
      return insert(afterLastContent(text, h + 1, end), { kind: 'section', heading: block.heading });
    }
  }
  return insert(afterLastContent(text, 0, text.length), { kind: 'end' });
}

/** Adds the blocks to a version's text. */
export function insertBlocks(text: string, blocks: AddedBlock[]): { text: string; placements: BlockPlacement[] } {
  const trailing = text.endsWith('\n');
  let lines = (trailing ? text.slice(0, -1) : text).split('\n');
  if (text === '') lines = [];
  const placements: BlockPlacement[] = [];
  for (const block of blocks) {
    const r = placeBlock(lines, block);
    lines = r.text;
    placements.push(r.placement);
  }
  return { text: lines.join('\n') + (trailing && lines.length > 0 ? '\n' : ''), placements };
}

/** A later page version that stores its own text: a revision with a `note`. */
export interface LaterVersion {
  changeId: Id;
  /** The scene it is anchored to, or none when it sits on the timeline. */
  sceneId?: Id;
  note: string;
}

export interface VersionPlan {
  changeId: Id;
  sceneId?: Id;
  before: string;
  after: string;
  placements: BlockPlacement[];
  /**
   * - present: it already has the lines.
   * - placed: right next to the lines the edit sat between.
   * - section: the lines around it changed; goes to the end of the same heading's section.
   * - conflict: the text around it changed and there is no heading to go by; goes to the end of the page, if you say so.
   */
  status: 'present' | 'placed' | 'section' | 'conflict';
}

export interface PropagationPlan {
  /** Number of added lines (blank ones too) that were considered. */
  added: number;
  versions: VersionPlan[];
}

/** What adding the new lines of an earlier version to each later version would do. */
export function planPropagation(oldNote: string, newNote: string, later: LaterVersion[]): PropagationPlan {
  const blocks = addedBlocks(oldNote, newNote);
  const added = blocks.reduce((n, b) => n + b.lines.length, 0);
  if (blocks.length === 0) return { added: 0, versions: [] };
  const versions = later.map((v): VersionPlan => {
    const { text, placements } = insertBlocks(v.note, blocks);
    const status: VersionPlan['status'] = placements.every((p) => p.kind === 'present')
      ? 'present'
      : placements.some((p) => p.kind === 'end')
        ? 'conflict'
        : placements.some((p) => p.kind === 'section')
          ? 'section'
          : 'placed';
    return { changeId: v.changeId, ...(v.sceneId !== undefined ? { sceneId: v.sceneId } : {}), before: v.note, after: text, placements, status };
  });
  return { added, versions };
}

/**
 * Writes the chosen versions of a plan into the vault. A version whose text changed since the plan was made is
 * left alone. Returns the same vault when nothing was written.
 */
export function applyPropagation(vault: Vault, plan: PropagationPlan, changeIds: Id[]): { vault: Vault; applied: number } {
  let changes = vault.changes;
  let applied = 0;
  for (const v of plan.versions) {
    if (!changeIds.includes(v.changeId) || v.after === v.before) continue;
    const c = changes[v.changeId];
    if (!c || c.op !== 'revise' || c.note !== v.before) continue;
    changes = { ...changes, [c.id]: { ...c, note: v.after } };
    applied++;
  }
  return applied === 0 ? { vault, applied: 0 } : { vault: { ...vault, changes }, applied };
}
