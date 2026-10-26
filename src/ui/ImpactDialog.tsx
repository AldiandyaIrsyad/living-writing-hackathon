// The preview of a retcon: which scenes would see something different if the writer goes ahead.

import { useEffect, useRef } from 'react';
import { describeDifference } from '../store/impact';
import { useStore } from '../store/store';
import './impact.css';

/** Rows shown before the list says "and N more". */
const MAX_ROWS = 40;

export function ImpactDialog() {
  const proposal = useStore((s) => s.proposal);
  const vault = useStore((s) => s.vault);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!proposal) return;
    // Focus the dialog itself, not a button: the Enter that committed the edit is still arriving, and it must not press one.
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useStore.getState().resolveProposal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [proposal]);

  if (!proposal) return null;
  const { impacts } = proposal;
  const sceneCount = new Set(impacts.map((i) => i.sceneId)).size;
  const rows = impacts.slice(0, MAX_ROWS);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && useStore.getState().resolveProposal(false)}>
      <div ref={dialog} tabIndex={-1} className="modal impact-modal" role="dialog" aria-modal="true" aria-labelledby="impact-heading" data-testid="impact-dialog">
        <header className="impact-head">
          <h2 id="impact-heading" className="impact-heading">
            {proposal.label}
          </h2>
          <p className="impact-lead">
            {sceneCount === 1 ? '1 scene sees' : `${sceneCount} scenes see`} something different if you go ahead. They are listed in reading order, with what changes for each.
          </p>
        </header>
        <ul className="impact-list" data-testid="impact-list">
          {rows.map((i) => {
            const scene = proposal.next.scenes[i.sceneId] ?? vault.scenes[i.sceneId];
            const chapter = scene?.chapterId ? proposal.next.chapters[scene.chapterId]?.title ?? vault.chapters[scene.chapterId]?.title : undefined;
            return (
              <li key={`${i.sceneId}:${i.entityId}`} className="impact-row" data-testid="impact-row" data-scene={scene?.title}>
                <div className="impact-where">
                  {chapter && <span className="faint">{chapter} · </span>}
                  <strong>{scene?.title ?? i.sceneId}</strong>
                </div>
                <div className="impact-what">
                  <span className="impact-who">{vault.entities[i.entityId]?.name ?? i.entityId}</span>
                  {i.differences.map((d) => describeDifference(d)).join(' · ')}
                </div>
              </li>
            );
          })}
          {impacts.length > rows.length && <li className="impact-more faint">and {impacts.length - rows.length} more</li>}
        </ul>
        <footer className="impact-foot">
          <button className="btn" onClick={() => useStore.getState().resolveProposal(false)} data-testid="impact-cancel">
            Cancel
          </button>
          <button className="btn" onClick={() => useStore.getState().resolveProposal(true, true)} data-testid="impact-apply-review" title="Go ahead, and add these scenes to your review list so you can come back to them">
            Go ahead and add to review list
          </button>
          <button className="btn btn-primary" onClick={() => useStore.getState().resolveProposal(true)} data-testid="impact-apply">
            Go ahead
          </button>
        </footer>
      </div>
    </div>
  );
}
