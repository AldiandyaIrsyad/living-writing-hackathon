// The story agent's corner of the Inspector: when it reads, what it did to the open scene, and what it wants the
// writer to decide. Everything it wrote can be taken back for this scene in one click.

import { revertAgentOutput } from '../../agent/apply';
import { enqueueScene, forgetReport, isContributor, readSceneNow, useAgent, type Trigger } from '../../agent/run';
import type { Scene } from '../../core/types';
import { slugify } from '../../core/types';
import { setMomentConcrete, setMomentTimeSkip } from '../../store/actions';
import { BACKEND } from '../../store/server';
import { useStore, useVault } from '../../store/store';
import { setDismissed, useDismissed } from '../dismissed';

const TRIGGERS: { value: Trigger; label: string }[] = [
  { value: 'off', label: 'Only when I ask' },
  { value: 'leave', label: 'When I leave a scene' },
  { value: 'idle', label: 'After I stop typing' },
];

export function AgentSection({ scene, writing }: { scene: Scene; writing: boolean }) {
  const vault = useVault();
  const { trigger, setTrigger, enabled, models, model, setModel, running, error, reports } = useAgent();
  const dismissed = useDismissed();
  if (!BACKEND) return null;

  const report = reports[scene.id];
  const mine = Object.values(vault.changes).filter((c) => c.agent && c.sceneId === scene.id).length;
  const busy = running !== null;
  const forget = (patch: Partial<NonNullable<typeof report>>) => useAgent.setState((a) => ({ reports: { ...a.reports, [scene.id]: { ...a.reports[scene.id], ...patch } } }));

  return (
    <section className="insp-section agent" data-testid="insp-agent">
      <div className="insp-sec-head">
        <span>Story agent</span>
      </div>

      <label className="agent-row small">
        <span className="faint">Reads</span>
        <select value={trigger} onChange={(e) => setTrigger(e.target.value as Trigger)} aria-label="When the agent reads">
          {TRIGGERS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      {models.length > 0 && (
        <label className="agent-row small">
          <span className="faint">Model</span>
          <select value={model ?? ''} onChange={(e) => setModel(e.target.value)} aria-label="Model the agent uses" data-testid="agent-model">
            {models.map((m) => (
              <option key={m} value={m}>
                {isContributor(m) ? `${m} (cheaper, may train Meta models)` : m}
              </option>
            ))}
          </select>
        </label>
      )}
      {model && isContributor(model) && (
        <div className="small agent-error" data-testid="agent-contributor-warning">
          Contributor mode: Meta may use what the agent sends (your scenes and wiki pages) to train its models.
        </div>
      )}

      {enabled === false ? (
        <div className="small faint">The server has no model key. Set MODEL_API_KEY and restart it.</div>
      ) : (
        <div className="agent-row">
          <button type="button" className="btn btn-sm" data-testid="agent-read" disabled={busy || !writing || scene.prose.trim() === ''} onClick={() => readSceneNow(scene.id)}>
            {running === scene.id ? 'Reading…' : 'Read this scene'}
          </button>
          {mine > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              title="Remove everything the agent wrote for this scene. Your own edits stay."
              onClick={() => {
                const s = useStore.getState();
                s.commit(revertAgentOutput(s.vault, scene.id), undefined, 'Agent output for a scene');
                forgetReport(scene.id);
              }}
            >
              Take back {mine} change{mine === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}
      {error && <div className="small agent-error" data-testid="agent-error">{error} <button type="button" className="btn btn-sm btn-ghost" onClick={() => enqueueScene(scene.id)}>Try again</button></div>}

      {report && (
        <div className="agent-report small" data-testid="agent-report">
          {report.created.length > 0 && <div>New pages: {report.created.join(', ')}</div>}
          {report.pages.map((p) => (
            <div key={p.entity}>
              <b>{p.entity}</b>
              <ul>
                {p.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          ))}
          {report.states.map((s) => (
            <div key={s.entity}>
              <b>{s.entity}</b> <span className="faint">now:</span> {s.state}
            </div>
          ))}
          {report.claimed.map((c) => (
            <div key={c.entity} className="faint">
              Only claimed, not written — <b>{c.entity}</b>: {c.lines.join('; ')}
            </div>
          ))}

          {report.contradictions
            .filter((c) => !dismissed.has(`agent:${scene.id}:${slugify(c.entity)}:${slugify(c.claim)}`))
            .map((c) => (
              <div key={c.claim} className="agent-flag" data-testid="agent-contradiction">
                <div>
                  <b>{c.entity}</b>: {c.claim}
                </div>
                <div className="faint">Scene: “{c.sceneQuote}”</div>
                <div className="faint">Wiki: “{c.wikiQuote}”</div>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDismissed(`agent:${scene.id}:${slugify(c.entity)}:${slugify(c.claim)}`, true)}>
                  Intentional
                </button>
              </div>
            ))}

          {report.timeSkip && (
            <div className="agent-flag">
              Time skip before this scene: “{report.timeSkip}”
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  const s = useStore.getState();
                  s.commit(setMomentTimeSkip(s.vault, scene.momentId, report.timeSkip!), undefined, 'Agent time skip');
                  forget({ timeSkip: undefined });
                }}
              >
                Apply
              </button>
            </div>
          )}
          {report.concrete && (
            <div className="agent-flag">
              Date: “{report.concrete}”
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  const s = useStore.getState();
                  const r = setMomentConcrete(s.vault, scene.momentId, report.concrete!);
                  if (r.ok) s.commit(r.vault, undefined, 'Agent date');
                  else s.toast('error', r.error);
                  forget({ concrete: undefined });
                }}
              >
                Apply
              </button>
            </div>
          )}
          {report.unlinkedNames.map((n) => (
            <div key={n.name} className="faint">
              Not linked: <b>{n.name}</b> — {n.reason}
            </div>
          ))}
          {report.skipped.map((s) => (
            <div key={s} className="faint">
              {s}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
