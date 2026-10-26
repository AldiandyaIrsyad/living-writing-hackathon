// Author notes tool: a compact version of the notes view. Click a note to open it where it is written.

import { useMemo, useState } from 'react';
import type { RevealTextDetail } from '../editor/Editor';
import { useStore, useVault } from '../../store/store';
import { PanelHeader } from './PanelHeader';
import { ROW_LIMIT, collectNoteGroups, type NoteGroup, type NoteRow } from './panelData';

export function NotesPanel() {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const [filter, setFilter] = useState('');

  const groups = useMemo(() => collectNoteGroups(vault), [vault]);
  const total = useMemo(() => groups.reduce((sum, g) => sum + g.rows.length, 0), [groups]);

  /** Filtered groups, capped at ROW_LIMIT rows, plus how many matching rows are not shown. */
  const shown = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const filtered: NoteGroup[] =
      query === ''
        ? groups
        : groups
            .map((g) => ({ ...g, rows: g.rows.filter((r) => `${r.text} ${r.where} ${r.label}`.toLowerCase().includes(query)) }))
            .filter((g) => g.rows.length > 0);
    let budget = ROW_LIMIT;
    let matched = 0;
    const out: NoteGroup[] = [];
    for (const g of filtered) {
      matched += g.rows.length;
      if (budget > 0) {
        const rows = g.rows.slice(0, budget);
        budget -= rows.length;
        out.push({ ...g, rows });
      }
    }
    return { groups: out, matched, hidden: matched - (ROW_LIMIT - budget) };
  }, [groups, filter]);

  const open = (row: NoteRow) => {
    if (row.kind === 'entity') {
      navigate({ kind: 'entity', id: row.id });
      return;
    }
    navigate({ kind: 'scene', id: row.id });
    const detail: RevealTextDetail = { sceneId: row.id, from: row.from, to: row.to };
    // Let the scene mount (and its editor start listening) before revealing the note.
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('lw:reveal-text', { detail })), 0);
  };

  return (
    <>
      <PanelHeader title="Author notes">
        <span className="lp-count" data-testid="side-notes-count">
          {total}
        </span>
      </PanelHeader>
      <div className="lp-body">
        <div className="lp-search">
          <input
            className="lp-input"
            type="text"
            data-testid="side-notes-filter"
            placeholder="Filter notes"
            aria-label="Filter notes"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setFilter('');
            }}
          />
          {filter !== '' && (
            <button type="button" className="lp-clear" aria-label="Clear filter" onClick={() => setFilter('')}>
              ×
            </button>
          )}
        </div>

        <div className="lp-list">
          {shown.groups.map((g) => (
            <section key={g.key} className="lp-ngroup" aria-label={g.title}>
              <div className="lp-ngroup-head">
                <span className="lp-dot" style={g.color ? { background: g.color } : { background: 'var(--fg-faint)' }} aria-hidden="true" />
                <span className="lp-row-name">{g.title}</span>
                <span className="lp-row-count">{g.rows.length}</span>
              </div>
              {g.rows.map((row) => (
                <button key={row.key} type="button" className="lp-note" data-testid="side-note" data-kind={row.kind} onClick={() => open(row)}>
                  <span className="lp-note-where">{row.where}</span>
                  <span className="lp-note-text">{row.text === '' ? 'Empty note' : row.text}</span>
                </button>
              ))}
            </section>
          ))}
          {shown.hidden > 0 && <div className="lp-more">+{shown.hidden} more — refine the filter</div>}
          {total === 0 && <div className="lp-empty">No author notes yet. Press Ctrl+/ in a scene to add one.</div>}
          {total > 0 && shown.matched === 0 && <div className="lp-empty">No notes match “{filter.trim()}”.</div>}
        </div>

        <div className="lp-foot">
          <button type="button" className="lp-link" data-testid="side-notes-open" onClick={() => navigate({ kind: 'notes' })}>
            Open notes view…
          </button>
        </div>
      </div>
    </>
  );
}
