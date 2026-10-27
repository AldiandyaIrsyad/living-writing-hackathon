import { useEffect, useMemo, useRef, useState } from 'react';
import { atLabel, changeWhere, sameAnchor } from '../../core/anchor';
import { diffLines, diffStats, type DiffLine } from '../../core/diff';
import { findEntity, parseLinks } from '../../core/links';
import { applyPropagation, planPropagation, type PropagationPlan, type VersionPlan } from '../../core/pagePropagate';
import { formatValue, type HistoryEntry, type ResolvedEntity, type Resolver } from '../../core/resolve';
import type { Entity, Id, Scene, StateChange, TimePoint, Vault } from '../../core/types';
import { commitRevision, deleteEntity, renameEntityEverywhere, sortedTypes, updateEntity } from '../../store/actions';
import { getResolver, update, useStore, useVault } from '../../store/store';
import { AffiliationsPanel, MembersPanel } from '../affiliations/Affiliations';
import { RelationsPanel } from '../relations/Relations';
import { AnchorNote } from '../AnchorNote';
import { Editor, type InsertTextDetail } from '../editor/Editor';
import { PropLines } from '../EntityState';
import { chronologicalScenes, describeTime, playheadContext } from '../follow';
import { entityKeyframes, stepKeyframe } from '../timeline/model';
import { pickImageFile } from '../imageUpload';
import { Markdown } from '../Markdown';
import { PropsEditor } from '../props';
import { LifePanel } from './LifePanel';
import { PresencePanel } from './PresencePanel';
import { QueryResults } from './QueryResults';
import { IdeaQueueSection } from '../CaptureBox';
import './entity.css';

type TimeSel = { kind: 'start' } | { kind: 'latest' } | { kind: 'after'; sceneId: Id } | { kind: 'at'; tp: TimePoint };

/** An open page draft: the page as it will read from a point in time on, before it is committed. */
interface Draft {
  /** The scene the page is revised from (the time it stands for, and what it attaches to); null edits the base page, which reads that way until the first revision. */
  sceneId: Id | null;
  /** The timeline column the revision takes effect from. */
  at: number;
  /** Attached to the scene (moves with it) instead of sitting on the timeline at `at`. */
  attach: boolean;
  note: string;
  /** The page as the draft started, to tell which lines were added. */
  from: string;
  name: string;
  message: string;
}

/** The lines a draft adds to earlier versions, offered to later ones before committing. */
interface Proposal {
  plan: PropagationPlan;
  /** Versions ticked to receive the new lines. */
  checked: Id[];
}

/** The newest commit with a message among the changes applied at the selected time, if any. */
function lastCommit(vault: Vault, state: ResolvedEntity): { message: string; sceneTitle: string } | undefined {
  for (let i = state.applied.length - 1; i >= 0; i--) {
    const c = state.applied[i];
    if (c.message) return { message: c.message, sceneTitle: changeWhere(vault, c) };
  }
  return undefined;
}

function selToValue(sel: TimeSel): string {
  if (sel.kind === 'after') return `after:${sel.sceneId}`;
  if (sel.kind === 'at') return 'custom';
  return sel.kind;
}

function fromTimePoint(tp: TimePoint | undefined): TimeSel {
  if (!tp || tp.kind === 'latest') return { kind: 'latest' };
  if (tp.kind === 'position') return { kind: 'at', tp };
  if (tp.includeSceneId) return { kind: 'after', sceneId: tp.includeSceneId };
  return { kind: 'at', tp };
}

/** The time point a selection stands for. "Start" is the position before any scene. */
function timeOf(r: Resolver, sel: TimeSel): TimePoint {
  if (sel.kind === 'start') return { kind: 'position', x: 0 };
  if (sel.kind === 'latest') return { kind: 'latest' };
  if (sel.kind === 'after') return r.atScene(sel.sceneId, true);
  return sel.tp;
}

/** The entity as of the selected time (start = its base properties, page and name). */
function stateAt(r: Resolver, entity: Entity, sel: TimeSel): ResolvedEntity {
  if (sel.kind !== 'start') return r.entityAt(entity.id, timeOf(r, sel));
  const all = r.changesFor(entity.id);
  const props = Object.fromEntries(Object.entries(entity.props).map(([k, v]) => [k, { value: v, sceneId: null, changeId: null }]));
  return { entityId: entity.id, exists: !all.some((c) => c.op === 'create'), props, applied: [], unordered: [], note: entity.note, name: entity.name, revision: null };
}

/**
 * The scene a page revision made from this selection is committed at: the chosen "after" scene,
 * the scene under the playhead, or the last scene in the timeline for "latest". None at start.
 */
