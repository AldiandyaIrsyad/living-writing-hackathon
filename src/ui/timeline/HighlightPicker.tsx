// Toolbar control for highlighting the scenes that involve chosen entities. A "Highlight" button shows
// the number of picks and opens a popover to search and tick entities, grouped by type. The picks also
// show as small removable chips beside the button.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { parseLinks } from '../../core/links';
import { slugify, type Entity, type EntityType, type Id, type Vault } from '../../core/types';
import { getResolver, useStore, useVault } from '../../store/store';
import { fuzzyScore, splitMatches } from '../search';
import './hover.css';

/** Rows the popover renders at most; beyond that the user is asked to refine the search. */
const MAX_ROWS = 200;
/** Chips shown beside the button before the rest collapse into "+N". */
const MAX_CHIPS = 3;

/** Scenes each entity appears in: a state change on it, or a [[link]] to it in the prose. */
export function sceneCounts(vault: Vault): Map<Id, number> {
  // Resolves links the way findEntity does: a name beats an alias, and the first match wins.
  const bySlug = new Map<string, Id>();
  for (const e of Object.values(vault.entities)) {
    const key = slugify(e.name);
    if (key && !bySlug.has(key)) bySlug.set(key, e.id);
  }
  for (const e of Object.values(vault.entities)) {
    for (const alias of e.aliases) {
      const key = slugify(alias);
      if (key && !bySlug.has(key)) bySlug.set(key, e.id);
    }
  }
  const scenesOf = new Map<Id, Set<Id>>();
  const note = (entity: Id, scene: Id) => {
    let set = scenesOf.get(entity);
    if (!set) scenesOf.set(entity, (set = new Set()));
    set.add(scene);
  };
  const r = getResolver(vault);
  for (const c of Object.values(vault.changes)) for (const sceneId of r.scenesOfChange(c)) note(c.entityId, sceneId);
  for (const s of Object.values(vault.scenes)) {
    for (const link of parseLinks(s.prose)) {
      const id = bySlug.get(slugify(link.target));
      if (id) note(id, s.id);
    }
  }
  const out = new Map<Id, number>();
  for (const [id, set] of scenesOf) out.set(id, set.size);
  return out;
}

interface Row {
  entity: Entity;
  type: EntityType | undefined;
  count: number;
}

interface Group {
  key: string;
  label: string;
  color: string;
  rows: Row[];
}

interface Listing {
  groups: Group[];
  /** Matching entities, before the cap. */
  total: number;
  /** Rows actually listed. */
  shown: number;
}

/** Best fuzzy score over the name and the aliases; null when none match. */
function bestScore(query: string, e: Entity): number | null {
  let best: number | null = null;
  for (const text of [e.name, ...e.aliases]) {
    const s = fuzzyScore(query, text);
    if (s !== null && (best === null || s > best)) best = s;
  }
  return best;
}

/**
 * The popover's rows. With an empty search the picks come first under "Selected" and everything else is
 * listed by type; with a search, every match is listed by type in relevance order. Capped at MAX_ROWS.
 */
function listing(vault: Vault, counts: Map<Id, number>, query: string, picked: Set<Id>): Listing {
  const q = query.trim();
  const rowOf = (e: Entity): Row => {
    const type: EntityType | undefined = vault.entityTypes[e.typeId];
    return { entity: e, type, count: counts.get(e.id) ?? 0 };
  };
  const byName = (a: Row, b: Row) => a.entity.name.localeCompare(b.entity.name);
  const selected: Row[] = [];
  const matches: { row: Row; score: number }[] = [];
  for (const e of Object.values(vault.entities)) {
    if (q) {
      const score = bestScore(q, e);
      if (score !== null) matches.push({ row: rowOf(e), score });
    } else if (picked.has(e.id)) {
      selected.push(rowOf(e));
    } else {
      matches.push({ row: rowOf(e), score: 0 });
    }
  }
  matches.sort((a, b) => b.score - a.score || byName(a.row, b.row));

  const groups = new Map<string, Group>();
  for (const { row } of matches) {
    const key = row.type?.id ?? '';
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, label: row.type?.name ?? 'Other', color: row.type?.color ?? 'var(--fg-faint)', rows: [] }));
    g.rows.push(row);
  }
  const ordered = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  if (selected.length) ordered.unshift({ key: '#selected', label: 'Selected', color: 'var(--accent)', rows: selected.sort(byName) });

  const total = ordered.reduce((n, g) => n + g.rows.length, 0);
  let budget = MAX_ROWS;
  const capped: Group[] = [];
  for (const g of ordered) {
    if (budget <= 0) break;
    const rows = g.rows.slice(0, budget);
    budget -= rows.length;
    capped.push({ ...g, rows });
  }
  return { groups: capped, total, shown: Math.min(total, MAX_ROWS) };
}

