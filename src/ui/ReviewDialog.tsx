// The review list: scenes the writer meant to look at again, and why. Items only close when the writer closes them.

import { useEffect, useState } from 'react';
import { openReviewItems, setReviewStatus } from '../core/review';
import type { ReviewItem, ReviewStatus } from '../core/types';
import { useStore } from '../store/store';
import './impact.css';

export const OPEN_REVIEW_EVENT = 'lw:review';

/** Top-bar button with the number of open items. Renders nothing when there are none. */
export function ReviewBadge() {
  const count = useStore((s) => openReviewItems(s.vault).length);
  if (count === 0) return null;
  return (
    <button className="btn btn-sm" onClick={() => window.dispatchEvent(new Event(OPEN_REVIEW_EVENT))} title="Scenes you meant to look at again" data-testid="review-badge">
      Review ({count})
    </button>
  );
}

export function ReviewDialog() {
  const [open, setOpen] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const vault = useStore((s) => s.vault);

  useEffect(() => {
    const show = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener(OPEN_REVIEW_EVENT, show);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_REVIEW_EVENT, show);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!open) return null;
  const items = Object.values(vault.reviewItems).sort((a, b) => a.created - b.created);
  const live = items.filter((i) => i.status === 'open');
  const closed = items.length - live.length;
  const shown = showClosed ? items : live;
  const mark = (item: ReviewItem, status: ReviewStatus) => {
    const s = useStore.getState();
    s.commit(setReviewStatus(s.vault, item.id, status), undefined, status === 'open' ? 'Reopen a review item' : 'Close a review item');
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal impact-modal" role="dialog" aria-modal="true" aria-label="Review list" data-testid="review-dialog">
        <header className="impact-head">
          <h2 className="impact-heading">{live.length === 0 ? 'Nothing to review' : `${live.length} scene${live.length === 1 ? '' : 's'} to look at again`}</h2>
          <p className="impact-lead">Nothing here closes by itself, not even when you edit the scene. Mark an item done when you have looked.</p>
        </header>
        <ul className="impact-list">
          {shown.map((item) => {
            const scene = vault.scenes[item.sceneId];
            return (
              <li key={item.id} className="impact-row problem-row" data-testid="review-row" data-status={item.status}>
                <div className="problem-text">
                  <strong>{scene?.title ?? 'A deleted scene'}</strong>
                  <span className="problem-hint">{item.cause}</span>
                </div>
                <div className="problem-actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      useStore.getState().navigate({ kind: 'scene', id: item.sceneId });
                      setOpen(false);
                    }}
                  >
                    Go to scene
                  </button>
                  {item.status === 'open' ? (
                    <>
                      <button className="btn btn-sm" onClick={() => mark(item, 'done')} data-testid="review-done">
                        Done
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => mark(item, 'dismissed')}>
                        Dismiss
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-sm btn-ghost" onClick={() => mark(item, 'open')}>
                      Reopen
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <footer className="impact-foot">
          {closed > 0 && (
            <button className="btn btn-sm btn-ghost" onClick={() => setShowClosed(!showClosed)}>
              {showClosed ? 'Hide closed' : `Show ${closed} closed`}
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
