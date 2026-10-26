// The open scene's author notes. Clicking one selects it in the editor (lw:reveal-text).

import { useMemo } from 'react';
import { findAuthorNotesOutsideCode } from '../../core/links';
import type { Scene } from '../../core/types';
import type { RevealTextDetail } from '../editor/Editor';
import './notes.css';

export function AuthorNotesPanel({ scene }: { scene: Scene }) {
  const notes = useMemo(() => findAuthorNotesOutsideCode(scene.prose), [scene.prose]);

  return (
    <section className="panel author-notes-panel" data-testid="author-notes-panel">
      <div className="panel-head">
        <span>Author notes</span>
        <span className="author-notes-count">{notes.length}</span>
      </div>
      <div className="panel-body">
        {notes.length === 0 ? (
          <p className="author-notes-empty muted">No notes. Press Ctrl+/ in the editor to add one.</p>
        ) : (
          <ul className="notes-list">
            {notes.map((n) => (
              <li key={n.start}>
                <button
                  type="button"
                  className="notes-item"
                  data-testid="author-note-item"
                  onClick={() => {
                    const detail: RevealTextDetail = { sceneId: scene.id, from: n.start, to: n.end };
                    window.dispatchEvent(new CustomEvent('lw:reveal-text', { detail }));
                  }}
                >
                  {n.text === '' ? <em>Empty note</em> : n.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
