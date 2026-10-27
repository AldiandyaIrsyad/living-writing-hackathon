// The story agent's corner of the Inspector: when it reads, what it did to the open scene, and what it left for the
// writer to decide. Everything it wrote can be taken back for this scene in one click; everything it only offered can
// be accepted one line at a time.

import type { CSSProperties } from 'react';
import { createHeldPage, earlierVersionsLacking, editPage, fixNearMiss, propValue, revertAgentOutput, updateFromBeginning, type AgentReport, type Contradiction } from '../../agent/apply';
import type { PageEdit } from '../../agent/page';
import { enqueueScene, IDLE_CHOICES, isContributor, readChapter, readSceneNow, stopReading, tookBack, useAgent, type Effort, type LinkNames, type Trigger } from '../../agent/run';
import { isUntitled, linkName, type SceneTitles } from '../../agent/context';
import { findEntity, linkFirstMention } from '../../core/links';
import type { Id, Scene, Vault } from '../../core/types';
import { slugify } from '../../core/types';
import { addChange, setMomentConcrete, setMomentLabel, setMomentTimeSkip, sortedTypes, updateEntity } from '../../store/actions';
import { BACKEND } from '../../store/server';
import { flushEditors, useStore, useVault } from '../../store/store';
import { setDismissed, useDismissed } from '../dismissed';
import { openNextScene } from '../stories';

const TRIGGERS: { value: Trigger; label: string }[] = [
  { value: 'off', label: 'Only when I ask' },
  { value: 'leave', label: 'When I leave a scene' },
  { value: 'idle', label: 'After I stop typing' },
];

