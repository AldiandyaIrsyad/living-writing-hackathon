// The keyboard cheat sheet: opens with "?" (outside text fields) or the palette command, closes with Esc.

import { Fragment, useEffect, useState } from 'react';
import { SHORTCUT_GROUPS } from './shortcuts';
import './impact.css';

export const OPEN_SHORTCUTS_EVENT = 'lw:shortcuts';

export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      else if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target as HTMLElement)?.closest?.('.cm-editor, input, textarea, select, [contenteditable]')) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener(OPEN_SHORTCUTS_EVENT, show);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, show);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal impact-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" data-testid="shortcuts-dialog">
        <header className="impact-head">
          <h2 className="impact-heading">Keyboard shortcuts</h2>
        </header>
        <div className="keys-body">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="keys-group">{g.title}</h3>
              {g.rows.map((r) => (
                <div key={r.what} className="keys-row">
                  <span className="keys-keys">
                    {r.keys.map((k, i) => (
                      <Fragment key={k}>
                        {i > 0 && <span className="keys-plus">+</span>}
                        <kbd className="tl-kbd">{k}</kbd>
                      </Fragment>
                    ))}
                  </span>
                  <span>{r.what}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
