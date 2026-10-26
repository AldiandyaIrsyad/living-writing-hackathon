// Quick capture & Idea Queue: a one-line or multi-line idea goes to the end of the Inbox page without leaving the scene.
// The Inbox is an ordinary page of the built-in "Inbox" type, so it syncs, exports and searches like any other.
//
// Each bullet line (`- ...`) is an active idea in the queue; `- [x] ...` is a completed/done idea; `- [ ] ...` is also
// treated as an active idea. Indented continuation lines under a bullet stay attached to that idea so multi-line snippets,
// `[[links]]`, `#tags`, and fenced code blocks work inside the Idea Queue.

import { formatLink, parseLinks } from '../core/links';
import { addStandaloneMilestone } from '../core/labels';
import { installPreset, TYPE_PRESETS } from '../core/presets';
import { insertScene } from '../core/timeline';
import { newId, type Entity, type Id, type Vault } from '../core/types';
import { addChange, addEntity, addStory, parseQuickCommit, setSceneSomeday, sortedStories, sortedTypes, updateEntity, updateSceneProse } from './actions';
import { dayKey } from './stats';

export const INBOX_NAME = 'Inbox';

export interface IdeaItem {
  /** Zero-based index among parsed idea items in the Inbox note. */
  index: number;
  /** Inclusive start character offset in the Inbox note. */
  startOffset: number;
  /** Exclusive end character offset in the Inbox note (includes trailing newline if present). */
  endOffset: number;
  /** True when marked `- [x] ...`. */
  done: boolean;
  /** Optional `YYYY-MM-DD HH:MM` timestamp prefix parsed from the bullet. */
  timestamp?: string;
  /** Optional scene title parsed from a trailing `(from [[Scene]])` suffix. */
  fromSceneTitle?: string;
  /** The idea content (markdown syntax intact, with timestamp and `(from [[...]])` stripped). */
  text: string;
  /** The raw bullet block as stored in the Inbox note (without trailing newline). */
  rawLine: string;
}

const preset = () => TYPE_PRESETS.find((p) => p.key === 'inbox')!;

/** The Inbox page, if anything was ever captured. */
export function inboxOf(vault: Vault): Entity | undefined {
  const typeIds = new Set(Object.values(vault.entityTypes).filter((t) => t.name.trim().toLowerCase() === preset().name.toLowerCase()).map((t) => t.id));
  return Object.values(vault.entities).find((e) => typeIds.has(e.typeId) && e.name === INBOX_NAME);
}

/** True when `entityId` is the vault's Inbox / Idea Queue entity. */
export function isInboxPage(vault: Vault, entityId: Id): boolean {
  return inboxOf(vault)?.id === entityId;
}

const BULLET_START_RE = /^- (?:(\[[ xX]\])\s+)?/;
const STAMP_RE = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+/;
const FROM_SUFFIX_RE = /\s+\(from\s+\[\[([^\]]+)\]\]\)\s*$/;

function parseIdeaBlock(rawBlock: string, index: number, startOffset: number, endOffset: number): IdeaItem {
  const lines = rawBlock.split(/\r?\n/);
  const first = lines[0] ?? '';
  const bulletMatch = BULLET_START_RE.exec(first);
  const box = bulletMatch?.[1]?.toLowerCase();
  const done = box === '[x]';
  let head = first.slice(bulletMatch ? bulletMatch[0].length : 2);

  let timestamp: string | undefined;
  const stampMatch = STAMP_RE.exec(head);
  if (stampMatch) {
    timestamp = stampMatch[1];
    head = head.slice(stampMatch[0].length);
  }

  let fromSceneTitle: string | undefined;
  const lastIdx = lines.length - 1;
  const targetLine = lastIdx === 0 ? head : lines[lastIdx];
  const fromMatch = FROM_SUFFIX_RE.exec(targetLine);
  if (fromMatch) {
    const parsed = parseLinks(`[[${fromMatch[1]}]]`)[0];
    fromSceneTitle = parsed ? parsed.target : fromMatch[1].trim();
    if (lastIdx === 0) {
      head = head.slice(0, fromMatch.index);
    } else {
      lines[lastIdx] = targetLine.slice(0, fromMatch.index);
    }
  }

  const bodyLines = [head, ...lines.slice(1).map((l) => (l.startsWith('  ') ? l.slice(2) : l))];
  return {
    index,
    startOffset,
    endOffset,
    done,
    ...(timestamp ? { timestamp } : {}),
    ...(fromSceneTitle ? { fromSceneTitle } : {}),
    text: bodyLines.join('\n').trim(),
    rawLine: rawBlock,
  };
}

