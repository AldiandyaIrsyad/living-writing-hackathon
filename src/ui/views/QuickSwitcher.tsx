// Command palette (Ctrl+K): jump to entities, scenes, chapters, arcs and stories, run commands, or search all text.
// Prefixes: "/" full text, ">" commands only, "@" entities only, "#" scenes only.
// Relations: "children of Ashford", "parents of Mira", "siblings of Bob", "under Asia" (all below), "above Harbor" (all above),
// each narrowed by #tags, answered at the playhead. See core/relationQuery.ts.
// Go-to: ":5" chapter 5, ":5.2" scene 2 of chapter 5, ":a2" arc 2, ":s12" scene 12 (">5" works too). See goto.ts.

import { APP_BUILD, APP_VERSION } from '../../core/appInfo';
import { FORMAT_VERSION } from '../../core/exchange';
import { addReviewItems } from '../../core/review';
import { toggleTypewriter } from '../editor/typewriter';
import { askDailyGoal } from '../TodayBadge';
import { OPEN_CAPTURE_EVENT, OPEN_IDEA_QUEUE_EVENT } from '../CaptureBox';
import { OPEN_IMPORT_NOTES_EVENT } from '../ImportNotesDialog';
import { OPEN_REPLACE_EVENT } from '../ReplaceDialog';
import { OPEN_REVIEW_EVENT } from '../ReviewDialog';
import { OPEN_PROBLEMS_EVENT } from '../ProblemsDialog';
import { OPEN_SHORTCUTS_EVENT } from '../ShortcutsDialog';
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { findEntity } from '../../core/links';
import { momentConcrete } from '../../core/concrete';
import { addStandaloneMilestone, allLabels, type ResolvedLabel } from '../../core/labels';
import { parseRelationQuery, RELATION_TITLE, runRelationQuery, type RelationQuery } from '../../core/relationQuery';
import { relationsAt } from '../../core/relations';
import { answerStateQuery, formatStateQuery, parseStateQuery, type ParseResult } from '../../core/stateQuery';
import { insertScene } from '../../core/timeline';
import type { Chapter, Entity, EntityType, Id, Scene, Story, Vault } from '../../core/types';
import { addEntity, addEntityType, addStory, scenesOfStory, sortedStories, sortedTypes } from '../../store/actions';
import { addToCast } from '../../store/cast';
import { getGraph, getResolver, useStore, useVault, type Tab, type View } from '../../store/store';
import { saveQuery } from '../../store/savedQueries';
import { expandTemplate, saveAsTemplate, templatesOf, templateValues } from '../../store/templates';
import type { InsertTextDetail } from '../editor/Editor';
import { navItems, parseGoto, resolveGoto, type GotoQuery, type GotoResolution, type NavTarget } from '../goto';
import { exportVaultJSON, exportVaultZip, loadDemo } from '../io';
import { fullTextSearch, fuzzyScore, splitMatches } from '../search';
import { toggleTheme } from '../theme';
import { buildTimelineModel, targetForColumn } from '../timeline/model';
import './views.css';

/** Rows shown in one palette, across all groups. */
const MAX_ROWS = 40;
/** Per-group budget when several groups are shown together. */
const GROUP_CAP = { entities: 12, scenes: 12, labels: 6, chapters: 6, arcs: 4, stories: 6, commands: 10 } as const;
const RECENT_MAX = 8;
/** Commands offered on an empty query, in order. */
const SUGGESTED = ['new-scene', 'new-entity', 'zoom-fit', 'timeline-max', 'theme'];

export type Mode = 'all' | 'fulltext' | 'commands' | 'entities' | 'timeline' | 'titles' | 'goto';
const PREFIX_MODES: Partial<Record<string, Mode>> = {
  '/': 'fulltext',
  '>': 'commands',
  '@': 'entities',
  '#': 'timeline',
  '?': 'titles',
};
const MODE_LABEL: Partial<Record<Mode, string>> = {
  fulltext: 'Full text',
  commands: 'Commands',
  entities: 'Wiki',
  timeline: 'Timeline',
  titles: 'Titles',
  goto: 'Go to',
};

export const FILTER_PILLS: { mode: Mode; prefix: string; label: string }[] = [
  { mode: 'all', prefix: '', label: 'All' },
  { mode: 'entities', prefix: '@', label: '@ Wiki' },
  { mode: 'timeline', prefix: '#', label: '# Timeline' },
  { mode: 'titles', prefix: '?', label: '? Titles' },
  { mode: 'fulltext', prefix: '/', label: '/ Full text' },
  { mode: 'commands', prefix: '>', label: '> Commands' },
];

export interface ParsedQuery {
  mode: Mode;
  text: string;
  /** Set in go-to mode. */
  goto?: GotoQuery;
  /** Set when the text reads as a relation query (in the plain mode only). */
  relation?: RelationQuery;
  /** Set when the text starts with `where`: a state query, or why it could not be read. */
  state?: ParseResult;
}

export function parseQuery(raw: string): ParsedQuery {
  const go = parseGoto(raw);
  if (go !== null) return { mode: 'goto', text: raw.trim(), goto: go };
  const s = raw.trimStart();
  const mode = PREFIX_MODES[s.charAt(0)];
  if (mode === undefined) {
    const where = /^where(?:\s+(.*))?$/is.exec(s);
    if (where) return { mode: 'all', text: s.trim(), state: parseStateQuery(where[1] ?? '') };
    const relation = parseRelationQuery(s);
    return relation ? { mode: 'all', text: s.trim(), relation } : { mode: 'all', text: s.trim() };
  }
  return { mode, text: s.slice(1).trim() };
}

