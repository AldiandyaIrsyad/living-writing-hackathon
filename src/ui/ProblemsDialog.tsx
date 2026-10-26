// The Problems list: continuity things worth a look. Computed when opened (never while typing), dismissals kept per browser.

import { useEffect, useMemo, useState } from 'react';
import { findProblems } from '../store/problems';
import { useStore } from '../store/store';
import { setDismissed, useDismissed } from './dismissed';
import './impact.css';

export const OPEN_PROBLEMS_EVENT = 'lw:problems';

export function ProblemsDialog() {
  const [open, setOpen] = useState(false);
  const dismissed = useDismissed();
  const [showDismissed, setShowDismissed] = useState(false);
  const vault = useStore((s) => s.vault);

  useEffect(() => {
    const show = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener(OPEN_PROBLEMS_EVENT, show);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_PROBLEMS_EVENT, show);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Only while the dialog is open: the vault it checks is the one on screen when it opened or last changed.
  const problems = useMemo(() => (open ? findProblems(vault) : []), [open, vault]);
  if (!open) return null;

  const live = problems.filter((p) => !dismissed.has(p.id));
  const hidden = problems.length - live.length;
  const shown = showDismissed ? problems : live;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal impact-modal" role="dialog" aria-modal="true" aria-label="Problems" data-testid="problems-dialog">
        <header className="impact-head">
          <h2 className="impact-heading">{live.length === 0 ? 'No problems found' : `${live.length} thing${live.length === 1 ? '' : 's'} worth a look`}</h2>
          <p className="impact-lead">
            These are suggestions, never errors: a story may do any of this on purpose. Reading order against story time is not checked, so flashbacks are fine.
          </p>
        </header>
        <ul className="impact-list">
          {shown.map((p) => (
            <li key={p.id} className="impact-row problem-row" data-testid="problem-row" data-rule={p.rule}>
              <div className="problem-text">
                <span>{p.message}</span>
                {p.hint && <span className="problem-hint">{p.hint}</span>}
              </div>
              <div className="problem-actions">
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    useStore.getState().navigate({ kind: 'scene', id: p.sceneId });
                    setOpen(false);
                  }}
                >
                  Go to scene
                </button>
                {dismissed.has(p.id) ? (
                  <button className="btn btn-sm btn-ghost" onClick={() => setDismissed(p.id, false)}>
                    Restore
                  </button>
                ) : (
                  <button className="btn btn-sm btn-ghost" onClick={() => setDismissed(p.id, true)} data-testid="problem-dismiss">
                    Dismiss
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <footer className="impact-foot">
          {hidden > 0 && (
            <button className="btn btn-sm btn-ghost" onClick={() => setShowDismissed(!showDismissed)}>
              {showDismissed ? 'Hide dismissed' : `Show ${hidden} dismissed`}
            </button>
          )}
          <span className="grow" />
          <button className="btn btn-sm" onClick={() => setOpen(false)}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Top-bar button with the number of problems not dismissed, worked out a moment after the writer stops editing. */
export function ProblemsBadge() {
  const vault = useStore((s) => s.vault);
  const dismissed = useDismissed();
  const [problems, setProblems] = useState<ReturnType<typeof findProblems>>([]);
  useEffect(() => {
    const id = setTimeout(() => setProblems(findProblems(vault)), 1500);
    return () => clearTimeout(id);
  }, [vault]);
  const count = problems.filter((p) => !dismissed.has(p.id)).length;
  if (count === 0) return null;
  return (
    <button className="btn btn-sm" onClick={() => window.dispatchEvent(new Event(OPEN_PROBLEMS_EVENT))} title="Continuity things worth a look" data-testid="problems-badge">
      Problems ({count})
    </button>
  );
}