function reviseSceneOf(vault: Vault, scenes: Scene[], sel: TimeSel): Scene | undefined {
  if (sel.kind === 'start') return undefined;
  if (sel.kind === 'latest') return scenes[scenes.length - 1];
  if (sel.kind === 'after') return vault.scenes[sel.sceneId];
  const tp = sel.tp;
  if (tp.kind === 'position') return playheadContext(vault, tp.x)?.scene;
  if (tp.kind === 'moment') return tp.includeSceneId ? vault.scenes[tp.includeSceneId] : scenes.find((s) => s.momentId === tp.momentId);
  return undefined;
}

/**
 * A draft starting from the page as it reads at `tp`, committed from timeline column `at` (`sceneId` is the scene it
 * is being written in). Editing a revision that is attached to the scene keeps it attached.
 */
function draftAt(vault: Vault, entityId: Id, tp: TimePoint, sceneId: Id, at: number): Draft {
  const r = getResolver(vault);
  const st = r.entityAt(entityId, tp);
  const revisions = r.changesFor(entityId).filter((c) => c.op === 'revise');
  const onTimeline = revisions.find((c) => sameAnchor(c, { at }));
  const attached = onTimeline ? undefined : revisions.find((c) => sameAnchor(c, { sceneId }));
  const existing = onTimeline ?? attached;
  return { sceneId, at, attach: !!attached, note: st.note, from: st.note, name: st.name, message: existing?.message ?? '' };
}

function baseDraft(entity: Entity): Draft {
  return { sceneId: null, at: 0, attach: false, note: entity.note, from: entity.note, name: entity.name, message: '' };
}

export function EntityView({ id, at }: { id: Id; at?: TimePoint }) {
  const entity = useStore((s) => s.vault.entities[id]);
  if (!entity) return <div className="empty">This entity no longer exists.</div>;
  return <EntityPage key={id + JSON.stringify(at ?? null)} entity={entity} at={at} />;
}