/** Shown above the list in go-to mode. */
const GOTO_SYNTAX = (
  <>
    <kbd>:5</kbd> chapter 5 · <kbd>:5.2</kbd> scene 2 of chapter 5 · <kbd>:a2</kbd> arc 2 · <kbd>:s12</kbd> scene 12 of the story
  </>
);
/** Shown above the list while a relation query is answered. */
const RELATION_TIP = (
  <>
    Answered at the playhead · <kbd>children</kbd> <kbd>parents</kbd> <kbd>siblings</kbd> <kbd>under</kbd> <kbd>above</kbd> + a name, add <kbd>#tag</kbd> to narrow
  </>
);
/** Shown above the list while a `where` query is answered. */
const STATE_TIP = (
  <>
    <kbd>where</kbd> <kbd>type=Character</kbd> <kbd>status!=dead</kbd> <kbd>location=[[keep]]</kbd> <kbd>#tag</kbd> <kbd>gone</kbd> <kbd>at latest</kbd> <kbd>at Scene title</kbd>
  </>
);
/** Shown above the list on an empty query. */
const IDLE_TIP = (
  <>
    Type <kbd>:5</kbd> to go to chapter 5, <kbd>:5.2</kbd> for a scene, <kbd>:a2</kbd> for an arc
  </>
);

interface Action {
  label: string;
  hint: string;
  run: () => void;
}

type RowKind = 'entity' | 'scene' | 'chapter' | 'arc' | 'story' | 'view' | 'command' | 'create' | 'search';

interface Row {
  key: string;
  kind: RowKind;
  label: string;
  /** Query that fuzzy-matched the label, so its letters can be highlighted. */
  fuzzy?: string;
  /** Secondary text on the right: an entity's type, or a scene's "Story · Chapter". */
  meta?: string;
  color?: string;
  glyph?: string;
  /** Match context under the label (full-text hits); `highlight` is marked inside it. */
  snippet?: string;
  highlight?: string;
  shortcut?: string;
  /** Shift+Enter (or Alt+Enter) runs this; shown as a button on the selected row. */
  secondary?: Action;
  run: () => void;
}

interface Section {
  title: string;
  rows: Row[];
}

interface Command {
  id: string;
  label: string;
  /** Text the query is matched against; defaults to the label. */
  match?: string;
  shortcut?: string;
  run: () => void;
}

interface Ctx {
  vault: Vault;
  tabs: Tab[];
  /** The active view; a scene view makes entities addable to its cast. */
  view: View;
  highlightActive: boolean;
  /** Result of the go-to query; set only in go-to mode. */
  goto: GotoResolution | null;
  /** The entity a relation query names and what it finds, when the text reads as one and the name matches. */
  relation: RelationAnswer | null;
  /** The answer to a `where` query. */
  state: StateAnswer | null;
}

interface StateAnswer {
  /** The query in canonical form, without the word `where`. */
  text: string;
  result: { ok: true; ids: Id[] } | { ok: false; error: string };
}

interface RelationAnswer {
  query: RelationQuery;
  subject: Entity;
  ids: Id[];
}

/** Answers a relation query at the playhead. Null while no entity matches the typed name (then it is an ordinary search). */
function answerRelation(vault: Vault, query: RelationQuery | undefined, playhead: number): RelationAnswer | null {
  if (!query || query.subject === '') return null;
  const items = Object.values(vault.entities).sort((a, b) => a.name.localeCompare(b.name));
  const subject = ranked(items, (e) => bestScore(query.subject, [e.name, ...e.aliases]), 1)[0];
  if (!subject) return null;
  const rel = relationsAt(getResolver(vault), { kind: 'position', x: playhead });
  return { query, subject, ids: runRelationQuery(vault, rel, query, subject.id) };
}

/** Answers a `where` query at the playhead (or at the time it names). */
function answerState(vault: Vault, parsed: ParseResult | undefined, playhead: number): StateAnswer | null {
  if (!parsed) return null;
  if (!parsed.ok) return { text: '', result: parsed };
  return { text: formatStateQuery(parsed.query), result: answerStateQuery(vault, getResolver(vault), parsed.query, playhead) };
}

export function QuickSwitcher() {
  const open = useStore((s) => s.switcherOpen);
  return open ? <SwitcherDialog /> : null;
}

