// The story's flow in the Inspector: where the scene sits in the whole story, the part it plays there, how it feels
// against the scenes before it, and moods that do not fit the wiki. Read on demand (or with each Check, a setting).

import { isStale, readFlow, stopFlow, useFlow, type MoodCheck } from '../../agent/flow';
import { useAgent } from '../../agent/run';
import type { Scene } from '../../core/types';
import { BACKEND } from '../../store/server';

export function FlowSection({ scene, writing }: { scene: Scene; writing: boolean }) {
  const { readings, running, errors, dismiss } = useFlow();
  const enabled = useAgent((a) => a.enabled);
  const checking = useAgent((a) => a.running !== null);
  if (!BACKEND || !enabled) return null;

  const reading = readings[scene.id];
  const error = errors[scene.id];
  const stale = reading && isStale(reading, scene);
  const busy = running !== null || checking;

  return (
    <section className="insp-section flow" data-testid="insp-flow">
      <div className="insp-sec-head">
        <span>Flow</span>
      </div>
      <div className="agent-row">
        <button
          type="button"
          className="btn btn-sm"
          data-testid="flow-read"
          title="Where this scene sits in the story, the part it plays, and how it feels against the scenes before it. It never suggests what to write."
          disabled={busy || !writing || scene.prose.trim() === ''}
          onClick={() => void readFlow(scene.id)}
        >
          {running === scene.id ? 'Reading…' : reading ? 'Read again' : 'Read the flow'}
        </button>
        {running === scene.id && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={stopFlow}>
            Stop
          </button>
        )}
      </div>
      {error && (
        <div className="small agent-error" data-testid="flow-error">
          {error}
        </div>
      )}
      {reading && (
        <div className={`flow-reading small${stale ? ' flow-stale' : ''}`} data-testid="flow-reading">
          {stale && (
            <div className="faint" data-testid="flow-stale">
              Written since; read again.
            </div>
          )}
          <div className="flow-role-line">
            <span className="flow-role" data-testid="flow-role" data-role={reading.role}>
              {reading.role}
            </span>
            {reading.tone && <span className="flow-tone">{reading.tone}</span>}
          </div>
          {reading.position && <div data-testid="flow-position">{reading.position}</div>}
          {reading.thin && <div className="faint">Little of the story is written or planned yet, so its place is a guess.</div>}
          {reading.why && <div className="faint">{reading.why}</div>}
          {reading.shift && <div data-testid="flow-shift">{reading.shift}</div>}
          {reading.moodChecks.map((m: MoodCheck) => (
            <div key={`${m.entity}:${m.sceneQuote}`} className="agent-flag" data-testid="flow-mood">
              <div>
                <b>{m.entity}</b>: {m.note}
              </div>
              {m.state && <div className="faint">State: “{m.state}”</div>}
              {m.sceneQuote && <div className="faint">Scene: “{m.sceneQuote}”</div>}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => dismiss(scene.id, m)}>
                It fits
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