function EntityPage({ entity, at }: { entity: Entity; at?: TimePoint }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const pending = useStore((s) => s.pendingRevise);
  const [own, setOwn] = useState<TimeSel>(fromTimePoint(at));
  const playhead = useStore((s) => s.playhead);
  const setPlayhead = useStore((s) => s.setPlayhead);
  const stateTime = useStore((s) => s.stateTime);
  const onTimeline = useStore((s) => s.castTracks.includes(entity.id));
  const toggleCastTrack = useStore((s) => s.toggleCastTrack);
  // Opened at a given time ("state after this scene"), the page keeps it until the playhead moves.
  const [openedAt] = useState(playhead);
  const following = stateTime === 'timeline' && (at === undefined || playhead !== openedAt);
  const sel: TimeSel = following ? (playhead === 0 ? { kind: 'start' } : { kind: 'at', tp: { kind: 'position', x: playhead } }) : own;
  const [preview, setPreview] = useState(true);
  const [sources, setSources] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [consumed, setConsumed] = useState<typeof pending>(null);
  const r = getResolver(vault);
  const scenes = chronologicalScenes(vault);
  const type = vault.entityTypes[entity.typeId];

  // The Cast's "Update page…": open straight into the draft after that scene.
  if (pending && pending !== consumed && pending.entityId === entity.id) {
    setConsumed(pending);
    setOwn({ kind: 'after', sceneId: pending.sceneId });
    setDraft(draftAt(vault, entity.id, r.atScene(pending.sceneId, true), pending.sceneId, r.clipEnd(pending.sceneId)));
  }
  useEffect(() => {
    if (!pending || pending.entityId !== entity.id) return;
    const st = useStore.getState();
    st.clearPendingRevise();
    // Following the timeline, the draft's time is the playhead's.
    if (st.stateTime === 'timeline') st.setPlayhead(getResolver(st.vault).clipEnd(pending.sceneId));
  }, [pending, entity.id]);
  // Moving the playhead leaves a draft behind: it was written for the time it was opened at.
  const lastPlayhead = useRef(playhead);
  useEffect(() => {
    if (lastPlayhead.current === playhead) return;
    lastPlayhead.current = playhead;
    if (following && draft?.at !== playhead) closeDraft();
  });

  const state = stateAt(r, entity, sel);
  const revisions = r.changesFor(entity.id).filter((c) => c.op === 'revise');
  const hasRevisions = revisions.length > 0;
  const reviseScene = reviseSceneOf(vault, scenes, sel);
  const timeLabel =
    sel.kind === 'start'
      ? 'Start — before any scene'
      : sel.kind === 'latest'
        ? 'Latest'
        : sel.kind === 'after'
          ? describeTime(vault, r.atScene(sel.sceneId, true))
          : describeTime(vault, sel.tp);
  const asOf = sel.kind === 'start' ? 'start' : sel.kind === 'latest' ? 'latest' : sel.kind === 'after' ? (vault.scenes[sel.sceneId]?.title ?? '?') : timeLabel;
  const pageBanner = state.revision
    ? `Page as of ${asOf} · revised ${state.revision.at !== undefined ? atLabel(state.revision.at) : `in ${changeWhere(vault, state.revision)}`}`
    : hasRevisions
      ? `Base page · as of ${asOf}`
      : 'Base page';

  /** Start a draft at the selected time. Only offered where there is a scene to commit at. */
  const openDraft = () => {
    // At a playhead position the page is revised at that very column; otherwise just after the scene.
    if (reviseScene) setDraft(draftAt(vault, entity.id, timeOf(r, sel), reviseScene.id, sel.kind === 'at' && sel.tp.kind === 'position' ? sel.tp.x : r.clipEnd(reviseScene.id)));
    else if (sel.kind === 'start') setDraft(baseDraft(entity));
  };
  const closeDraft = () => {
    setDraft(null);
    setProposal(null);
  };
  const pick = (next: TimeSel) => {
    setOwn(next);
    closeDraft();
  };

  const last = lastCommit(vault, state);
  const keyframes = entityKeyframes(r, entity.id);
  const prevKey = stepKeyframe(keyframes, playhead, 'prev');
  const nextKey = stepKeyframe(keyframes, playhead, 'next');
  const sliderMax = scenes.length + 1;
  const sliderValue =
    sel.kind === 'start'
      ? 0
      : sel.kind === 'latest'
        ? sliderMax
        : sel.kind === 'after'
          ? scenes.findIndex((s) => s.id === sel.sceneId) + 1
          : Math.max(0, scenes.findIndex((s) => s.momentId === (sel.tp.kind === 'moment' ? sel.tp.momentId : '')));
  const setSlider = (n: number) => pick(n <= 0 ? { kind: 'start' } : n >= sliderMax ? { kind: 'latest' } : { kind: 'after', sceneId: scenes[n - 1].id });

  /** Later versions that store their own page text and so would miss lines added to an earlier one. */
  const laterVersions = (d: Draft) => {
    const from = d.sceneId === null ? -1 : d.at;
    const mine = d.sceneId === null ? null : d.attach ? { sceneId: d.sceneId } : { at: d.at };
    return revisions
      .flatMap((c: StateChange) => (c.note !== undefined && !(mine && sameAnchor(c, mine)) ? [{ changeId: c.id, ...(c.sceneId !== undefined ? { sceneId: c.sceneId } : {}), note: c.note, order: r.effectiveFrom(c) }] : []))
      .filter((v) => v.order > from)
      .sort((a, b) => a.order - b.order);
  };

  /** Saves the draft; `apply` are the later versions that also get its added lines. */
  const finishCommit = (d: Draft, plan: PropagationPlan | null, apply: Id[]) => {
    const st = useStore.getState();
    let next: Vault;
    if (d.sceneId === null) {
      next = d.note === entity.note ? st.vault : updateEntity(st.vault, entity.id, { note: d.note });
    } else {
      const anchor = d.attach ? { sceneId: d.sceneId } : { at: d.at };
      const before = r.entityBefore(entity.id, anchor);
      next = commitRevision(st.vault, { entityId: entity.id, anchor, note: d.note, name: d.name, message: d.message, before: { note: before.note, name: before.name } }).vault;
    }
    const changed = next !== st.vault;
    const applied = plan ? applyPropagation(next, plan, apply) : { vault: next, applied: 0 };
    if (applied.vault !== st.vault) st.commit(applied.vault);
    const where = d.sceneId === null ? 'the base page' : d.attach ? `“${vault.scenes[d.sceneId]?.title ?? ''}”` : atLabel(d.at);
    const open = plan ? plan.versions.filter((v) => v.status !== 'present' && !apply.includes(v.changeId)).length : 0;
    const tail = (applied.applied ? ` ${applied.applied} later ${applied.applied === 1 ? 'version' : 'versions'} updated.` : '') + (open ? ` ${open} left as they were.` : '');
    st.toast('info', changed ? `Page revised from ${where}.${tail}` : 'Nothing changed: the page reads the same from there.');
    closeDraft();
  };

  const commitDraft = () => {
    if (!draft) return;
    const plan = planPropagation(draft.from, draft.note, laterVersions(draft));
    const needed = plan.versions.filter((v) => v.status !== 'present' && v.after !== v.before);
    if (!needed.length) return finishCommit(draft, null, []);
    // Edits already in a later version are never overwritten; a version whose surroundings were rewritten is unticked.
    setProposal({ plan, checked: needed.filter((v) => v.status !== 'conflict').map((v) => v.changeId) });
  };

  return (
    <div className="view">
      <div className="entity-layout">
        <div className="stack entity-main">
          <EntityHeader entity={entity} shownName={state.name} renameable={!hasRevisions} />
          <IdeaQueueSection entityId={entity.id} />
          <QueryResults entityId={entity.id} />
          <section className="panel" data-testid="entity-state">
            <div className="panel-head">
              State <span className="grow" />
              <span className="time-label" data-testid="entity-time-label">
                {timeLabel}
              </span>
            </div>
            <div className="panel-body stack">
              {following ? (
                <div className="row">
                  <button type="button" className="btn btn-sm" disabled={prevKey === null} onClick={() => prevKey !== null && setPlayhead(prevKey)} data-testid="key-prev" title="Move the playhead to the change before this time">
                    ◀ Previous change
                  </button>
                  <button type="button" className="btn btn-sm" disabled={nextKey === null} onClick={() => nextKey !== null && setPlayhead(nextKey)} data-testid="key-next" title="Move the playhead to the next change">
                    Next change ▶
                  </button>
                  <span className="grow" />
                  <button type="button" className={`btn btn-sm btn-ghost ${onTimeline ? 'active' : ''}`} aria-pressed={onTimeline} onClick={() => toggleCastTrack(entity.id)} data-testid="entity-on-timeline" title="Show this page as a row on the timeline, with a keyframe for each change">
                    On timeline
                  </button>
                </div>
              ) : (
              <div className="row">
                <input
                  type="range"
                  className="grow time-slider"
                  min={0}
                  max={sliderMax}
                  step={1}
                  value={sliderValue}
                  aria-label="Time scrubber"
                  data-testid="time-slider"
                  onChange={(e) => setSlider(Number(e.target.value))}
                />
                <select
                  className="select small"
                  aria-label="Jump to time"
                  data-testid="time-select"
                  value={selToValue(sel)}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'start' || v === 'latest') pick({ kind: v });
                    else if (v.startsWith('after:')) pick({ kind: 'after', sceneId: v.slice(6) });
                  }}
                >
                  <option value="start">Start</option>
                  {sel.kind === 'at' && <option value="custom">{timeLabel}</option>}
                  {scenes.map((s) => (
                    <option key={s.id} value={`after:${s.id}`}>
                      After “{s.title}”{s.chapterId ? ` (${vault.chapters[s.chapterId]?.title})` : ` (${vault.stories[s.storyId]?.name})`}
                    </option>
                  ))}
                  <option value="latest">Latest</option>
                </select>
              </div>
              )}
              {last && (
                <div className="entity-last-commit small" data-testid="entity-last-commit">
                  Last: <span className="commit-quote">“{last.message}”</span> — <span className="faint">{last.sceneTitle}</span>
                </div>
              )}
              <PropLines vault={vault} state={state} />
              {state.unordered.length > 0 && (
                <div className="small">
                  <div className="section-title">Possibly relevant (order unknown)</div>
                  {state.unordered.map((c) => (
                    <div key={c.id} className="row">
                      <a href="#" onClick={(e) => (e.preventDefault(), c.sceneId && navigate({ kind: 'scene', id: c.sceneId }))}>
                        {changeWhere(vault, c)}
                      </a>
                      <span className="muted">
                        {c.op === 'note'
                          ? `“${c.message ?? ''}”`
                          : c.op === 'revise'
                            ? 'page revised'
                            : `${c.property ?? c.op} ${c.op === 'set' ? `→ ${formatValue(c.value)}` : c.op}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <LifePanel entityId={entity.id} />
          <section className="panel" data-testid="page-panel">
            <div className="panel-head">
              Note <span className="grow" />
              {!draft && (
                <button
                  type="button"
                  className={`btn btn-sm btn-ghost ${sources ? 'active' : ''}`}
                  data-testid="page-sources-toggle"
                  aria-pressed={sources}
                  title="Show which scene wrote each line"
                  onClick={() => setSources(!sources)}
                >
                  Sources
                </button>
              )}
              {!draft && reviseScene && (
                <button type="button" className="btn btn-sm" data-testid="revise-page" onClick={openDraft}>
                  Revise page here
                </button>
              )}
              {!draft && hasRevisions && sel.kind === 'start' && (
                <button type="button" className="btn btn-sm" data-testid="edit-base-page" onClick={openDraft} title="Edit the first version of the page; lines you add can be offered to the later versions">
                  Edit base page
                </button>
              )}
              {!hasRevisions && !draft && (
                <>
                  {!preview && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      title="Upload or insert an image into this note"
                      onClick={() => {
                        void pickImageFile().then((img) => {
                          if (!img) return;
                          window.dispatchEvent(new CustomEvent<InsertTextDetail>('lw:insert-text', { detail: { text: `${img.markdown}\n` } }));
                        });
                      }}
                    >
                      + Image
                    </button>
                  )}
                  <button className={`btn btn-sm ${preview ? '' : 'active'}`} onClick={() => setPreview(false)} data-testid="note-edit">
                    Edit
                  </button>
                  <button className={`btn btn-sm ${preview ? 'active' : ''}`} onClick={() => setPreview(true)}>
                    Preview
                  </button>
                </>
              )}
            </div>
            <div className="panel-body stack">
              <div className="page-time small" data-testid="page-time">
                {pageBanner}
              </div>
              {draft ? (
                <div className="stack">
                  <textarea
                    className="input revision-text"
                    aria-label="Page text"
                    data-testid="revision-editor"
                    rows={12}
                    value={draft.note}
                    placeholder="The page as it reads from this scene on…"
                    readOnly={proposal !== null}
                    onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  />
                  {proposal ? (
                    <PropagatePreview
                      vault={vault}
                      proposal={proposal}
                      onToggle={(id) => setProposal({ ...proposal, checked: proposal.checked.includes(id) ? proposal.checked.filter((x) => x !== id) : [...proposal.checked, id] })}
                      onBack={() => setProposal(null)}
                      onCommit={(ids) => finishCommit(draft, proposal.plan, ids)}
                    />
                  ) : (
                    <div className="revision-bar" data-testid="revision-bar">
                      <div className="small faint">
                        {draft.sceneId === null ? (
                          <>The base page: it reads this way until the first revision.</>
                        ) : (
                          <>
                            Committed {draft.attach ? 'at' : `just after column ${draft.at}, where`} <strong className="revision-scene">{vault.scenes[draft.sceneId]?.title}</strong>
                            {draft.attach ? '' : ' ends'}. The page reads this way from there on.
                          </>
                        )}
                      </div>
                      {draft.sceneId !== null && (
                        <>
                          <AnchorNote at={draft.at} sceneTitle={vault.scenes[draft.sceneId]?.title ?? ''} attach={draft.attach} onChange={(attach) => setDraft({ ...draft, attach })} />
                          <input
                            className="input small"
                            aria-label="Commit message"
                            data-testid="revision-message"
                            placeholder="What changed? e.g. Cuts her hair short"
                            value={draft.message}
                            onChange={(e) => setDraft({ ...draft, message: e.target.value })}
                          />
                          <input
                            className="input small"
                            aria-label="Name"
                            data-testid="revision-rename"
                            placeholder="Name"
                            value={draft.name}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                          />
                        </>
                      )}
                      <div className="row">
                        <span className="grow" />
                        <button className="btn btn-sm btn-ghost" data-testid="revision-cancel" onClick={closeDraft}>
                          Cancel
                        </button>
                        <button className="btn btn-sm btn-primary" data-testid="revision-commit" onClick={commitDraft}>
                          Commit page
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : sources ? (
                <LineSources entityId={entity.id} revision={state.revision} />
              ) : preview || hasRevisions ? (
                <div onDoubleClick={() => (hasRevisions ? openDraft() : setPreview(false))} title={hasRevisions ? 'Double-click to edit' : undefined}>
                  <Markdown text={state.note} testId="note-preview" />
                </div>
              ) : (
                <Editor
                  key={entity.id}
                  value={entity.note}
                  testId="note-editor"
                  placeholder="Describe them… [[links]], #tags, > [!note] callouts"
                  onChange={(note) => update((v) => updateEntity(v, entity.id, { note }), `note:${entity.id}`)}
                />
              )}
            </div>
          </section>
        </div>

        <aside className="stack entity-side">
          <RelationsPanel entity={entity} tp={timeOf(r, sel)} sceneOptions={scenes} />
          <AffiliationsPanel entity={entity} tp={timeOf(r, sel)} sceneOptions={scenes} />
          <MembersPanel group={entity} tp={timeOf(r, sel)} />
          <PresencePanel entityId={entity.id} tp={timeOf(r, sel)} />
          <section className="panel">
            <div className="panel-head">Base properties</div>
            <div className="panel-body">
              <div className="faint small" style={{ marginBottom: 6 }}>
                How {entity.name} is before any scene changes {type?.name === 'Person' || type?.name === 'Character' ? 'them' : 'it'}.
              </div>
              <PropsEditor props={entity.props} onChange={(props) => useStore.getState().propose(`Change ${entity.name}’s starting properties`, updateEntity(useStore.getState().vault, entity.id, { props }))} testId="base-props" />
            </div>
          </section>
          <HistoryPanel entity={entity} onPick={(c) => pick(c.at !== undefined ? { kind: 'at', tp: { kind: 'position', x: c.at } } : { kind: 'after', sceneId: c.sceneId! })} />
          <BacklinksPanel entity={entity} />
        </aside>
      </div>
    </div>
  );
}

/** The page as it reads now, line by line, each run of lines tagged with the scene whose version wrote it. */
function LineSources({ entityId, revision }: { entityId: Id; revision: StateChange | null }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const lines = getResolver(vault).lineSources(entityId, revision);
  if (!lines.length) return <div className="faint small">The page is empty.</div>;
  return (
    <ol className="page-sources" data-testid="page-sources">
      {lines.map((l, i) => {
        const prev = lines[i - 1];
        const tag = l.text.trim() !== '' && (!prev || prev.change !== l.change || prev.text.trim() === '');
        const sceneId = l.change?.at === undefined ? l.change?.sceneId : undefined;
        return (
          <li key={i} className={l.change?.agent ? 'by-agent' : undefined} data-testid="page-source-line">
            <span className="page-source-text">{l.text || ' '}</span>
            {tag && (
              <button
                type="button"
                className="page-source-tag small"
                disabled={!sceneId}
                title={sceneId ? 'Open the scene' : undefined}
                onClick={() => sceneId && navigate({ kind: 'scene', id: sceneId })}
              >
                {l.change ? changeWhere(vault, l.change) : 'Base page'}
                {l.change?.agent ? ' · agent' : ''}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function EntityHeader({ entity, shownName, renameable }: { entity: Entity; shownName: string; renameable: boolean }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const [name, setName] = useState(shownName);
  const [prevName, setPrevName] = useState(shownName);
  if (prevName !== shownName) {
    setPrevName(shownName);
    setName(shownName);
  }
  const type = vault.entityTypes[entity.typeId];
  return (
    <div className="stack">
      <div className="row small muted">
        <span className="dot" style={{ background: type?.color }} />
        <select
          className="select small"
          aria-label="Entity type"
          value={entity.typeId}
          onChange={(e) => update((v) => updateEntity(v, entity.id, { typeId: e.target.value }))}
        >
          {sortedTypes(vault).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          data-testid="entity-upload-portrait"
          title="Upload a portrait or reference image for this entity"
          onClick={() => {
            void pickImageFile(512).then((img) => {
              if (img) update((v) => updateEntity(v, entity.id, { image: img.dataUrl }));
            });
          }}
        >
          {entity.image ? 'Change portrait…' : '+ Portrait'}
        </button>
        {entity.image && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            title="Remove portrait image"
            onClick={() => update((v) => updateEntity(v, entity.id, { image: undefined }))}
          >
            Remove portrait
          </button>
        )}
        <span className="grow" />
        <button
          className="btn btn-sm btn-ghost btn-danger"
          onClick={() => {
            if (!window.confirm(`Delete “${entity.name}” and all its state changes?`)) return;
            update((v) => deleteEntity(v, entity.id));
            navigate({ kind: 'home' });
          }}
        >
          Delete
        </button>
      </div>
      <div className="row" style={{ alignItems: 'center', gap: 14 }}>
        {entity.image && (
          <img
            src={entity.image}
            alt={shownName}
            data-testid="entity-portrait"
            style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover', border: '1px solid var(--border-strong)', flexShrink: 0 }}
          />
        )}
        <div className="stack grow" style={{ minWidth: 0 }}>
          <input
            className="view-title"
            aria-label="Entity name"
            data-testid="entity-name"
            value={name}
            readOnly={!renameable}
            title={renameable ? undefined : 'Renamed by a page revision. Use Revise page here to change the name from a scene.'}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => renameable && name.trim() && name !== entity.name && update((v) => renameEntityEverywhere(v, entity.id, name))}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
          <input
            className="input small"
            aria-label="Aliases"
            placeholder="Aliases, comma separated"
            defaultValue={entity.aliases.join(', ')}
            key={entity.aliases.join('|')}
            onBlur={(e) => {
              const aliases = e.target.value
                .split(',')
                .map((a) => a.trim())
                .filter(Boolean);
              if (aliases.join('|') !== entity.aliases.join('|')) update((v) => updateEntity(v, entity.id, { aliases }));
            }}
          />
        </div>
      </div>
    </div>
  );
}

/** What a commit did to the entity in one line, e.g. "status: alive → dead". Undefined for message-only notes. */
function changeSummary(h: HistoryEntry): string | undefined {
  const c = h.change;
  if (c.op === 'create') return 'comes into existence';
  if (c.op === 'retire') return 'stops existing';
  if (!c.property) return undefined;
  const after = c.op === 'remove' ? 'removed' : formatValue(h.after);
  return `${c.property}: ${formatValue(h.before)} → ${after}`;
}

/** Unchanged lines are folded away, keeping one line of context around each change. `null` marks a gap. */
function diffWithContext(lines: DiffLine[]): (DiffLine | null)[] {
  const keep = lines.map((l, i) => l.kind !== 'same' || lines.slice(Math.max(0, i - 1), i + 2).some((x) => x.kind !== 'same'));
  const out: (DiffLine | null)[] = [];
  let gap = false;
  lines.forEach((l, i) => {
    if (!keep[i]) {
      gap = true;
      return;
    }
    if (gap) out.push(null);
    gap = false;
    out.push(l);
  });
  return out;
}

/** Expandable line diff of one page revision: "+N −M" in the summary, green added and red removed lines. */
function PageDiff({ lines }: { lines: DiffLine[] }) {
  const { added, removed } = diffStats(lines);
  return (
    <details className="commit-diff" data-testid="history-diff">
      <summary className="small">
        <span className="diff-count-add">+{added}</span> <span className="diff-count-del">−{removed}</span> <span className="faint">page</span>
      </summary>
      <DiffBody lines={lines} />
    </details>
  );
}

function DiffBody({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="diff">
      {diffWithContext(lines).map((l, i) =>
        l ? (
          <div key={i} className={`diff-line diff-${l.kind}`}>
            <span className="diff-mark" aria-hidden="true">
              {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}
            </span>
            <span className="diff-text">{l.text || ' '}</span>
          </div>
        ) : (
          <div key={i} className="diff-gap" aria-hidden="true">
            ⋯
          </div>
        ),
      )}
    </div>
  );
}

const STATUS_TEXT: Record<VersionPlan['status'], string> = {
  present: 'already has it',
  placed: 'fits right in',
  section: 'text around it changed: goes to the end of its section',
  conflict: 'rewritten there: would go to the end of the page',
};

/** The second step of committing an earlier version: which later versions also get the lines just added. */
function PropagatePreview({ vault, proposal, onToggle, onBack, onCommit }: { vault: Vault; proposal: Proposal; onToggle: (id: Id) => void; onBack: () => void; onCommit: (ids: Id[]) => void }) {
  const { plan, checked } = proposal;
  const n = checked.length;
  return (
    <div className="revision-bar" data-testid="propagate-preview">
      <div className="small">
        <strong>Add the {plan.added === 1 ? 'new line' : `${plan.added} new lines`} to later versions too?</strong>
        <div className="faint">Later versions keep what they already say; only added lines are offered.</div>
      </div>
      {plan.versions.map((v) => {
        const title = changeWhere(vault, vault.changes[v.changeId]);
        const actionable = v.status !== 'present' && v.after !== v.before;
        return (
          <div key={v.changeId} className="propagate-version" data-testid="propagate-version" data-scene={title} data-status={v.status}>
            <label className="row">
              <input type="checkbox" disabled={!actionable} checked={actionable && checked.includes(v.changeId)} onChange={() => onToggle(v.changeId)} aria-label={`Update ${title}`} />
              <strong>{title}</strong>
              <span className="faint small">{STATUS_TEXT[v.status]}</span>
            </label>
            {actionable && <DiffBody lines={diffLines(v.before, v.after)} />}
          </div>
        );
      })}
      <div className="row">
        <button className="btn btn-sm btn-ghost" data-testid="propagate-back" onClick={onBack}>
          Back
        </button>
        <span className="grow" />
        <button className="btn btn-sm" data-testid="propagate-skip" onClick={() => onCommit([])}>
          Commit only here
        </button>
        <button className="btn btn-sm btn-primary" data-testid="propagate-apply" disabled={!n} onClick={() => onCommit(checked)}>
          {n ? `Commit and update ${n} later ${n === 1 ? 'version' : 'versions'}` : 'Commit'}
        </button>
      </div>
    </div>
  );
}

/** Entity history as a git-log style timeline: one commit per change, oldest first, newest last. */
function HistoryPanel({ entity, onPick }: { entity: Entity; onPick: (change: StateChange) => void }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const r = getResolver(vault);
  const history = r.history(entity.id);
  const pages = new Map(r.pageHistory(entity.id).flatMap((p) => (p.change ? [[p.change.id, p] as const] : [])));
  return (
    <section className="panel" data-testid="history-panel">
      <div className="panel-head">History</div>
      <div className="panel-body">
        {!history.length && <div className="faint small">No scene has changed {entity.name} yet.</div>}
        <ol className="commit-log">
          {history.map((h) => {
            const c = h.change;
            const s = c.at === undefined && c.sceneId ? vault.scenes[c.sceneId] : undefined;
            // A change on the timeline is placed by its column; the scenes there now are shown for orientation.
            const around = s ? [] : r.scenesOfChange(c).slice(0, 2).map((id) => vault.scenes[id]?.title);
            const message = c.message || undefined;
            const page = c.op === 'revise' ? pages.get(c.id) : undefined;
            const renamed = page && c.rename !== undefined && page.prevName !== page.name ? `renamed ${page.prevName} → ${page.name}` : undefined;
            const diff = page && c.note !== undefined ? diffLines(page.prevNote, page.note) : undefined;
            const summary = c.op === 'revise' ? renamed : changeSummary(h);
            // A rename with no message is the commit's title; otherwise it gets its own line.
            const renameIsTitle = c.op === 'revise' && !message && !diff && !!renamed;
            const title = message ?? (c.op === 'revise' ? (renameIsTitle ? renamed : 'Page revised') : (summary ?? 'note'));
            const where = s ? (s.chapterId && vault.chapters[s.chapterId]?.title) || vault.stories[s.storyId]?.name || '' : around.join(', ');
            return (
              <li key={c.id} className="commit" data-testid="history-entry">
                <button type="button" className="commit-body" onClick={() => onPick(c)} title={s ? 'Show the state just after this scene' : 'Show the state at this point of the timeline'}>
                  <span className={message ? 'commit-msg' : 'commit-msg commit-generated'}>{title}</span>
                </button>
                <div className="commit-where small">
                  {s ? (
                    <a href="#" className="commit-scene" onClick={(e) => (e.preventDefault(), navigate({ kind: 'scene', id: s.id }))} title="Open scene">
                      {s.title}
                    </a>
                  ) : (
                    <span className="commit-scene" title="On the timeline: stays here when scenes move">
                      {changeWhere(vault, c)}
                    </span>
                  )}
                  {where && <span className="faint"> · {where}</span>}
                </div>
                {c.op === 'revise' ? (
                  <>
                    {renamed && !renameIsTitle && (
                      <div className="commit-change small muted" data-testid="history-rename">
                        {renamed}
                      </div>
                    )}
                    {diff && <PageDiff lines={diff} />}
                  </>
                ) : (
                  message && summary && <div className="commit-change small muted">{summary}</div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function backlinks(vault: Vault, entityId: Id) {
  const out: { kind: 'entity' | 'scene'; id: Id; title: string; snippet: string }[] = [];
  const scan = (kind: 'entity' | 'scene', id: Id, title: string, text: string) => {
    const hit = parseLinks(text).find((l) => findEntity(vault, l.target)?.id === entityId);
    if (!hit) return;
    const lineStart = text.lastIndexOf('\n', hit.start) + 1;
    const lineEnd = text.indexOf('\n', hit.end);
    out.push({ kind, id, title, snippet: text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).slice(0, 140) });
  };
  for (const e of Object.values(vault.entities)) if (e.id !== entityId) scan('entity', e.id, e.name, e.note);
  for (const s of Object.values(vault.scenes)) scan('scene', s.id, s.title, s.prose);
  for (const e of Object.values(vault.entities)) {
    if (e.id === entityId || out.some((o) => o.id === e.id)) continue;
    const refs = Object.entries(e.props).filter(([, v]) =>
      (Array.isArray(v) ? v : [v]).some((x) => typeof x === 'object' && x !== null && findEntity(vault, x.target)?.id === entityId),
    );
    if (refs.length) out.push({ kind: 'entity', id: e.id, title: e.name, snippet: `property: ${refs.map(([k]) => k).join(', ')}` });
  }
  return out;
}

function BacklinksPanel({ entity }: { entity: Entity }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const links = useMemo(() => backlinks(vault, entity.id), [vault, entity.id]);
  return (
    <section className="panel" data-testid="backlinks-panel">
      <div className="panel-head">Backlinks ({links.length})</div>
      <div className="panel-body stack">
        {!links.length && <div className="faint small">Nothing links here yet.</div>}
        {links.map((b) => (
          <div key={b.kind + b.id} className="backlink">
            <a href="#" onClick={(e) => (e.preventDefault(), navigate(b.kind === 'scene' ? { kind: 'scene', id: b.id } : { kind: 'entity', id: b.id }))}>
              {b.kind === 'scene' ? '¶ ' : ''}
              {b.title}
            </a>
            <div className="faint small">{b.snippet}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