const EFFORT_LABELS: { value: Effort; label: string }[] = [
  { value: 'low', label: 'Low (fastest)' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High (slowest)' },
  { value: 'default', label: 'Model default' },
];

function EditLine({ edit }: { edit: PageEdit }) {
  if (edit.kind === 'add')
    return (
      <li>
        + {edit.text}
        {edit.under ? <span className="faint"> (under {edit.under})</span> : null}
      </li>
    );
  if (edit.kind === 'remove') return <li className="agent-del">{edit.old}</li>;
  return (
    <li>
      <span className="agent-del">{edit.old}</span> → {edit.text}
    </li>
  );
}

const commit = (next: Vault, label: string) => useStore.getState().commit(next, undefined, label);

export function AgentSection({ scene, writing }: { scene: Scene; writing: boolean }) {
  const vault = useVault();
  const { trigger, setTrigger, idleSeconds, setIdleSeconds, enabled, provider, models, model, setModel, allowOverwrite, setAllowOverwrite, effort, setEffort, linkNames, setLinkNames, sceneTitles, setSceneTitles, settingsOpen, setSettingsOpen, running, waiting, progress, errors, reports, setReport } = useAgent();
  const error = errors[scene.id];
  const dismissed = useDismissed();
  if (!BACKEND) return null;

  const report = reports[scene.id];
  const mine = Object.values(vault.changes).filter((c) => c.agent && c.sceneId === scene.id).length;
  const busy = running !== null;
  const chapterSize = scene.chapterId ? Object.values(vault.scenes).filter((s) => s.chapterId === scene.chapterId && s.prose.trim()).length : 0;
  const patch = (p: Partial<AgentReport>) => report && setReport(scene.id, { ...report, ...p });
  /** The writer accepts edits the agent only offered: they are made as the writer's own. */
  const accept = (entityId: Id, edits: PageEdit[]) => commit(editPage(useStore.getState().vault, scene.id, entityId, edits, 'writer', 'Accepted from the story agent').vault, 'Accept agent edit');
  // By the wiki line it contradicts, which is quoted verbatim, not the claim, which the model words afresh on every
  // reading (nor the scene quote, whose extent varies): "Intentional" has to survive a re-read.
  const contradictionKey = (c: Contradiction) => `agent:${scene.id}:${slugify(c.entity)}:${slugify(c.wikiQuote)}`;

  return (
    <section className="insp-section agent" data-testid="insp-agent">
      <div className="insp-sec-head">
        <span>Story agent</span>
        {provider && <span className="agent-provider">via {provider}</span>}
      </div>

      {model && isContributor(model) && (
        <div className="small agent-error" data-testid="agent-contributor-warning">
          Contributor mode: Meta may use what the agent sends (your scenes and wiki pages) to train its models.
        </div>
      )}

      {enabled === false ? (
        <div className="small faint">The server has no model key. Put META_API_KEY (Meta) or GEMINI_API_KEY in .env.local and restart it (`npm run dev:gemini` for Gemini).</div>
      ) : (
        <div className="agent-row">
          <button type="button" className="btn btn-sm" data-testid="agent-read" title="The agent reads this scene and keeps the wiki true to it." disabled={busy || !writing || scene.prose.trim() === ''} onClick={() => readSceneNow(scene.id)}>
            {running === scene.id ? 'Checking…' : 'Check'}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" data-testid="agent-next" title="Go to the next scene, or start a new one after the last." onClick={() => openNextScene(scene.id)}>
            Next →
          </button>
          {!busy && chapterSize > 1 && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              data-testid="agent-read-chapter"
              title="Read each scene of this chapter in order, skipping those read since the page loaded and not changed since."
              onClick={() => readChapter(scene.chapterId!)}
            >
              Read the chapter
            </button>
          )}
          {busy && (
            <button type="button" className="btn btn-sm btn-ghost" data-testid="agent-stop" onClick={stopReading}>
              Stop{waiting > 1 ? ` (${waiting} scenes)` : ''}
            </button>
          )}
          {mine + (report?.linked?.length ?? 0) > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              title="Remove everything the agent wrote for this scene, also where it reached later versions of a page, and the links it added to the scene. Your own edits stay."
              onClick={() => {
                flushEditors();
                commit(revertAgentOutput(useStore.getState().vault, scene.id, report?.linked), 'Agent output for a scene');
                tookBack(scene.id);
                setReport(scene.id, null);
              }}
            >
              Take back {mine + (report?.linked?.length ?? 0)} change{mine + (report?.linked?.length ?? 0) === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}
      {Object.keys(errors).some((id) => id !== scene.id && vault.scenes[id]) && (
        <div className="small agent-error" data-testid="agent-other-errors">
          Could not read:{' '}
          {Object.keys(errors)
            .filter((id) => id !== scene.id && vault.scenes[id])
            .map((id, i) => (
              <span key={id}>
                {i > 0 && ', '}
                <button type="button" className="btn btn-sm btn-ghost" title={errors[id]} onClick={() => useStore.getState().navigate({ kind: 'scene', id })}>
                  {vault.scenes[id].title || 'Untitled scene'}
                </button>
              </span>
            ))}
        </div>
      )}
      {running && running !== scene.id && (
        <div className="small faint" data-testid="agent-busy">
          Reading “{vault.scenes[running]?.title || 'another scene'}” first.
        </div>
      )}
      {running === scene.id && progress && (
        <div className="small faint" data-testid="agent-progress">
          {progress}
        </div>
      )}
      {scene.status === 'idea' && <div className="small faint">Marked as an idea: the agent reads it only when you ask.</div>}
      {error && (
        <div className="small agent-error" data-testid="agent-error">
          {error}{' '}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => enqueueScene(scene.id)}>
            Try again
          </button>
        </div>
      )}

      {report && (
        <div className="agent-report small" data-testid="agent-report">
          {Object.values({ ...report, contradictions: report.contradictions.filter((c) => !dismissed.has(contradictionKey(c))) }).every((v) =>
            Array.isArray(v) ? v.length === 0 : v === undefined || v === false,
          ) && (
            <div className="faint">Read it: nothing new to file.</div>
          )}
          {report.created.map((c, n) =>
            vault.entities[c.id] ? (
              <div key={c.id} className="agent-row agent-filed" style={{ '--i': n } as CSSProperties}>
                <span>
                  New page: <b>{vault.entities[c.id].name}</b>
                </span>
                <select
                  aria-label={`Type of ${c.name}`}
                  data-testid="agent-created-type"
                  value={vault.entities[c.id].typeId}
                  onChange={(e) => commit(updateEntity(useStore.getState().vault, c.id, { typeId: e.target.value }), 'Change type')}
                >
                  {sortedTypes(vault).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null,
          )}

          {(report.removed ?? []).map((name) => (
            <div key={name} className="faint" data-testid="agent-removed">
              Removed the page <b>{name}</b>: nothing links to it any more.
            </div>
          ))}
          {(report.nearMisses ?? []).map((m, i) => (
            <div key={m.link} className="agent-flag" data-testid="agent-near-miss">
              <div>
                [[{m.link}]] has no page. Did you mean <b>{vault.entities[m.entityId]?.name ?? m.name}</b>?
              </div>
              <div className="agent-row">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    flushEditors();
                    commit(fixNearMiss(useStore.getState().vault, scene.id, m), 'Fix a link');
                    patch({ nearMisses: report.nearMisses!.filter((_, k) => k !== i) });
                    // What the agent read about the typo belongs to the page that was meant: read the scene again.
                    if (enabled) readSceneNow(scene.id);
                  }}
                >
                  Fix the link
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    commit(createHeldPage(useStore.getState().vault, scene.id, m), 'New page');
                    patch({ nearMisses: report.nearMisses!.filter((_, k) => k !== i) });
                  }}
                >
                  It’s someone new
                </button>
              </div>
            </div>
          ))}

          {report.pages.map((p, n) => {
            const id = findEntity(vault, p.entity)?.id;
            const lacking = id ? earlierVersionsLacking(vault, scene.id, id, p.edits) : 0;
            return (
              <div key={p.entity} className="agent-filed" style={{ '--i': report.created.length + n } as CSSProperties}>
                <b>{p.entity}</b>
                <ul>
                  {p.edits.map((e, i) => (
                    <EditLine key={i} edit={e} />
                  ))}
                </ul>
                {id && lacking > 0 && (
                  <div className="agent-row" data-testid="agent-from-beginning">
                    <span className="faint">
                      {lacking === 1 ? 'An earlier version of the page lacks' : `${lacking} earlier versions of the page lack`} this.
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      title="Write these edits into every version of the page before this scene too, back to the first. Take back removes them again."
                      onClick={() => commit(updateFromBeginning(useStore.getState().vault, scene.id, id, p.edits), 'Update a page from the beginning')}
                    >
                      Update from the beginning
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {report.properties.map((p) => (
            <div key={`${p.entity}:${p.property}`}>
              <b>{p.entity}</b> {p.property} → {p.value}
            </div>
          ))}
          {report.states.map((s) => (
            <div key={s.entity}>
              <b>{s.entity}</b> <span className="faint">now:</span> {s.state}
            </div>
          ))}

          {report.suggestions.map((s, i) => (
            <div key={i} className="agent-flag" data-testid="agent-suggestion">
              <div>
                <b>{s.entity}</b>, a line you wrote:
              </div>
              <ul>
                <EditLine edit={s.edit} />
              </ul>
              <div className="agent-row">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    accept(s.entityId, [s.edit]);
                    patch({ suggestions: report.suggestions.filter((_, k) => k !== i) });
                  }}
                >
                  Apply
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => patch({ suggestions: report.suggestions.filter((_, k) => k !== i) })}>
                  Keep mine
                </button>
              </div>
            </div>
          ))}
          {(report.propertySuggestions ?? []).map((p, i) => (
            <div key={`${p.entity}:${p.property}`} className="agent-flag" data-testid="agent-property-suggestion">
              <div>
                <b>{p.entity}</b>, a value you set: {p.property} → {p.value}
              </div>
              <div className="agent-row">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    commit(addChange(useStore.getState().vault, { sceneId: scene.id, entityId: p.entityId, op: 'set', property: p.property, value: propValue(p.value) }).vault, 'Accept agent property');
                    patch({ propertySuggestions: report.propertySuggestions.filter((_, k) => k !== i) });
                  }}
                >
                  Apply
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => patch({ propertySuggestions: report.propertySuggestions.filter((_, k) => k !== i) })}>
                  Keep mine
                </button>
              </div>
            </div>
          ))}
          {report.claimed.map((c, i) => (
            <div key={i} className="faint">
              Only claimed, not written — <b>{c.entity}</b>
              <ul>
                {c.edits.map((e, k) => (
                  <EditLine key={k} edit={e} />
                ))}
              </ul>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  const id = Object.values(vault.entities).find((e) => e.name === c.entity)?.id;
                  if (id) accept(id, c.edits);
                  patch({ claimed: report.claimed.filter((_, k) => k !== i) });
                }}
              >
                It’s true, write it
              </button>
            </div>
          ))}

          {report.contradictions
            .filter((c) => !dismissed.has(contradictionKey(c)))
            .map((c) => (
              <div key={c.claim} className="agent-flag" data-testid="agent-contradiction">
                <div>
                  <b>{c.entity}</b>: {c.claim}
                </div>
                <div className="faint">Scene: “{c.sceneQuote}”</div>
                <div className="faint">Wiki: “{c.wikiQuote}”</div>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDismissed(contradictionKey(c), true)}>
                  Intentional
                </button>
              </div>
            ))}

          {report.title &&
            (report.titleSet ? (
              <div className="agent-row" data-testid="agent-title">
                <span>Titled the scene “{report.title}”</span>
              </div>
            ) : (
              isUntitled(scene.title) && (
                <div className="agent-flag" data-testid="agent-title">
                  Title: “{report.title}”
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      const now = useStore.getState().vault;
                      commit({ ...now, scenes: { ...now.scenes, [scene.id]: { ...now.scenes[scene.id], title: report.title! } } }, 'Agent title');
                      patch({ title: undefined });
                    }}
                  >
                    Use it
                  </button>
                </div>
              )
            ))}
          {report.timeLabel &&
            (report.timeLabelSet ? (
              <div className="agent-row" data-testid="agent-time-label">
                <span>Time label: “{report.timeLabel}”</span>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    commit(setMomentLabel(useStore.getState().vault, scene.momentId, ''), 'Clear time label');
                    patch({ timeLabel: undefined, timeLabelSet: undefined });
                  }}
                >
                  Clear
                </button>
              </div>
            ) : (
              <div className="agent-flag" data-testid="agent-time-label">
                Time label: “{report.timeLabel}”
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    commit(setMomentLabel(useStore.getState().vault, scene.momentId, report.timeLabel!), 'Agent time label');
                    patch({ timeLabel: undefined });
                  }}
                >
                  Use it
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
                  commit(setMomentTimeSkip(useStore.getState().vault, scene.momentId, report.timeSkip!), 'Agent time skip');
                  patch({ timeSkip: undefined });
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
                  if (r.ok) commit(r.vault, 'Agent date');
                  else s.toast('error', r.error);
                  patch({ concrete: undefined });
                }}
              >
                Apply
              </button>
            </div>
          )}
          {report.unlinkedNames.filter((n) => linkFirstMention(scene.prose, n.name)).length > 1 && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              data-testid="agent-link-all"
              title="Link each name where it first appears, then read the scene again so they get pages: one reading for all of them."
              onClick={() => {
                flushEditors();
                const now = useStore.getState().vault;
                const prose = report.unlinkedNames.reduce((p, n) => linkName(now, p, n.name) ?? p, now.scenes[scene.id].prose);
                commit({ ...now, scenes: { ...now.scenes, [scene.id]: { ...now.scenes[scene.id], prose } } }, 'Link names');
                patch({ unlinkedNames: [] });
                if (enabled) readSceneNow(scene.id);
              }}
            >
              Link all and read again
            </button>
          )}
          {report.unlinkedNames.map((n) => {
            const linked = linkFirstMention(scene.prose, n.name);
            return (
              <div key={n.name} className="faint" data-testid="agent-unlinked">
                Not linked: <b>{n.name}</b> — {n.reason}{' '}
                {linked && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    title="Link its first mention in the scene; the next reading gives it a page."
                    onClick={() => {
                      flushEditors();
                      const now = useStore.getState().vault;
                      const prose = linkName(now, now.scenes[scene.id].prose, n.name);
                      if (prose) commit({ ...now, scenes: { ...now.scenes, [scene.id]: { ...now.scenes[scene.id], prose } } }, 'Link a name');
                      patch({ unlinkedNames: report.unlinkedNames.filter((u) => u.name !== n.name) });
                    }}
                  >
                    Link it
                  </button>
                )}
              </div>
            );
          })}
          {report.skipped.map((s) => (
            <div key={s} className="faint">
              {s}
            </div>
          ))}
        </div>
      )}
      <details className="agent-settings small" open={settingsOpen} onToggle={(e) => setSettingsOpen(e.currentTarget.open)} data-testid="agent-settings">
        <summary className="faint">Settings</summary>
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
        {trigger === 'idle' && (
          <label className="agent-row small">
            <span className="faint">Wait</span>
            <select value={idleSeconds} onChange={(e) => setIdleSeconds(Number(e.target.value))} aria-label="How long to wait after I stop typing" data-testid="agent-idle">
              {IDLE_CHOICES.map((s) => (
                <option key={s} value={s}>
                  {s < 60 ? `${s} seconds` : s === 60 ? '1 minute' : `${s / 60} minutes`}
                </option>
              ))}
            </select>
          </label>
        )}
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
        {provider === 'Google Gemini' && (
          <div className="small faint" data-testid="agent-gemini-note">
            Gemini is a stand-in for Meta’s models. On Google’s free tier, what is sent may be used to improve Google’s products.
          </div>
        )}
        {effort && (
          <label className="agent-row small" title="Longer thinking catches more, but a reading takes longer. Not every model takes this setting: if yours complains, pick “Model default”.">
            <span className="faint">Thinking</span>
            <select value={effort} onChange={(e) => setEffort(e.target.value as Effort)} aria-label="How long the model thinks" data-testid="agent-effort">
              {EFFORT_LABELS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="agent-row small" title="Names you wrote without [[ ]]: listed for you to link, or linked where they first appear and given a page.">
          <span className="faint">Names I didn’t link</span>
          <select value={linkNames} onChange={(e) => setLinkNames(e.target.value as LinkNames)} aria-label="What happens to names you did not link" data-testid="agent-link-names">
            <option value="list">List them</option>
            <option value="link">Link and file them</option>
          </select>
        </label>
        <label className="agent-row small" title="A scene still called “Untitled scene” or “New scene”. A title you gave is never changed.">
          <span className="faint">Untitled scenes</span>
          <select value={sceneTitles} onChange={(e) => setSceneTitles(e.target.value as SceneTitles)} aria-label="What the agent does about untitled scenes" data-testid="agent-titles">
            <option value="leave">Leave them</option>
            <option value="suggest">Suggest a title</option>
            <option value="set">Title them</option>
          </select>
        </label>
        <label className="agent-row small" title="Off: the agent changes only what it wrote itself (page lines, property values), and offers changes to yours instead.">
          <input type="checkbox" checked={allowOverwrite} onChange={(e) => setAllowOverwrite(e.target.checked)} data-testid="agent-overwrite" />
          <span>Allow overwriting what I wrote in the wiki</span>
        </label>
      </details>
    </section>
  );
}
