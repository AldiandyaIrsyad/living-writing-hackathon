// The agent's edits to a living page, as line operations: add a line (under a heading), replace a line, remove a line.
// Lines are matched by their words, not their punctuation, so "- Norman is alive." matches "Norman is alive". Who wrote
// each line is read from the page's own history: a line added by an agent revision is the agent's, every other line
// is the writer's. Pure data, no React.

import { diffLines } from '../core/diff';
import type { Resolver } from '../core/resolve';
import type { Id, StateChange } from '../core/types';

export type PageEdit = { kind: 'add'; text: string; under?: string } | { kind: 'replace'; old: string; text: string } | { kind: 'remove'; old: string };

/** Lower-case letters and digits only. */
export const squash = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const PREFIX = /^(\s*(?:[-*•]|\d+\.)\s+|\s*#{1,6}\s+)/;
const HEADING = /^\s*(#{1,6})\s+\S/;
const words = (line: string): string => squash(line.replace(PREFIX, ''));

export function pageLines(note: string): string[] {
  if (note === '') return [];
  const lines = note.replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** The line an edit means: the one with the same words, else the only line that contains them. */
export function findLine(lines: string[], wanted: string): number {
  const w = words(wanted);
  if (!w) return -1;
  const exact = lines.findIndex((l) => words(l) === w);
  if (exact >= 0) return exact;
  const containing = lines.flatMap((l, i) => (w.length >= 8 && words(l).includes(w) ? [i] : []));
  return containing.length === 1 ? containing[0] : -1;
}

const asLine = (text: string): string => (PREFIX.test(text) ? text.trim() : `- ${text.trim()}`);

function add(lines: string[], text: string, under?: string): boolean {
  if (!words(text) || lines.some((l) => words(l).includes(words(text)))) return false;
  const line = asLine(text);
  if (under) {
    const h = lines.findIndex((l) => HEADING.test(l) && words(l) === words(under));
    if (h >= 0) {
      const level = HEADING.exec(lines[h])![1].length;
      let end = lines.findIndex((l, i) => i > h && HEADING.test(l) && HEADING.exec(l)![1].length <= level);
      if (end < 0) end = lines.length;
      while (end - 1 > h && lines[end - 1].trim() === '') end--;
      lines.splice(end, 0, line);
      return true;
    }
  }
  // With no heading named, a page that has sections takes the line in its lead (after a "# Title"), not in its last one.
  const top = lines.findIndex((l) => l.trim() !== '');
  const first = lines.findIndex((l, i) => HEADING.test(l) && !(i === top && HEADING.exec(l)![1].length === 1));
  if (!under && first >= 0) {
    let end = first;
    while (end > top + 1 && lines[end - 1].trim() === '') end--;
    lines.splice(end, 0, line);
    return true;
  }
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  const last = lines[lines.length - 1];
  if (under) lines.push(...(lines.length ? [''] : []), `## ${under.replace(/^#+\s*/, '')}`, line);
  else lines.push(...(last !== undefined && !PREFIX.test(last) ? [''] : []), line);
  return true;
}

/** Applies one edit to the lines in place. False when it changes nothing (the line is already there, or not found). */
export function applyEdit(lines: string[], e: PageEdit): boolean {
  if (e.kind === 'add') return add(lines, e.text, e.under);
  const i = findLine(lines, e.old);
  if (i < 0) return false;
  if (e.kind === 'remove') {
    lines.splice(i, 1);
    return true;
  }
  const next = (PREFIX.exec(lines[i])?.[1] ?? '') + e.text.replace(PREFIX, '').trim();
  if (next === lines[i]) return false;
  lines[i] = next;
  return true;
}

/** The page after the edits, and the edits that changed something. */
export function applyEdits(note: string, edits: PageEdit[]): { note: string; applied: PageEdit[] } {
  const lines = pageLines(note);
  const applied = edits.filter((e) => applyEdit(lines, e));
  return { note: applied.length ? `${lines.join('\n')}\n` : note, applied };
}

/** Edits that take a page from `after` back to `before`, so a change made at one scene can be undone in later versions. */
export function inverseEdits(before: string, after: string): PageEdit[] {
  const diff = diffLines(before, after);
  const out: PageEdit[] = [];
  let heading: string | undefined;
  for (let i = 0; i < diff.length; ) {
    if (diff[i].kind === 'same') {
      if (HEADING.test(diff[i].text)) heading = diff[i].text;
      i++;
      continue;
    }
    const removed: string[] = [];
    const added: string[] = [];
    for (; i < diff.length && diff[i].kind !== 'same'; i++) (diff[i].kind === 'del' ? removed : added).push(diff[i].text);
    const paired = Math.min(removed.length, added.length);
    for (let k = 0; k < paired; k++) out.push({ kind: 'replace', old: added[k], text: removed[k] });
    for (const line of added.slice(paired)) out.push({ kind: 'remove', old: line });
    for (const line of removed.slice(paired)) out.push({ kind: 'add', text: line, ...(heading ? { under: heading } : {}) });
  }
  return out;
}

/** The lines of a page version (made by `upTo`, null = the base page) that the agent wrote, by their words. */
export function agentLines(r: Resolver, entityId: Id, upTo: StateChange | null): Set<string> {
  return new Set(
    r
      .lineSources(entityId, upTo)
      .filter((l) => l.change?.agent !== undefined)
      .map((l) => words(l.text)),
  );
}

export const isAgentLine = (owned: Set<string>, line: string): boolean => owned.has(words(line));
