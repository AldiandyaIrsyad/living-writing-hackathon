// Says where an edit will sit in time, and lets the author switch it to "moves with the scene" after confirming.

import { atLabel } from '../core/anchor';

export function AnchorNote({ at, sceneTitle, attach, onChange }: { at: number; sceneTitle: string; attach: boolean; onChange: (attach: boolean) => void }) {
  return (
    <div className="anchor-note small faint" data-testid="anchor-note" data-attach={attach}>
      {attach ? (
        <>
          Moves with “{sceneTitle}”: if that scene moves in time, this edit moves with it.{' '}
          <button type="button" className="link-btn" data-testid="anchor-pin" onClick={() => onChange(false)}>
            Pin to the timeline
          </button>
        </>
      ) : (
        <>
          On the timeline: takes effect {atLabel(at)}, wherever scenes move.{' '}
          <button
            type="button"
            className="link-btn"
            data-testid="anchor-attach"
            onClick={() => {
              if (window.confirm(`Attach this edit to “${sceneTitle}”?\n\nIf you move that scene in time, the edit moves with it, and the character's states can end up out of order.`)) onChange(true);
            }}
          >
            Attach to the scene instead…
          </button>
        </>
      )}
    </div>
  );
}