/** Name text with the search term highlighted. */
function Name({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitMatches(text, query).map((part, i) =>
        part.match ? (
          <span key={i} className="tl-hl-match">
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

export function HighlightPicker() {
  const vault = useVault();
  const active = useStore((s) => s.highlightEntities);
  const toggle = useStore((s) => s.toggleHighlight);
  const clear = useStore((s) => s.clearHighlights);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const chips = useMemo(
    () =>
      active.flatMap((id) => {
        const e = vault.entities[id] as Entity | undefined;
        return e ? [e] : [];
      }),
    [active, vault.entities],
  );
  const picked = useMemo(() => new Set(active), [active]);
  // Involvement only matters while the list is open, so it is computed on demand, once per vault version.
  const counts = useMemo(() => (open ? sceneCounts(vault) : null), [open, vault]);
  const view = useMemo(() => (counts ? listing(vault, counts, query, picked) : null), [counts, vault, query, picked]);
  const flat = useMemo(() => view?.groups.flatMap((g) => g.rows) ?? [], [view]);
  const rowIndex = useMemo(() => new Map(flat.map((r, i) => [r.entity.id, i] as const)), [flat]);
  const at = Math.min(cursor, Math.max(0, flat.length - 1));

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setQuery('');
    setCursor(0);
    if (refocus) button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open, close]);

  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [at, open]);

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
      setCursor(Math.max(0, Math.min(flat.length - 1, next)));
    } else if (e.key === 'Enter') {
      const row = flat[at];
      if (row) {
        e.preventDefault();
        toggle(row.entity.id);
      }
    }
  };

  const n = chips.length;
  const q = query.trim();

  return (
    <div className="tl-hl" ref={root}>
      <div className="tl-hl-anchor">
        <button
          ref={button}
          className={`tl-btn tl-hl-btn ${n ? 'active' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => (open ? close(false) : setOpen(true))}
          title="Highlight the scenes that involve chosen entities"
          data-testid="tl-highlight"
        >
          Highlight
          {n > 0 && (
            <span className="tl-hl-count" data-testid="tl-highlight-count">
              {n}
            </span>
          )}
        </button>
        {open && view && (
          <div
            className="tl-pop tl-pop-right tl-hl-pop"
            role="dialog"
            aria-label="Highlight entities"
            data-testid="tl-highlight-pop"
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              e.stopPropagation();
              close(true);
            }}
          >
            <input
              className="tl-hl-search"
              type="text"
              placeholder="Find an entity…"
              aria-label="Search entities"
              data-testid="tl-highlight-search"
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={onSearchKey}
            />
            <div className="tl-hl-list" role="listbox" aria-multiselectable="true" ref={list} onMouseDown={(e) => e.preventDefault()}>
              {view.total === 0 && <div className="tl-hl-empty">{q ? `Nothing matches “${q}”` : 'No entities yet.'}</div>}
              {view.groups.map((g) => (
                <div key={g.key} role="group" aria-label={g.label}>
                  <div className="tl-hl-group">
                    <span className="dot" style={{ background: g.color }} />
                    <span>{g.label}</span>
                    <span className="grow" />
                    <span>{g.rows.length}</span>
                  </div>
                  {g.rows.map((row) => {
                    const i = rowIndex.get(row.entity.id) ?? -1;
                    const on = picked.has(row.entity.id);
                    return (
                      <div
                        key={row.entity.id}
                        className="tl-hl-row"
                        role="option"
                        aria-selected={on}
                        data-active={i === at}
                        data-on={on}
                        data-testid="tl-highlight-option"
                        data-entity={row.entity.name}
                        onMouseEnter={() => setCursor(i)}
                        onClick={() => toggle(row.entity.id)}
                      >
                        <input type="checkbox" checked={on} readOnly tabIndex={-1} aria-hidden="true" />
                        <span className="dot" style={{ background: row.type?.color ?? 'var(--fg-faint)' }} />
                        <span className="tl-hl-name">
                          <Name text={row.entity.name} query={q} />
                        </span>
                        <span className="tl-hl-row-count" title={`${row.count} scene${row.count === 1 ? '' : 's'} involve this`}>
                          {row.count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="tl-hl-foot">
              <span className="grow">
                {view.total > view.shown ? `Showing ${view.shown} of ${view.total} · refine search` : `${view.total} ${view.total === 1 ? 'entity' : 'entities'}`}
              </span>
              <button className="tl-btn" disabled={!n} onClick={() => clear()} data-testid="tl-highlight-clear">
                Clear
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="tl-hl-chips">
        {chips.slice(0, MAX_CHIPS).map((e) => {
          const type = vault.entityTypes[e.typeId] as EntityType | undefined;
          return (
            <span key={e.id} className="tl-hl-chip" data-testid="tl-highlight-chip" data-entity={e.name} title={e.name}>
              <span className="dot" style={{ background: type?.color ?? 'var(--fg-faint)' }} />
              <span className="tl-hl-chip-name">{e.name}</span>
              <button className="tl-hl-x" onClick={() => toggle(e.id)} aria-label={`Remove ${e.name} from highlight`} title="Remove">
                ×
              </button>
            </span>
          );
        })}
        {n > MAX_CHIPS && (
          <button className="tl-hl-more" data-testid="tl-highlight-more" onClick={() => setOpen(true)} title="Show all highlights">
            +{n - MAX_CHIPS}
          </button>
        )}
      </div>
    </div>
  );
}