function SwitcherDialog() {
  const vault = useVault();
  const tabs = useStore((s) => s.tabs);
  const view = useStore((s) => s.view);
  const highlightActive = useStore((s) => s.highlightEntities.length > 0);
  const currentStoryId = useStore((s) => s.currentStoryId);
  const playhead = useStore((s) => s.playhead);
  const setSwitcherOpen = useStore((s) => s.setSwitcherOpen);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const parsed = useMemo(() => parseQuery(query), [query]);
  const gotoRes = useMemo(
    () => (parsed.goto ? resolveGoto(vault, currentStoryId, query) : null),
    [parsed.goto, vault, currentStoryId, query],
  );
  const relationRes = useMemo(() => answerRelation(vault, parsed.relation, playhead), [vault, parsed.relation, playhead]);
  const stateRes = useMemo(() => answerState(vault, parsed.state, playhead), [vault, parsed.state, playhead]);
  const sections = useMemo(
    () => buildSections({ vault, tabs, view, highlightActive, goto: gotoRes, relation: relationRes, state: stateRes }, parsed),
    [vault, tabs, view, highlightActive, parsed, gotoRes, relationRes, stateRes],
  );
  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const positions = useMemo(() => new Map(rows.map((r, i) => [r, i] as const)), [rows]);
  const index = Math.min(selected, Math.max(rows.length - 1, 0));
  const active: Row | undefined = rows[index];

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index, rows]);

  const close = () => setSwitcherOpen(false);

  const move = (delta: number) => {
    if (rows.length === 0) return;
    setSelected((index + delta + rows.length) % rows.length);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Enter':
        e.preventDefault();
        if (!active) break;
        if ((e.shiftKey || e.altKey) && active.secondary) active.secondary.run();
        else active.run();
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
    }
  };

  let emptyMessage: string;
  if (parsed.goto) emptyMessage = gotoRes?.message ?? 'Keep typing a chapter, scene or arc number.';
  else if (stateRes) emptyMessage = stateRes.result.ok ? 'Nothing matches that at this point in the story.' : stateRes.result.error;
  else if (relationRes) emptyMessage = `Nothing ${RELATION_TITLE[relationRes.query.kind].toLowerCase()} ${relationRes.subject.name} at the playhead.`;
  else if (parsed.mode === 'fulltext' && parsed.text === '') emptyMessage = 'Type to search the full text.';
  else if (parsed.text === '') emptyMessage = 'Nothing here yet. Create an entity, scene or story to get started.';
  else emptyMessage = `No matches for “${parsed.text}”.`;

  const modeLabel = stateRes ? 'Query' : relationRes ? 'Relations' : MODE_LABEL[parsed.mode];
  const activeId = active ? `switcher-opt-${index}` : undefined;
  const tip = parsed.goto ? GOTO_SYNTAX : stateRes ? STATE_TIP : relationRes ? RELATION_TIP : parsed.mode === 'all' && parsed.text === '' ? IDLE_TIP : null;

  const applyPrefix = (prefix: string) => {
    const stripped = query.replace(/^\s*[/ >@#?]\s*/, '');
    setQuery(prefix ? `${prefix}${stripped ? ` ${stripped}` : ''}` : stripped);
    setSelected(0);
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal switcher" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="switcher-search">
          <svg className="switcher-glyph" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M10.5 10.5 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            className="switcher-input"
            data-testid="switcher-input"
            autoFocus
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls="switcher-results"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="Command palette query"
            placeholder="Search all, or type @ wiki, # timeline, ? titles, / text, > commands…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
          />
          {modeLabel && <span className="switcher-mode">{modeLabel}</span>}
        </div>
        <div className="row small" data-testid="switcher-filters" style={{ padding: '6px 12px', gap: 6, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          {FILTER_PILLS.map((pill) => {
            const isActive = parsed.mode === pill.mode && !parsed.goto;
            return (
              <button
                key={pill.mode}
                type="button"
                className={`btn btn-sm ${isActive ? 'active' : 'btn-ghost'}`}
                data-testid={`switcher-filter-${pill.mode}`}
                onClick={() => applyPrefix(pill.prefix)}
              >
                {pill.label}
              </button>
            );
          })}
        </div>
        {tip && (
          <div className="switcher-tip" data-testid="switcher-tip">
            {tip}
          </div>
        )}
        <ul id="switcher-results" ref={listRef} className="switcher-list" role="listbox" aria-label="Results">
          {sections.map((section) => (
            <Fragment key={section.title}>
              <li role="presentation" className="switcher-group">
                {section.title}
              </li>
              {section.rows.map((row) => {
                const i = positions.get(row) ?? 0;
                return <RowItem key={row.key} row={row} index={i} selected={i === index} onHover={setSelected} />;
              })}
            </Fragment>
          ))}
        </ul>
        {rows.length === 0 && (
          <div className="muted small switcher-empty" data-testid="switcher-empty">
            {emptyMessage}
          </div>
        )}
        <div className="switcher-hint">
          <span className="switcher-prefixes">
            <span>
              <kbd>@</kbd> wiki
            </span>
            <span>
              <kbd>#</kbd> timeline
            </span>
            <span>
              <kbd>?</kbd> titles
            </span>
            <span>
              <kbd>/</kbd> full text
            </span>
            <span>
              <kbd>&gt;</kbd> commands
            </span>
          </span>
          <span className="switcher-keys">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> move
            </span>
            <span>
              <kbd>↵</kbd> open
            </span>
            <span>
              <kbd>⇧↵</kbd> secondary
            </span>
            <span>
              <kbd>Esc</kbd> close
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

function RowItem({ row, index, selected, onHover }: { row: Row; index: number; selected: boolean; onHover: (i: number) => void }) {
  const action = row.secondary;
  const hasSnippet = row.snippet !== undefined;
  const parts = hasSnippet ? splitMatches(row.snippet ?? '', row.highlight ?? '') : [];
  return (
    <li
      id={`switcher-opt-${index}`}
      role="option"
      aria-selected={selected}
      data-testid="switcher-result"
      data-kind={row.kind}
      className={`switcher-row${hasSnippet ? ' has-snippet' : ''}`}
      onMouseEnter={() => onHover(index)}
      onClick={() => row.run()}
    >
      {row.color ? (
        <span className="switcher-dot" style={{ background: row.color }} />
      ) : row.glyph ? (
        <span className="switcher-chip" aria-hidden="true">
          {row.glyph}
        </span>
      ) : null}
      <span className="switcher-text">
        <span className="switcher-label">{row.fuzzy ? <FuzzyText text={row.label} query={row.fuzzy} /> : row.label}</span>
        {hasSnippet && (
          <span className="switcher-snippet">
            {parts.map((p, i) => (p.match ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
          </span>
        )}
      </span>
      {row.meta && <span className="switcher-meta">{row.meta}</span>}
      {row.shortcut && <kbd className="switcher-shortcut">{row.shortcut}</kbd>}
      {selected && action && (
        <button
          type="button"
          tabIndex={-1}
          className="switcher-action"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            action.run();
          }}
        >
          {action.label}
          <kbd>{action.hint}</kbd>
        </button>
      )}
      {selected && <kbd className="switcher-enter" aria-hidden="true">↵</kbd>}
    </li>
  );
}

/** Renders `text` with the letters matched by `query` (subsequence match) highlighted. */
function FuzzyText({ text, query }: { text: string; query: string }) {
  const hits = fuzzyPositions(query, text);
  const parts: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = hits.has(i);
    const last = parts[parts.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else parts.push({ text: text[i], hit });
  }
  return (
    <>
      {parts.map((p, i) => (p.hit ? <mark key={i} className="switcher-hit">{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

function fuzzyPositions(query: string, text: string): Set<number> {
  const out = new Set<number>();
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  let pos = 0;
  for (const ch of q) {
    const at = t.indexOf(ch, pos);
    if (at === -1) return new Set();
    out.add(at);
    pos = at + 1;
  }
  return out;
}

// ---- Sections ----

function buildSections(ctx: Ctx, pq: ParsedQuery): Section[] {
  const { mode, text } = pq;
  if (pq.goto) return gotoSections(ctx);
  if (ctx.state) return stateSections(ctx, ctx.state);
  if (ctx.relation) return relationSections(ctx, ctx.relation);
  if (mode === 'all' && text === '') return idleSections(ctx);
  if (mode === 'fulltext') return fullTextSections(ctx, text);

  const single = mode !== 'all';
  const cap = (n: number) => (single ? MAX_ROWS : n);
  const sections: Section[] = [];
  const push = (title: string, rows: Row[]) => {
    if (rows.length > 0) sections.push({ title, rows });
  };

  if (mode === 'all' || mode === 'entities') {
    const rows = entityRows(ctx, text, cap(GROUP_CAP.entities));
    if (mode === 'entities' && text !== '' && !findEntity(ctx.vault, text)) rows.push(createRow(text));
    push('Wiki Entities', rows);
  }
  if (mode === 'timeline') {
    push('Labels & Milestones', labelRows(ctx, text, MAX_ROWS));
    push('Timeline Scenes & Dates', timelineSceneRows(ctx, text, MAX_ROWS));
  }
  if (mode === 'titles') {
    push('Scenes', titleSceneRows(ctx, text, cap(GROUP_CAP.scenes)));
    push('Chapters', navRows(ctx, text, 'chapter', cap(GROUP_CAP.chapters)));
    push('Arcs', navRows(ctx, text, 'arc', cap(GROUP_CAP.arcs)));
    push('Stories', storyRows(ctx, text, cap(GROUP_CAP.stories)));
  }
  if (mode === 'all') {
    push('Scenes', sceneRows(ctx, text, cap(GROUP_CAP.scenes)));
    push('Labels', labelRows(ctx, text, GROUP_CAP.labels));
    push('Chapters', navRows(ctx, text, 'chapter', GROUP_CAP.chapters));
    push('Arcs', navRows(ctx, text, 'arc', GROUP_CAP.arcs));
    push('Stories', storyRows(ctx, text, GROUP_CAP.stories));
    if (text !== '' && !findEntity(ctx.vault, text)) {
      push('Create', [createRow(text)]);
    }
  }
  if (mode === 'all' || mode === 'commands') {
    const rows = commandRows(ctx, text, cap(GROUP_CAP.commands));
    if (mode === 'all' && text !== '') rows.push(searchRow(text));
    push('Commands', rows);
  }
  return sections;
}

/** A `where` query: the entities that match, and a row that keeps the query as a smart list. */
function stateSections(ctx: Ctx, answer: StateAnswer): Section[] {
  if (!answer.result.ok) return [];
  const rows: Row[] = answer.result.ids.slice(0, MAX_ROWS).map((id) => entityRow(ctx, ctx.vault.entities[id]));
  const save: Row = {
    key: 'save-query',
    kind: 'create',
    label: 'Keep this query as a smart list…',
    glyph: '+',
    run: () => {
      const name = window.prompt('Name the smart list:', '')?.trim();
      if (!name) return;
      const s = useStore.getState();
      const r = saveQuery(s.vault, name, answer.text);
      s.commit(r.vault, undefined, 'Save a smart list');
      s.setSwitcherOpen(false);
      s.navigate({ kind: 'entity', id: r.id });
    },
  };
  return [{ title: `Where ${answer.text || 'anything exists'} · ${answer.result.ids.length}`, rows: [save, ...rows] }];
}

/** A relation query: the entities it names, titled by what was asked ("Children of Ashford"). */
function relationSections(ctx: Ctx, answer: RelationAnswer): Section[] {
  const rows = answer.ids.slice(0, MAX_ROWS).map((id) => entityRow(ctx, ctx.vault.entities[id]));
  return rows.length > 0 ? [{ title: `${RELATION_TITLE[answer.query.kind]} ${answer.subject.name}`, rows }] : [];
}

/** Go-to mode: the target(s) of the query, or nothing (the message explains why). */
function gotoSections(ctx: Ctx): Section[] {
  const targets = ctx.goto?.targets ?? [];
  return targets.length > 0 ? [{ title: 'Go to', rows: targets.map((t) => navRow(t)) }] : [];
}

/** Empty query: what was open recently, then a few suggested commands. */
function idleSections(ctx: Ctx): Section[] {
  const sections: Section[] = [];
  const recent = [...ctx.tabs]
    .reverse()
    .map((tab) => recentRow(ctx, tab))
    .filter((r): r is Row => r !== null)
    .slice(0, RECENT_MAX);
  if (recent.length > 0) sections.push({ title: 'Recent', rows: recent });

  const all = buildCommands(ctx, false);
  const suggested = SUGGESTED.flatMap((id) => all.filter((c) => c.id === id)).map((c) => commandRow(c));
  if (suggested.length > 0) sections.push({ title: 'Suggested', rows: suggested });
  return sections;
}

function fullTextSections(ctx: Ctx, text: string): Section[] {
  if (text === '') return [];
  const entities: Row[] = [];
  const scenes: Row[] = [];
  for (const hit of fullTextSearch(ctx.vault, text, MAX_ROWS)) {
    if (hit.kind === 'entity') {
      const e = ctx.vault.entities[hit.id];
      if (e) entities.push({ ...entityRow(ctx, e), snippet: hit.snippet, highlight: text });
    } else {
      const s = ctx.vault.scenes[hit.id];
      if (s) scenes.push({ ...sceneRow(ctx, s), snippet: hit.snippet, highlight: text });
    }
  }
  const sections: Section[] = [];
  if (entities.length > 0) sections.push({ title: 'Entities', rows: entities });
  if (scenes.length > 0) sections.push({ title: 'Scenes', rows: scenes });
  sections.push({ title: 'Commands', rows: [searchRow(text)] });
  return sections;
}

// ---- Row builders ----

/** Keeps the best `limit` items by score (empty query scores everything 0, so input order holds). */
function ranked<T>(items: readonly T[], score: (item: T) => number | null, limit: number): T[] {
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const s = score(item);
    if (s !== null) scored.push({ item, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.item);
}

function entityRows(ctx: Ctx, text: string, limit: number): Row[] {
  const items = Object.values(ctx.vault.entities).sort((a, b) => a.name.localeCompare(b.name));
  return ranked(items, (e) => bestScore(text, [e.name, ...e.aliases]), limit).map((e) => ({ ...entityRow(ctx, e), fuzzy: text }));
}

function sceneRows(ctx: Ctx, text: string, limit: number): Row[] {
  const items = sortedStories(ctx.vault).flatMap((st) => scenesOfStory(ctx.vault, st.id));
  return ranked(
    items,
    (s) => {
      const m = ctx.vault.moments[s.momentId];
      const concrete = momentConcrete(m);
      const timeSkip = m?.timeSkip;
      const chLabels = s.chapterId ? (ctx.vault.chapters[s.chapterId]?.labels ?? []) : [];
      return bestScore(text, [s.title, ...(concrete ? [concrete] : []), ...(timeSkip ? [timeSkip] : []), ...(s.labels ?? []), ...chLabels]);
    },
    limit,
  ).map((s) => ({ ...sceneRow(ctx, s), fuzzy: text }));
}

function titleSceneRows(ctx: Ctx, text: string, limit: number): Row[] {
  const items = sortedStories(ctx.vault).flatMap((st) => scenesOfStory(ctx.vault, st.id));
  return ranked(items, (s) => bestScore(text, [s.title, ...(s.synopsis ? [s.synopsis] : [])]), limit).map((s) => ({
    ...sceneRow(ctx, s),
    fuzzy: text,
  }));
}

function timelineSceneRows(ctx: Ctx, text: string, limit: number): Row[] {
  const items = sortedStories(ctx.vault)
    .flatMap((st) => scenesOfStory(ctx.vault, st.id))
    .filter((s) => !s.someday);
  return ranked(
    items,
    (s) => {
      const m = ctx.vault.moments[s.momentId];
      const concrete = momentConcrete(m);
      const timeSkip = m?.timeSkip;
      const chLabels = s.chapterId ? (ctx.vault.chapters[s.chapterId]?.labels ?? []) : [];
      return bestScore(text, [...(concrete ? [concrete] : []), ...(timeSkip ? [timeSkip] : []), ...(s.labels ?? []), ...chLabels, s.title]);
    },
    limit,
  ).map((s) => ({ ...sceneRow(ctx, s), fuzzy: text }));
}

function labelRows(ctx: Ctx, text: string, limit: number): Row[] {
  const items = allLabels(ctx.vault);
  return ranked(
    items,
    (l) => {
      const concretes = l.moments.map((m) => momentConcrete(m)).filter((x): x is string => Boolean(x));
      return bestScore(text, [l.name, ...concretes]);
    },
    limit,
  ).map((l) => labelRow(l, text));
}

function labelRow(l: ResolvedLabel, fuzzy?: string): Row {
  const chCount = l.chapters.length;
  const scCount = l.scenes.length;
  const concretes = [...new Set(l.moments.map((m) => momentConcrete(m)).filter((x): x is string => Boolean(x)))];
  const metaParts: string[] = [];
  if (concretes.length > 0) metaParts.push(concretes.join(', '));
  if (chCount > 0) metaParts.push(`${chCount} ${chCount === 1 ? 'chapter' : 'chapters'}`);
  if (scCount > 0) metaParts.push(`${scCount} ${scCount === 1 ? 'scene' : 'scenes'}`);
  if (chCount === 0 && scCount === 0 && l.startCol !== null) metaParts.push(`Column ${l.startCol + 1} · Milestone`);
  const firstScene = l.firstScene;
  const startCol = l.startCol;
  const jumpMilestone = () => {
    const st = useStore.getState();
    st.setSwitcherOpen(false);
    if (startCol !== null) st.revealColumn(startCol, startCol);
  };
  return {
    key: `label:${l.name}`,
    kind: 'view',
    label: l.name,
    fuzzy,
    glyph: '🏷',
    meta: metaParts.join(' · ') || 'Label',
    secondary: firstScene
      ? { label: 'Jump playhead here', hint: '⇧↵', run: () => jumpToScene(firstScene.id) }
      : startCol !== null
        ? { label: 'Jump playhead here', hint: '⇧↵', run: jumpMilestone }
        : undefined,
    run: () => {
      if (firstScene) jumpToScene(firstScene.id);
      else if (startCol !== null) jumpMilestone();
      else useStore.getState().toast('info', `Label “${l.name}” has no scenes yet`);
    },
  };
}

/** Chapters or arcs of every story, matched by their title or by "Chapter N" / "Arc N". */
function navRows(ctx: Ctx, text: string, kind: 'chapter' | 'arc', limit: number): Row[] {
  const items = navItems(ctx.vault).filter((t) => t.kind === kind);
  return ranked(items, (t) => bestScore(text, t.texts), limit).map((t) => navRow(t, text));
}

function storyRows(ctx: Ctx, text: string, limit: number): Row[] {
  return ranked(sortedStories(ctx.vault), (st) => fuzzyScore(text, st.name), limit).map((st) => storyRow(ctx, st));
}

function commandRows(ctx: Ctx, text: string, limit: number): Row[] {
  const commands = buildCommands(ctx, text.length >= 2);
  return ranked(commands, (c) => fuzzyScore(text, c.match ?? c.label), limit).map((c) =>
    commandRow(c, c.match === undefined ? text : undefined),
  );
}

/** A tab's view as a row; null when the view points at something that no longer exists. */
function recentRow(ctx: Ctx, tab: Tab): Row | null {
  const view = tab.view;
  const key = `recent:${tab.id}`;
  switch (view.kind) {
    case 'entity': {
      const e = ctx.vault.entities[view.id];
      return e ? { ...entityRow(ctx, e), key } : null;
    }
    case 'scene': {
      const s = ctx.vault.scenes[view.id];
      return s ? { ...sceneRow(ctx, s), key } : null;
    }
    case 'story': {
      const st = ctx.vault.stories[view.id];
      return st ? { ...storyRow(ctx, st), key } : null;
    }
    case 'home':
      return { key, kind: 'view', label: 'Home', glyph: '↺', run: () => openView({ kind: 'home' }) };
    case 'types':
      return { key, kind: 'view', label: 'Entity types', glyph: '↺', run: () => openView({ kind: 'types' }) };
    case 'tag':
      return { key, kind: 'view', label: `#${view.tag}`, glyph: '↺', run: () => openView({ kind: 'tag', tag: view.tag }) };
    case 'search':
      return { key, kind: 'view', label: `Search “${view.query}”`, glyph: '↺', run: () => openView({ kind: 'search', query: view.query }) };
    default:
      return null;
  }
}

function entityRow(ctx: Ctx, e: Entity): Row {
  const type: EntityType | undefined = ctx.vault.entityTypes[e.typeId];
  const v = ctx.view;
  const sceneId = v.kind === 'scene' && ctx.vault.scenes[v.id] ? v.id : null;
  return {
    key: `entity:${e.id}`,
    kind: 'entity',
    label: e.name,
    meta: type?.name,
    color: type?.color,
    secondary: sceneId ? { label: 'Add to scene cast', hint: '⇧↵', run: () => addEntityToCast(sceneId, e.id) } : undefined,
    run: () => openView({ kind: 'entity', id: e.id }),
  };
}

function sceneRow(ctx: Ctx, s: Scene): Row {
  const story: Story | undefined = ctx.vault.stories[s.storyId];
  const chapter: Chapter | undefined = s.chapterId === null ? undefined : ctx.vault.chapters[s.chapterId];
  const concrete = momentConcrete(ctx.vault.moments[s.momentId]);
  const meta = [story?.name, s.someday ? '☁ Someday' : chapter?.title, concrete].filter((x): x is string => Boolean(x)).join(' · ');
  return {
    key: `scene:${s.id}`,
    kind: 'scene',
    label: s.title || 'Untitled scene',
    meta,
    color: story?.color,
    secondary: s.someday ? undefined : { label: 'Jump playhead here', hint: '⇧↵', run: () => jumpToScene(s.id) },
    run: () => openView({ kind: 'scene', id: s.id }),
  };
}

function navRow(t: NavTarget, fuzzy?: string): Row {
  return {
    key: `nav:${t.kind}:${t.storyId}:${t.number}`,
    kind: t.kind,
    label: t.label,
    fuzzy,
    meta: t.meta,
    color: t.color,
    run: () => openNav(t),
  };
}

function storyRow(ctx: Ctx, st: Story): Row {
  const chapters = Object.values(ctx.vault.chapters).filter((c) => c.storyId === st.id).length;
  return {
    key: `story:${st.id}`,
    kind: 'story',
    label: st.name,
    meta: `${chapters} ${chapters === 1 ? 'chapter' : 'chapters'}`,
    color: st.color,
    run: () => openView({ kind: 'story', id: st.id }),
  };
}

function commandRow(cmd: Command, fuzzy?: string): Row {
  return {
    key: `cmd:${cmd.id}`,
    kind: 'command',
    label: cmd.label,
    fuzzy,
    glyph: '›',
    shortcut: cmd.shortcut,
    run: () => runCommand(cmd),
  };
}

function createRow(name: string): Row {
  return { key: 'create', kind: 'create', label: `Create entity “${name}”`, glyph: '+', run: () => createEntity(name) };
}

function searchRow(text: string): Row {
  return {
    key: 'search',
    kind: 'search',
    label: `Search all text for “${text}”`,
    glyph: '/',
    run: () => openView({ kind: 'search', query: text }),
  };
}

// ---- Commands ----

/** Commands in display order. Entity highlight commands are added when `withEntityCommands` is set. */
function buildCommands(ctx: Ctx, withEntityCommands: boolean): Command[] {
  const commands: Command[] = [
    { id: 'new-scene', label: 'New scene at playhead', run: newSceneAtPlayhead },
    { id: 'new-milestone', label: 'New milestone label / concrete anchor…', run: newMilestone },
    { id: 'new-story', label: 'New story', run: newStory },
    { id: 'close-all-tabs', label: 'Close all tabs', run: () => useStore.getState().closeAllTabs() },
    { id: 'capture', label: 'Quick capture…', shortcut: 'Ctrl+Shift+Space', run: () => setTimeout(() => window.dispatchEvent(new Event(OPEN_CAPTURE_EVENT)), 0) },
    { id: 'idea-queue', label: 'Open Idea Queue (shuffle & review ideas)…', run: () => setTimeout(() => window.dispatchEvent(new Event(OPEN_IDEA_QUEUE_EVENT)), 0) },
    { id: 'import-notes', label: 'Import notes from a folder or zip…', run: () => window.dispatchEvent(new Event(OPEN_IMPORT_NOTES_EVENT)) },
    { id: 'replace', label: 'Find and replace…', run: () => window.dispatchEvent(new Event(OPEN_REPLACE_EVENT)) },
    { id: 'review-list', label: 'Show review list', run: () => window.dispatchEvent(new Event(OPEN_REVIEW_EVENT)) },
    { id: 'review-flag', label: 'Flag this scene for review…', run: flagCurrentScene },
    { id: 'problems', label: 'Show problems', run: () => window.dispatchEvent(new Event(OPEN_PROBLEMS_EVENT)) },
    { id: 'shortcuts', label: 'Keyboard shortcuts', shortcut: '?', run: () => window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT)) },
    { id: 'reopen-tab', label: 'Reopen closed tab', run: () => useStore.getState().reopenClosedTab() },
    { id: 'new-entity', label: 'New entity', run: newEntity },
    { id: 'zoom-fit', label: 'Timeline: fit whole work', run: fitTimeline },
    { id: 'toggle-left', label: 'Toggle side panel', shortcut: 'Ctrl+B', run: () => useStore.getState().setLeftOpen(!useStore.getState().leftOpen) },
    { id: 'toggle-right', label: 'Toggle quick panel', shortcut: 'Ctrl+Alt+B', run: () => useStore.getState().setRightOpen(!useStore.getState().rightOpen) },
    { id: 'timeline-max', label: 'Toggle maximised timeline', run: toggleMaximised },
    { id: 'toggle-timeline', label: 'Toggle timeline', shortcut: 'Ctrl+J', run: toggleTimeline },
    { id: 'daily-goal', label: 'Set daily word goal…', run: askDailyGoal },
    { id: 'typewriter', label: 'Toggle typewriter scrolling', run: () => useStore.getState().toast('info', toggleTypewriter() ? 'Typewriter scrolling on: the line you are writing stays centred.' : 'Typewriter scrolling off.') },
    { id: 'theme', label: 'Toggle theme', run: toggleTheme },
    { id: 'export-json', label: 'Export JSON', run: exportVaultJSON },
    {
      id: 'export-manuscript',
      label: 'Export manuscript (chapters → Markdown / HTML / text)',
      run: () => window.dispatchEvent(new CustomEvent('lw:export-manuscript', { detail: { storyId: useStore.getState().currentStoryId ?? undefined } })),
    },
    { id: 'author-notes', label: 'Open author notes', run: () => useStore.getState().navigate({ kind: 'notes' }) },
    {
      id: 'export-md',
      label: 'Export Markdown zip',
      run: () => {
        void exportVaultZip();
      },
    },
    { id: 'demo', label: 'Load demo world', run: loadDemo },
    { id: 'about', label: 'About Living Writing (version)', run: () => useStore.getState().toast('info', `Living Writing ${APP_VERSION}, build ${APP_BUILD}. File format ${FORMAT_VERSION}.`) },
    { id: 'types', label: 'Open entity types', run: () => openView({ kind: 'types' }) },
  ];
  if (ctx.view.kind === 'scene') {
    const sceneId = ctx.view.id;
    commands.push({ id: 'template-save', label: 'Save this scene as a template…', run: () => saveSceneAsTemplate(sceneId) });
    for (const t of templatesOf(ctx.vault)) {
      commands.push({ id: `template:${t.id}`, label: `Insert template: ${t.name}`, run: () => insertTemplate(t.id, sceneId) });
    }
  }
  if (ctx.highlightActive) {
    commands.push({ id: 'clear-highlight', label: 'Clear highlight', run: () => useStore.getState().clearHighlights() });
  }
  if (withEntityCommands) {
    for (const e of Object.values(ctx.vault.entities).sort((a, b) => a.name.localeCompare(b.name))) {
      commands.push({
        id: `highlight:${e.id}`,
        label: `Highlight scenes involving ${e.name}`,
        match: e.name,
        run: () => useStore.getState().toggleHighlight(e.id),
      });
    }
  }
  return commands;
}

function runCommand(cmd: Command): void {
  useStore.getState().setSwitcherOpen(false);
  cmd.run();
}

function fitTimeline(): void {
  window.dispatchEvent(new Event('lw:timeline-fit'));
}

function toggleMaximised(): void {
  const s = useStore.getState();
  s.setTimelineMaximized(!s.timelineMaximized);
}

function toggleTimeline(): void {
  useStore.getState().setTimelineCollapsed(!useStore.getState().timelineCollapsed);
}

function newStory(): void {
  const store = useStore.getState();
  const name = uniqueName('New story', Object.values(store.vault.stories).map((st) => st.name));
  const created = addStory(store.vault, name);
  store.commit(created.vault);
  store.navigate({ kind: 'story', id: created.id });
}

function newEntity(): void {
  const names = Object.values(useStore.getState().vault.entities).map((e) => e.name);
  createEntity(uniqueName('New entity', names));
}

/**
 * Inserts a scene in the playhead's column, in the first visible story: at the same time as a scene that starts
 * there, during a stretched clip running over it, else after the last clip to finish before it. Floating when the
 * work has no scenes yet.
 */
/** Puts the open scene on the review list with a reason the writer types. */
function flagCurrentScene(): void {
  const s = useStore.getState();
  if (s.view.kind !== 'scene') {
    s.toast('info', 'Open a scene first, then flag it.');
    return;
  }
  const cause = window.prompt('Why look at this scene again?')?.trim();
  if (!cause) return;
  s.commit(addReviewItems(s.vault, [{ sceneId: s.view.id, cause }]), undefined, 'Flag a scene for review');
  s.toast('info', 'Added to the review list.');
}

function saveSceneAsTemplate(sceneId: Id): void {
  const s = useStore.getState();
  const scene = s.vault.scenes[sceneId];
  if (!scene) return;
  const name = window.prompt('Name the template:', scene.title)?.trim();
  if (!name) return;
  s.commit(saveAsTemplate(s.vault, name, scene.prose).vault, undefined, 'Save a template');
  s.toast('info', `Saved as the template “${name}”. Insert it from the palette.`);
}

/** Puts a template's text, with its placeholders filled in for this scene, at the caret. */
function insertTemplate(templateId: Id, sceneId: Id): void {
  const s = useStore.getState();
  const template = s.vault.entities[templateId];
  if (!template) return;
  const text = expandTemplate(template.note, templateValues(s.vault, sceneId, new Date()));
  // The palette has just closed; the editor needs a moment to take focus back.
  setTimeout(() => window.dispatchEvent(new CustomEvent<InsertTextDetail>('lw:insert-text', { detail: { text } })), 0);
}

function newSceneAtPlayhead(): void {
  const store = useStore.getState();
  let vault = store.vault;
  const hidden = new Set(store.hiddenStories);
  const stories = sortedStories(vault);
  const visible = stories.filter((st) => !hidden.has(st.id));
  const pool = visible.length > 0 ? visible : stories;
  let storyId: Id | undefined = pool[0]?.id;
  if (storyId === undefined) {
    const created = addStory(vault, 'Main story');
    vault = created.vault;
    storyId = created.id;
  }

  const model = buildTimelineModel(vault, getGraph(vault), []);
  const target = targetForColumn(vault, model, Math.floor(store.playhead));
  const result = insertScene(vault, { storyId, title: 'New scene' }, target?.relation ?? null, target?.sceneId ?? null);
  const scene = result.vault.scenes[result.sceneId];
  store.commit(result.vault);
  store.navigate({ kind: 'scene', id: result.sceneId });
  store.revealColumn(getGraph(result.vault).layerOf(scene.momentId));
}

function newMilestone(): void {
  const store = useStore.getState();
  const label = window.prompt('Milestone label (e.g. The Death of Hero Nora):', '')?.trim();
  const concrete = window.prompt('Concrete date (optional, e.g. Autumn, 2026 or 2026-10-25):', '')?.trim();
  if (!label && !concrete) return;
  const r = addStandaloneMilestone(store.vault, { label: label || undefined, concrete: concrete || undefined });
  if (!r.ok) {
    store.toast('error', r.error);
    return;
  }
  store.commit(r.vault);
  if (r.momentId) store.revealColumn(getGraph(r.vault).layerOf(r.momentId));
  store.toast('info', `Added milestone ${[label && `“${label}”`, concrete].filter(Boolean).join(' · ')}`);
}

// ---- Actions ----

/** Creates an entity of the first type (making a "Note" type if none exist), then opens it. */
function createEntity(name: string): void {
  const store = useStore.getState();
  let vault = store.vault;
  let typeId = sortedTypes(vault).at(0)?.id;
  if (typeId === undefined) {
    const created = addEntityType(vault, { name: 'Note', icon: '' });
    vault = created.vault;
    typeId = created.id;
  }
  const entity = addEntity(vault, { name, typeId });
  store.commit(entity.vault);
  openView({ kind: 'entity', id: entity.id });
}

function openView(view: View): void {
  const store = useStore.getState();
  store.navigate(view);
  store.setSwitcherOpen(false);
}

/** Adds an entity to a scene's cast. The palette stays open so several can be added. */
function addEntityToCast(sceneId: Id, entityId: Id): void {
  const store = useStore.getState();
  const entity = store.vault.entities[entityId];
  const scene = store.vault.scenes[sceneId];
  if (!entity || !scene) return;
  store.commit(addToCast(store.vault, sceneId, entityId));
  store.toast('info', `Added ${entity.name} to the cast of “${scene.title || 'Untitled scene'}”`);
}

/** A chapter or arc opens its first scene. Stays open when there is nothing to open. */
function openNav(t: NavTarget): void {
  if (t.sceneId === null) {
    useStore.getState().toast('info', `${t.label} has no scenes yet`);
    return;
  }
  jumpToScene(t.sceneId);
}

/** Scrolls the timeline to a scene's column and moves the playhead there, then opens the scene. */
function jumpToScene(id: Id): void {
  const store = useStore.getState();
  const scene = store.vault.scenes[id];
  if (!scene) return;
  const column = getGraph(store.vault).layerOf(scene.momentId);
  store.revealColumn(column, column);
  openView({ kind: 'scene', id });
}

function uniqueName(base: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

function bestScore(query: string, texts: string[]): number | null {
  let best: number | null = null;
  for (const text of texts) {
    const score = fuzzyScore(query, text);
    if (score !== null && (best === null || score > best)) best = score;
  }
  return best;
}