/**
 * Parses every idea bullet from an Inbox note.
 * Top-level `- ` bullets start a new idea; indented continuation lines (`  ...`) or lines inside an unclosed fenced
 * code block stay attached to that bullet. Non-bullet headings or notes are ignored and preserved in place.
 */
export function parseIdeas(note: string): IdeaItem[] {
  if (!note) return [];
  const items: IdeaItem[] = [];
  const lineRe = /[^\r\n]*(\r?\n|$)/g;
  let pos = 0;

  let currentStart = -1;
  let currentEnd = -1;
  let inFence = false;

  const flush = () => {
    if (currentStart < 0) return;
    const rawWithNl = note.slice(currentStart, currentEnd);
    const rawBlock = rawWithNl.replace(/\r?\n$/, '');
    items.push(parseIdeaBlock(rawBlock, items.length, currentStart, currentEnd));
    currentStart = -1;
    currentEnd = -1;
    inFence = false;
  };

  while (pos < note.length) {
    lineRe.lastIndex = pos;
    const m = lineRe.exec(note);
    if (!m || m[0].length === 0) break;
    const fullLine = m[0];
    const lineText = fullLine.replace(/\r?\n$/, '');
    const nextPos = pos + fullLine.length;

    if (currentStart >= 0 && inFence) {
      currentEnd = nextPos;
      if (/^\s*```/.test(lineText)) inFence = false;
    } else if (lineText.startsWith('- ')) {
      flush();
      currentStart = pos;
      currentEnd = nextPos;
      if (/```/.test(lineText) && (lineText.match(/```/g)?.length ?? 0) % 2 === 1) {
        inFence = true;
      }
    } else if (currentStart >= 0 && (lineText.startsWith('  ') || lineText.startsWith('\t'))) {
      currentEnd = nextPos;
      if (/^\s*```/.test(lineText)) inFence = !inFence;
    } else {
      flush();
    }

    pos = nextPos;
  }
  flush();
  return items;
}

function formatIdeaBullet(fields: { text: string; done?: boolean; timestamp?: string; fromSceneTitle?: string }): string {
  const clean = fields.text.replace(/\r\n/g, '\n').trim();
  const lines = clean.split('\n');
  const prefix = fields.done ? '- [x] ' : '- ';
  const stamp = fields.timestamp ? `${fields.timestamp} ` : '';
  const from = fields.fromSceneTitle ? ` (from ${formatLink({ target: fields.fromSceneTitle })})` : '';
  if (lines.length <= 1) {
    return `${prefix}${stamp}${lines[0] ?? ''}${from}`;
  }
  const first = `${prefix}${stamp}${lines[0]}`;
  const rest = lines.slice(1).map((l) => `  ${l}`);
  rest[rest.length - 1] = `${rest[rest.length - 1]}${from}`;
  return [first, ...rest].join('\n');
}

/** How many active (not done) ideas are waiting in the Inbox page. */
export function inboxCount(vault: Vault): number {
  const inbox = inboxOf(vault);
  if (!inbox) return 0;
  return parseIdeas(inbox.note).filter((i) => !i.done).length;
}

/** "14:05" in the writer's own time zone. */
const clock = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * Adds a line "- 2026-10-22 14:05 the idea (from [[Scene]])" to the end of the Inbox page, creating the page (and its
 * type) the first time. Nothing else in the vault changes. Returns the same vault when there is nothing to capture.
 */
export function appendCapture(vault: Vault, text: string, now: Date, fromSceneTitle?: string): Vault {
  const hasFence = text.includes('```');
  const idea = hasFence ? text.replace(/\r\n/g, '\n').trim() : text.replace(/\s+/g, ' ').trim();
  if (idea === '') return vault;
  const line = formatIdeaBullet({
    text: idea,
    timestamp: `${dayKey(now)} ${clock(now)}`,
    fromSceneTitle,
  });
  const existing = inboxOf(vault);
  if (existing) {
    const note = existing.note === '' || existing.note.endsWith('\n') ? existing.note + line + '\n' : `${existing.note}\n${line}\n`;
    return { ...vault, entities: { ...vault.entities, [existing.id]: { ...existing, note } } };
  }
  const installed = installPreset(vault, preset());
  const inbox: Entity = { id: newId('ent'), typeId: installed.id as Id, name: INBOX_NAME, aliases: [], note: `${line}\n`, props: {} };
  return { ...installed.vault, entities: { ...installed.vault.entities, [inbox.id]: inbox } };
}

function replaceIdeaInNote(note: string, item: IdeaItem, replacementLine: string | null): string {
  const before = note.slice(0, item.startOffset);
  const after = note.slice(item.endOffset);
  if (replacementLine === null) {
    return before + after;
  }
  const hadNewline = note.slice(item.startOffset, item.endOffset).endsWith('\n');
  return `${before}${replacementLine}${hadNewline ? '\n' : ''}${after}`;
}

/** Marks an idea at `index` as done (`- [x]`) or active (`- `). */
export function toggleIdeaDone(vault: Vault, index: number, done?: boolean): Vault {
  const inbox = inboxOf(vault);
  if (!inbox) return vault;
  const items = parseIdeas(inbox.note);
  const item = items[index];
  if (!item) return vault;
  const nextDone = done ?? !item.done;
  if (item.done === nextDone) return vault;
  const line = formatIdeaBullet({
    text: item.text,
    done: nextDone,
    timestamp: item.timestamp,
    fromSceneTitle: item.fromSceneTitle,
  });
  const note = replaceIdeaInNote(inbox.note, item, line);
  return { ...vault, entities: { ...vault.entities, [inbox.id]: { ...inbox, note } } };
}

/** Updates the markdown text of an idea at `index` in place, keeping its timestamp, origin scene and done state. */
export function updateIdeaText(vault: Vault, index: number, newText: string): Vault {
  const inbox = inboxOf(vault);
  if (!inbox) return vault;
  const items = parseIdeas(inbox.note);
  const item = items[index];
  if (!item) return vault;
  const trimmed = newText.replace(/\r\n/g, '\n').trim();
  if (!trimmed || trimmed === item.text) return vault;
  const line = formatIdeaBullet({
    text: trimmed,
    done: item.done,
    timestamp: item.timestamp,
    fromSceneTitle: item.fromSceneTitle,
  });
  const note = replaceIdeaInNote(inbox.note, item, line);
  return { ...vault, entities: { ...vault.entities, [inbox.id]: { ...inbox, note } } };
}

/** Deletes an idea at `index` from the Inbox note. */
export function removeIdea(vault: Vault, index: number): Vault {
  const inbox = inboxOf(vault);
  if (!inbox) return vault;
  const items = parseIdeas(inbox.note);
  const item = items[index];
  if (!item) return vault;
  const note = replaceIdeaInNote(inbox.note, item, null);
  return { ...vault, entities: { ...vault.entities, [inbox.id]: { ...inbox, note } } };
}

/** Removes all completed (`- [x]`) ideas from the Inbox note in one step. */
export function clearDoneIdeas(vault: Vault): Vault {
  const inbox = inboxOf(vault);
  if (!inbox) return vault;
  const items = parseIdeas(inbox.note).filter((i) => i.done);
  if (items.length === 0) return vault;
  let note = inbox.note;
  for (let i = items.length - 1; i >= 0; i--) {
    note = replaceIdeaInNote(note, items[i], null);
  }
  return { ...vault, entities: { ...vault.entities, [inbox.id]: { ...inbox, note } } };
}

/**
 * Picks the next idea index when shuffling through the queue.
 * Avoids repeating `currentIndex` when there are 2 or more candidate indices.
 */
export function pickRandomIdeaIndex(candidateIndices: readonly number[], currentIndex: number | null, rand: () => number = Math.random): number | null {
  if (candidateIndices.length === 0) return null;
  if (candidateIndices.length === 1) return candidateIndices[0];
  const pool = currentIndex !== null ? candidateIndices.filter((i) => i !== currentIndex) : [...candidateIndices];
  const list = pool.length > 0 ? pool : candidateIndices;
  const pick = Math.min(list.length - 1, Math.max(0, Math.floor(rand() * list.length)));
  return list[pick];
}

function defaultTitleFromIdea(text: string, fallback: string): string {
  const firstLine = text
    .split(/\r?\n/)[0]
    ?.replace(/^[#>*-\s]+/, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => alias || target)
    .trim();
  if (!firstLine) return fallback;
  return firstLine.length > 48 ? `${firstLine.slice(0, 45).trim()}…` : firstLine;
}

/**
 * Promotes an idea into a Someday (unplaced) scene—or appends it to an existing scene—and removes it from the active queue.
 */
export function promoteIdeaToScene(
  vault: Vault,
  index: number,
  options?: { title?: string; storyId?: Id; appendToSceneId?: Id },
): { vault: Vault; sceneId: Id } | null {
  const inbox = inboxOf(vault);
  if (!inbox) return null;
  const item = parseIdeas(inbox.note)[index];
  if (!item) return null;

  let next = removeIdea(vault, index);

  if (options?.appendToSceneId && next.scenes[options.appendToSceneId]) {
    const target = next.scenes[options.appendToSceneId];
    const sep = target.prose === '' || target.prose.endsWith('\n\n') ? '' : target.prose.endsWith('\n') ? '\n' : '\n\n';
    next = updateSceneProse(next, target.id, `${target.prose}${sep}${item.text}`);
    return { vault: next, sceneId: target.id };
  }

  let storyId = options?.storyId && next.stories[options.storyId] ? options.storyId : sortedStories(next)[0]?.id;
  if (!storyId) {
    const createdStory = addStory(next, 'Main story');
    next = createdStory.vault;
    storyId = createdStory.id;
  }

  const title = options?.title?.trim() || defaultTitleFromIdea(item.text, 'Untitled idea');
  const inserted = insertScene(next, { storyId, title, prose: item.text }, null, null);
  next = setSceneSomeday(inserted.vault, inserted.sceneId, true);
  return { vault: next, sceneId: inserted.sceneId };
}

/**
 * Promotes an idea into a new Wiki Entity—or appends it to an existing Entity's note—and removes it from the queue.
 */
export function promoteIdeaToEntity(
  vault: Vault,
  index: number,
  options?: { name?: string; typeId?: Id; appendToEntityId?: Id },
): { vault: Vault; entityId: Id } | null {
  const inbox = inboxOf(vault);
  if (!inbox) return null;
  const item = parseIdeas(inbox.note)[index];
  if (!item) return null;

  let next = removeIdea(vault, index);

  if (options?.appendToEntityId && next.entities[options.appendToEntityId]) {
    const target = next.entities[options.appendToEntityId];
    const sep = target.note === '' || target.note.endsWith('\n\n') ? '' : target.note.endsWith('\n') ? '\n' : '\n\n';
    next = updateEntity(next, target.id, { note: `${target.note}${sep}${item.text}` });
    return { vault: next, entityId: target.id };
  }

  let typeId = options?.typeId && next.entityTypes[options.typeId] ? options.typeId : sortedTypes(next).find((t) => t.name !== INBOX_NAME)?.id;
  if (!typeId) {
    const installed = installPreset(next, TYPE_PRESETS[0]);
    next = installed.vault;
    typeId = installed.id;
  }

  const name = options?.name?.trim() || defaultTitleFromIdea(item.text, 'New entity');
  const created = addEntity(next, { name, typeId, note: item.text });
  return { vault: created.vault, entityId: created.id };
}

/**
 * Promotes an idea into a Standalone Milestone Label on the timeline and removes it from the queue.
 */
export function promoteIdeaToMilestone(
  vault: Vault,
  index: number,
  options?: { label?: string; concrete?: string },
): { ok: true; vault: Vault; momentId: Id } | { ok: false; error: string } {
  const inbox = inboxOf(vault);
  if (!inbox) return { ok: false, error: 'Idea queue is empty.' };
  const item = parseIdeas(inbox.note)[index];
  if (!item) return { ok: false, error: 'Idea not found.' };

  const label = options?.label?.trim() || defaultTitleFromIdea(item.text, 'New milestone');
  const r = addStandaloneMilestone(vault, { label, concrete: options?.concrete?.trim() || undefined });
  if (!r.ok || !r.momentId) return { ok: false, error: r.ok ? 'Could not create milestone.' : r.error };

  const next = removeIdea(r.vault, index);
  return { ok: true, vault: next, momentId: r.momentId };
}

/**
 * Promotes an idea into a State Change / Commit on an entity (using `parseQuickCommit` syntax like `status = dead — reason`
 * or a plain note) at a scene or timeline column, and removes it from the queue.
 */
export function promoteIdeaToCommit(
  vault: Vault,
  index: number,
  options: { entityId: Id; sceneId?: Id; at?: number; overrideInput?: string },
): { vault: Vault; changeId: Id } | null {
  const inbox = inboxOf(vault);
  if (!inbox) return null;
  const item = parseIdeas(inbox.note)[index];
  if (!item) return null;
  if (!vault.entities[options.entityId]) return null;

  const parsed = parseQuickCommit(options.overrideInput?.trim() || item.text);
  if (!parsed) return null;

  const withoutIdea = removeIdea(vault, index);
  const anchor = options.sceneId && withoutIdea.scenes[options.sceneId] ? { sceneId: options.sceneId } : { at: options.at ?? 0 };
  const added = addChange(withoutIdea, {
    ...anchor,
    entityId: options.entityId,
    op: parsed.op,
    property: parsed.property,
    value: parsed.value,
    message: parsed.message,
  });
  return { vault: added.vault, changeId: added.id };
}

