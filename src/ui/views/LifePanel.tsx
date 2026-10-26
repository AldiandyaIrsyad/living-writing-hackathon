// An entity's life as a document: each scene it is in, in story order, with what changed there.

import { useMemo, useState } from 'react';
import { entityLife } from '../../store/life';
import { getResolver, useStore, useVault } from '../../store/store';

export function LifePanel({ entityId }: { entityId: string }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const [showQuiet, setShowQuiet] = useState(false);
  const life = useMemo(() => entityLife(vault, getResolver(vault), entityId), [vault, entityId]);
  if (life.length === 0) return null;
  const steps = showQuiet ? life : life.filter((s) => !s.quiet);
  const quiet = life.length - life.filter((s) => !s.quiet).length;

  return (
    <section className="panel" data-testid="life-panel">
      <div className="panel-head">
        Life
        <span className="grow" />
        {quiet > 0 && (
          <label className="faint small">
            <input type="checkbox" checked={showQuiet} onChange={(e) => setShowQuiet(e.target.checked)} data-testid="life-quiet" /> Scenes where nothing changes ({quiet})
          </label>
        )}
      </div>
      <ol className="panel-body life-list">
        {steps.length === 0 && <li className="faint small">Present in {life.length} scene{life.length === 1 ? '' : 's'}; nothing about it changes.</li>}
        {steps.map((s) => (
          <li key={s.sceneId} data-testid="life-step">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => navigate({ kind: 'scene', id: s.sceneId })}>
              {s.chapterTitle ? `${s.chapterTitle} · ` : ''}
              {s.sceneTitle}
            </button>
            <span className="small">
              {s.existence === 'begins' && ' comes into existence. '}
              {s.existence === 'ends' && ' stops existing. '}
              {s.renamedTo !== undefined && ` is now called ${s.renamedTo}. `}
              {s.pageRevised && ' page revised. '}
              {s.props.map((p) => (
                <span key={p.name} className="life-change" data-testid="life-change">
                  {' '}
                  {p.name}: {p.before} → {p.after}.
                </span>
              ))}
              {s.quiet && <span className="faint"> is there.</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
