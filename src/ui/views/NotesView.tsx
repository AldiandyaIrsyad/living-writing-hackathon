// Author notes view: every %% / <!-- --> note in the vault. Scene notes in reading order per
// story, entity notes under "World". Clicking a scene note opens the scene and reveals it.

import { useMemo, useState } from 'react';
import { findAuthorNotesOutsideCode } from '../../core/links';
import type { Id, Vault } from '../../core/types';
import { useStore, useVault } from '../../store/store';
import type { RevealTextDetail } from '../editor/Editor';
import '../notes/notes.css';

interface NoteRow {
  key: string;
  kind: 'scene' | 'entity';
  /** Scene or entity id. */
  id: Id;
  /** Line shown above the text: "Chapter · Scene" or "Name · Type". */
  where: string;
  /** Searched along with the text. */
  label: string;
  text: string;
  /** Scene notes only: range in the scene's prose. */
  from: number;
  to: number;
}

interface NoteGroup {
  key: string;
  title: string;
  color?: string;
  rows: NoteRow[];
}

function buildGroups(v: Vault): NoteGroup[] {
  const groups: NoteGroup[] = [];
  const stories = Object.values(v.stories).sort((a, b) => a.order - b.order);

  for (const story of stories) {
    const scenes = Object.values(v.scenes)
      .filter((s) => s.storyId === story.id)
      .sort((a, b) => a.order - b.order);
    const rows: NoteRow[] = [];
    for (const scene of scenes) {
      const chapter = scene.chapterId ? v.chapters[scene.chapterId] : undefined;
      const sceneTitle = scene.title || 'Untitled scene';
      const where = `${chapter?.title || 'No chapter'} · ${sceneTitle}`;
      for (const n of findAuthorNotesOutsideCode(scene.prose)) {
        rows.push({
          key: `scene:${scene.id}:${n.start}`,
          kind: 'scene',
          id: scene.id,
          where,
          label: sceneTitle,
          text: n.text,
          from: n.start,
          to: n.end,
        });
      }
    }
    if (rows.length > 0) groups.push({ key: story.id, title: story.name, color: story.color, rows });
  }

  const entityRows: NoteRow[] = [];
  const entities = Object.values(v.entities).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entities) {
    const typeName = v.entityTypes[e.typeId]?.name ?? 'Entity';
    for (const n of findAuthorNotesOutsideCode(e.note)) {
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

export function NotesView() {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => buildGroups(vault), [vault]);
  const total = useMemo(() => groups.reduce((sum, g) => sum + g.rows.length, 0), [groups]);

  const query = filter.trim().toLowerCase();
  const visible = useMemo(
    () =>
      query === ''
        ? groups
        : groups
            .map((g) => ({
              ...g,
              rows: g.rows.filter((r) => `${r.text} ${r.where} ${r.label}`.toLowerCase().includes(query)),
            }))
            .filter((g) => g.rows.length > 0),
    [groups, query],
  );
  const shown = visible.reduce((sum, g) => sum + g.rows.length, 0);

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
    <div className="view view-narrow notes-view" data-testid="notes-view">
      <header className="view-header">
        <h1 className="view-title">
          Author notes
          <span className="notes-count" data-testid="notes-count">
            {total}
          </span>
        </h1>
      </header>
      <p className="muted small notes-intro">
        Notes are hidden from previews and exports. Click one to open it where it is written.
      </p>

      <input
        className="notes-filter"
        type="search"
        placeholder="Filter notes by text, scene or entity"
        aria-label="Filter notes"
        data-testid="notes-filter"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      {total === 0 && <p className="notes-empty">No author notes yet. Press Ctrl+/ in a scene to add one.</p>}
      {total > 0 && query !== '' && shown === 0 && <p className="notes-empty">No notes match “{filter.trim()}”.</p>}

      {visible.map((group) => (
        <section className="notes-group" key={group.key} data-testid="notes-group">
          <h2 className="notes-group-head">
            <span className="notes-group-dot" style={group.color ? { background: group.color } : undefined} />
            <span>{group.title}</span>
            <span className="notes-group-count">{group.rows.length}</span>
          </h2>
          <ul className="notes-rows">
            {group.rows.map((row) => (
              <li key={row.key}>
                <button type="button" className="notes-row" data-testid="notes-row" onClick={() => open(row)}>
                  <span className="notes-row-where">{row.where}</span>
                  <span className="notes-row-text">{row.text === '' ? 'Empty note' : row.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
