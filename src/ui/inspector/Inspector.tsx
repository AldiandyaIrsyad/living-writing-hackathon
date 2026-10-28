// Inspector, the quick panel on the right: one scrolling column, no tabs. The scene's name, the agent, the notes
// left in the text, then the cast. What a scene says about itself (when, status, what it changes) is above the text.

import { useMemo, useState } from 'react';
import { formatValue } from '../../core/resolve';
import type { Id, PropValue, Scene, StateChange, TimePoint } from '../../core/types';
import { atLabel, changeWhere } from '../../core/anchor';
import { addChange, parseQuickCommit } from '../../store/actions';
import { addToCast, groupCast, removeFromCast, sceneCast, type GroupCastMember } from '../../store/cast';
import { getResolver, useStore, useVault } from '../../store/store';
import { AffiliationChips } from '../affiliations/Affiliations';
import { AgentSection } from './AgentSection';
import { AnchorNote } from '../AnchorNote';
import type { RevealTextDetail } from '../editor/Editor';
import { PropLines } from '../EntityState';
import { playheadContext } from '../follow';
import { sceneAddresses } from '../goto';
import { collectNoteGroups, type NoteRow } from '../left/panelData';
import { ValueInput } from '../props';
import { chooseTarget, pinLabel } from './target';
import './inspector.css';

/** Which scene the Inspector describes, and at what point in time its cast is read. */
interface Target {
  scene: Scene;
  tp: TimePoint;
  /** The open scene (editable) rather than the scene under the playhead or a pinned one (read-only). */
  writing: boolean;
  /** Held on this scene by the pin, whatever else is open. */
  pinned: boolean;
}

function useTarget(): Target | null {
  const vault = useVault();
  const view = useStore((s) => s.view);
  const playhead = useStore((s) => s.playhead);
  const pin = useStore((s) => s.inspectorPin);
  const ctx = playheadContext(vault, playhead);
  const chosen = chooseTarget(vault, pin, view.kind === 'scene' ? view.id : null, ctx?.scene.id ?? null);
  if (!chosen) return null;
  const scene = vault.scenes[chosen.sceneId];
  // The playhead is a position on the timeline, not a scene's moment, so it keeps its own point in time.
  const tp: TimePoint = chosen.source === 'playhead' ? { kind: 'position', x: playhead } : getResolver(vault).atScene(scene.id);
  return { scene, tp, writing: chosen.source === 'writing', pinned: chosen.source === 'pinned' };
}

export function Inspector() {
  const target = useTarget();
  return (
    <aside className="inspector" data-testid="inspector">
      {target ? (
        <>
          <SceneSection target={target} />
          <AgentSection scene={target.scene} writing={target.writing} />
          <NotesSection scene={target.scene} />
          <CastSection target={target} />
        </>
      ) : (
        <div className="insp-empty">Open a scene or move the playhead onto the timeline to see who is there.</div>
      )}
    </aside>
  );
}

function SceneSection({ target: { scene, writing, pinned } }: { target: Target }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const address = sceneAddresses(vault, scene.storyId).get(scene.id);

  return (
    <section className="insp-section insp-scene" data-testid="insp-scene">
      <div className={`insp-time ${writing ? 'is-writing' : 'is-playhead'}`} data-testid="cast-time">
        <div className="insp-scene-line">
          <span className="insp-scene-title" title={writing ? 'The scene you are writing in' : pinned ? 'Pinned scene' : 'The scene under the playhead'}>
            {address && <span className="insp-addr">{address}</span>} {scene.title || 'Untitled scene'}
          </span>
          <button
            type="button"
            className={`insp-pin${pinned ? ' on' : ''}`}
            data-testid="insp-pin"
            aria-pressed={pinned}
            title={pinned ? 'Unpin: follow the page you are writing again' : 'Pin: keep looking at this scene while you work elsewhere'}
            onClick={() => useStore.getState().setInspectorPin(pinned ? null : scene.id)}
          >
            {pinned ? 'Unpin' : 'Pin'}
          </button>
        </div>
        {pinned && (
          <div className="insp-pin-chip" data-testid="insp-pin-chip">
            as of {pinLabel(vault, scene.id)}
          </div>
        )}
        {!writing && (
          <div className="insp-time-sub">{pinned ? 'Pinned' : 'Playhead'}</div>
        )}
      </div>
      {!writing && (
        <button type="button" className="btn btn-sm insp-open" data-testid="insp-open-scene" onClick={() => navigate({ kind: 'scene', id: scene.id })}>
          Open scene
        </button>
      )}
    </section>
  );
}

/** Which author notes to list: the open chapter's (the usual), just this scene's, or the whole vault's. */
type NotesScope = 'chapter' | 'scene' | 'all';
const NOTES_SCOPE_KEY = 'lw.inspector.notesScope';

function loadNotesScope(): NotesScope {
  try {
    const raw = window.localStorage.getItem(NOTES_SCOPE_KEY);
    return raw === 'scene' || raw === 'all' ? raw : 'chapter';
  } catch {
    return 'chapter';
  }
}

/** The author notes the writer left in the text, where they are needed: this chapter first, any scene, or everything. */
function NotesSection({ scene }: { scene: Scene }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const [scope, setScope] = useState<NotesScope>(loadNotesScope);
  const groups = useMemo(() => collectNoteGroups(vault), [vault]);
  const chapterSceneIds = useMemo(() => new Set(Object.values(vault.scenes).filter((s) => scene.chapterId && s.chapterId === scene.chapterId).map((s) => s.id)), [vault.scenes, scene.chapterId]);
  const rows = groups
    .flatMap((g) => g.rows)
    .filter((r) => (scope === 'all' ? true : r.kind === 'scene' && (scope === 'scene' ? r.id === scene.id : chapterSceneIds.has(r.id) || r.id === scene.id)));

  const choose = (value: NotesScope) => {
    setScope(value);
    try {
      window.localStorage.setItem(NOTES_SCOPE_KEY, value);
    } catch {
      // Remembering the choice is a convenience only.
    }
  };
  const open = (row: NoteRow) => {
    if (row.kind === 'entity') {
      navigate({ kind: 'entity', id: row.id });
      return;
    }
    navigate({ kind: 'scene', id: row.id });
    const detail: RevealTextDetail = { sceneId: row.id, from: row.from, to: row.to };
    // Let the scene mount (and its editor start listening) before revealing the note.
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('lw:reveal-text', { detail })), 0);
  };

  return (
    <section className="insp-section insp-notes" data-testid="insp-notes">
      <div className="insp-sec-head">
        <span>Notes</span>
        <select className="tl-select insp-scope" aria-label="Notes cover" data-testid="notes-scope" value={scope} onChange={(e) => choose(e.target.value as NotesScope)}>
          <option value="chapter">This chapter</option>
          <option value="scene">This scene</option>
          <option value="all">Everything</option>
        </select>
        <span className="insp-count" data-testid="notes-count">
          {rows.length}
        </span>
      </div>
      {rows.length === 0 && <div className="insp-empty">No notes here. Press Ctrl+/ in the text to leave yourself one.</div>}
      {rows.map((row) => (
        <button key={row.key} type="button" className="insp-note" data-testid="insp-note" onClick={() => open(row)}>
          <span className="insp-note-where">{row.where}</span>
          <span className="insp-note-text">{row.text === '' ? 'Empty note' : row.text}</span>
        </button>
      ))}
    </section>
  );
}

/** A cast this long gets a find box. */
const FIND_FROM = 8;

/** What the Cast covers: every scene of the open scene's chapter, just the open scene, or one chosen scene of that chapter. */
type CastScope = 'chapter' | 'current' | Id;
const SCOPE_KEY = 'lw.inspector.castScope';

function loadScope(): CastScope {
  try {
    return window.localStorage.getItem(SCOPE_KEY) === 'current' ? 'current' : 'chapter';
  } catch {
    return 'chapter';
  }
}

function CastSection({ target: { scene, tp, writing } }: { target: Target }) {
  const vault = useVault();
  const [scope, setScope] = useState<CastScope>(loadScope);
  const [adding, setAdding] = useState('');
  const [find, setFind] = useState('');
  /** Cards are one line each until clicked; the ones opened so far. */
  const [opened, setOpened] = useState<Set<Id>>(() => new Set());

  const chapterScenes = useMemo(
    () => (scene.chapterId ? Object.values(vault.scenes).filter((s) => s.chapterId === scene.chapterId).sort((a, b) => a.order - b.order) : []),
    [vault.scenes, scene.chapterId],
  );
  // A chapter of one scene has nothing to choose between; a remembered scene of another chapter falls back to the chapter.
  const canScope = chapterScenes.length > 1;
  const pinned = scope === 'chapter' || scope === 'current' ? undefined : chapterScenes.find((s) => s.id === scope);
  const mode: 'chapter' | 'current' | 'pinned' = !canScope ? 'current' : pinned ? 'pinned' : scope === 'current' ? 'current' : 'chapter';
  /** The scene commits and additions go to, and whose moment the cards' state is read at. */
  const anchor = pinned ?? scene;
  const anchorTp = pinned ? getResolver(vault).atScene(pinned.id) : tp;
  const shown = useMemo(() => (mode === 'chapter' ? chapterScenes : [anchor]), [mode, chapterScenes, anchor]);
  const scopeIds = useMemo(() => new Set(shown.map((x) => x.id)), [shown]);
  const cast = useMemo(() => groupCast(vault, shown), [vault, shown]);
  const inAnchor = useMemo(() => sceneCast(vault, anchor), [vault, anchor]);
  const castShown = cast.length >= FIND_FROM && find.trim() ? cast.filter((m) => vault.entities[m.entityId].name.toLowerCase().includes(find.trim().toLowerCase())) : cast;
  const others = Object.values(vault.entities)
    .filter((e) => !inAnchor.some((c) => c.entityId === e.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const choose = (value: string) => {
    setScope(value);
    if (value === 'chapter' || value === 'current') {
      try {
        window.localStorage.setItem(SCOPE_KEY, value);
      } catch {
        // Remembering the choice is a convenience only.
      }
    }
  };

  return (
    <section className="insp-section insp-cast" data-testid="insp-cast">
      <div className="insp-sec-head">
        <span>Cast</span>
        {canScope && (
          <select
            className="tl-select insp-scope"
            aria-label="Cast covers"
            title="Who to show: the whole chapter, this scene, or one scene"
            data-testid="cast-scope"
            value={mode === 'pinned' ? anchor.id : mode}
            onChange={(e) => choose(e.target.value)}
          >
            <option value="chapter">Whole chapter</option>
            <option value="current">This scene</option>
            <optgroup label="Only…">
              {chapterScenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title || 'Untitled scene'}
                </option>
              ))}
            </optgroup>
          </select>
        )}
        <span className="insp-count" data-testid="cast-count">
          {cast.length}
        </span>
      </div>

      {!cast.length && (
        <div className="insp-empty" data-testid="cast-empty">
          Nobody here yet. Type <code>[[name]]</code> in the scene and they will appear — or add someone below.
        </div>
      )}
      {cast.length >= FIND_FROM && (
        <input className="input small insp-cast-find" placeholder="Find in the cast" aria-label="Find in the cast" data-testid="cast-find" value={find} onChange={(e) => setFind(e.target.value)} />
      )}
      {castShown.map((m) => {
        const open = opened.has(m.entityId);
        return (
          <CastCard
            key={m.entityId}
            member={m}
            scene={anchor}
            scopeIds={scopeIds}
            appearsIn={mode === 'chapter' ? m.sceneIds : null}
            onPickScene={choose}
            tp={anchorTp}
            canCommit={writing}
            open={open}
            onToggle={() =>
              setOpened((prev) => {
                const next = new Set(prev);
                if (!next.delete(m.entityId)) next.add(m.entityId);
                return next;
              })
            }
          />
        );
      })}

      <div className="cast-add">
        <select
          className="tl-select grow"
          value={adding}
          aria-label="Add to cast"
          data-testid="cast-add"
          onChange={(e) => {
            const id = e.target.value;
            setAdding('');
            if (!id) return;
            const s = useStore.getState();
            s.commit(addToCast(s.vault, anchor.id, id));
          }}
        >
          <option value="">{mode === 'chapter' ? `+ Add to “${anchor.title}”…` : '+ Add actor or location…'}</option>
          {others.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {vault.entityTypes[e.typeId]?.name}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}

function commitSummary(c: StateChange): string {
  if (c.message) return c.message;
  if (c.op === 'revise') return c.rename !== undefined ? `page revised, renamed to ${c.rename}` : 'page revised';
  if (c.op === 'create') return 'comes into existence';
  if (c.op === 'retire') return 'stops existing';
  if (c.op === 'note') return '(note)';
  if (c.op === 'remove') return `${c.property} removed`;
  return `${c.property} → ${formatValue(c.value)}`;
}

function CastCard({
  member,
  scene,
  scopeIds,
  appearsIn,
  onPickScene,
  tp,
  canCommit,
  open,
  onToggle,
}: {
  member: GroupCastMember;
  /** The scene commits go to and the state is read at. */
  scene: Scene;
  /** Every scene the Cast is showing now: one, or the whole chapter. */
  scopeIds: Set<Id>;
  /** Whole-chapter view only: the scenes this one is in, each a way to narrow to that scene. */
  appearsIn: Id[] | null;
  onPickScene: (sceneId: Id) => void;
  tp: TimePoint;
  canCommit: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const [composing, setComposing] = useState(false);
  const id = member.entityId;
  const e = vault.entities[id];
  const type = vault.entityTypes[e.typeId];
  const r = getResolver(vault);
  const state = r.entityAt(id, tp);
  // The name as of this point in the story (a page revision may have renamed the entity).
  const shownName = state.name;
  const inScope = (c: StateChange) => r.scenesOfChange(c).some((sid) => scopeIds.has(sid));
  const recent = state.applied.filter((c) => !inScope(c)).slice(-2).reverse();
  const here = r.changesFor(id).filter(inScope);

  // The one-line state: status first, then one more property.
  const props = Object.entries(state.props);
  const headline = [...props.filter(([k]) => k === 'status'), ...props.filter(([k]) => k === 'state'), ...props.filter(([k]) => k !== 'status' && k !== 'state')].slice(0, 2);

  const toggleKey = (ev: React.KeyboardEvent) => {
    if (ev.target !== ev.currentTarget || (ev.key !== 'Enter' && ev.key !== ' ')) return;
    ev.preventDefault();
    onToggle();
  };

  return (
    <div className="insp-card" data-testid="cast-card" data-entity={e.name} data-open={open} style={{ ['--type' as string]: type?.color }}>
      <div className="insp-card-head" role="button" tabIndex={0} aria-expanded={open} title={open ? 'Hide details' : 'Show details'} onClick={onToggle} onKeyDown={toggleKey} data-testid="cast-head">
        <span className="dot" style={{ background: type?.color }} />
        <a
          href="#"
          className="insp-card-name"
          title="Open floating wiki editor (Shift+click for full page)"
          onClick={(ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            if (ev.shiftKey || ev.ctrlKey || ev.metaKey || useStore.getState().view.kind !== 'scene') {
              navigate({ kind: 'entity', id, at: tp });
            } else {
              useStore.getState().openFloatingEntity(id, scene.id);
            }
          }}
        >
          {shownName}
        </a>
        <span className="faint small insp-card-type">{type?.name}</span>
        {here.length > 0 && (
          <span className="insp-card-delta" title={`${here.length} commit${here.length === 1 ? '' : 's'} in ${scopeIds.size > 1 ? 'this chapter' : 'this scene'}`}>
            Δ{here.length}
          </span>
        )}
        <span className="grow" />
        <span className="insp-card-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </div>

      {open && (
        <>
          <div className="insp-card-summary small" data-testid="cast-summary">
            {!state.exists ? (
              <span className="faint">does not exist at this point</span>
            ) : headline.length ? (
              headline.map(([k, p], i) => (
                <span key={k}>
                  {i > 0 && <span className="faint"> · </span>}
                  <span className="insp-k">{k}</span>: {formatValue(p.value)}
                </span>
              ))
            ) : (
              <span className="faint">No properties.</span>
            )}
          </div>

          <AffiliationChips entityId={id} tp={tp} compact />

          <div className="insp-card-body">
            {recent.length > 0 && (
              <ul className="cast-log">
                {recent.map((c) => (
                  <li key={c.id} title={changeWhere(vault, c)}>
                    <span className="cast-log-msg">{commitSummary(c)}</span>
                    <span className="cast-log-src"> — {changeWhere(vault, c)}</span>
                  </li>
                ))}
              </ul>
            )}
            <PropLines vault={vault} state={state} limit={5} hide={['affiliations']} />
            {appearsIn && (
              <div className="cast-in small" data-testid="cast-in">
                <span className="faint">in</span>
                {appearsIn.map((sid) => (
                  <button key={sid} type="button" className="cast-in-scene" title="Show only this scene's cast" onClick={() => onPickScene(sid)}>
                    {vault.scenes[sid]?.title || 'Untitled scene'}
                  </button>
                ))}
              </div>
            )}
            {here.length > 0 && (
              <div className="cast-here">
                {here.map((c) => (
                  <div key={c.id} className="small" data-testid={c.op === 'revise' ? 'cast-page-here' : 'cast-here'}>
                    <span className="cast-here-tag">{c.op === 'revise' ? 'page' : r.fallsIn(c, scene.id) ? 'this scene' : changeWhere(vault, c)}</span> {commitSummary(c)}
                  </div>
                ))}
              </div>
            )}
          </div>

          {canCommit &&
            (composing ? (
              <CommitComposer entityId={id} sceneId={scene.id} where={scopeIds.size > 1 ? scene.title : null} onDone={() => setComposing(false)} />
            ) : (
              <div className="cast-actions">
                <button type="button" className="cast-commit-btn" onClick={() => setComposing(true)} data-testid="commit-open">
                  Commit change…
                </button>
                <button
                  type="button"
                  className="cast-commit-btn"
                  data-testid="cast-update-page"
                  title={`Revise ${shownName}'s page from “${scene.title}” on`}
                  onClick={() => useStore.getState().openRevision(id, scene.id)}
                >
                  Update page…
                </button>
                {scene.cast?.includes(id) && (
                  <button
                    type="button"
                    className="cast-commit-btn"
                    title="Remove from this scene's cast"
                    aria-label={`Remove ${e.name} from cast`}
                    onClick={() => {
                      const s = useStore.getState();
                      s.commit(removeFromCast(s.vault, scene.id, id));
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
        </>
      )}
    </div>
  );
}

/** `where` names the scene when the panel shows a whole chapter, so it is clear where the commit lands. */
function CommitComposer({ entityId, sceneId, where, onDone }: { entityId: Id; sceneId: Id; where: string | null; onDone: () => void }) {
  const vault = useVault();
  const sceneTitle = vault.scenes[sceneId]?.title ?? '';
  // By default the edit sits on the timeline, just after the scene being written; it can be attached to the scene instead.
  const at = getResolver(vault).clipEnd(sceneId);
  const [attach, setAttach] = useState(false);
  const [message, setMessage] = useState('');
  const [property, setProperty] = useState('');
  const [value, setValue] = useState<PropValue>('');
  const submit = () => {
    const msg = message.trim();
    const prop = property.trim();
    if (!msg && !prop) return;
    const s = useStore.getState();
    const place = attach ? { sceneId } : { at };
    let fields: Omit<StateChange, 'id' | 'order'>;
    if (prop) {
      fields = { ...place, entityId, op: 'set', property: prop, value, ...(msg ? { message: msg } : {}) };
    } else {
      const quick = parseQuickCommit(msg);
      if (quick && quick.op === 'set' && quick.property !== undefined) {
        fields = { ...place, entityId, op: 'set', property: quick.property, value: quick.value, ...(quick.message ? { message: quick.message } : {}) };
      } else {
        fields = { ...place, entityId, op: 'note', message: msg };
      }
    }
    // Recording a change can alter what later scenes see; if it does, the writer is asked before it goes in.
    const done = s.propose(`Record this change to ${s.vault.entities[entityId]?.name}`, addChange(s.vault, fields).vault);
    if (done) s.toast('info', `Committed to ${s.vault.entities[entityId]?.name}: “${msg || prop}” — takes effect ${attach ? `after “${sceneTitle}”` : atLabel(at)}.`);
    onDone();
  };
  return (
    <div className="commit-composer" onKeyDown={(e) => e.key === 'Escape' && onDone()}>
      <textarea
        className="input"
        autoFocus
        rows={2}
        placeholder="What changes? e.g. “Loses his arm in the fire”"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
        }}
        data-testid="commit-message"
      />
      <div className="row">
        <input className="input small" style={{ width: 96 }} placeholder="property" value={property} onChange={(e) => setProperty(e.target.value)} list="prop-names" aria-label="Property (optional)" />
        {property.trim() && <ValueInput value={value} onChange={setValue} />}
      </div>
      <AnchorNote at={at} sceneTitle={sceneTitle} attach={attach} onChange={setAttach} />
      <div className="row">
        <span className="faint small grow">
          {where ? `Commits in “${where}”. ` : ''}Optional property. Ctrl+Enter to commit.
        </span>
        <button className="btn btn-sm btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <button className="btn btn-sm btn-primary" onClick={submit} data-testid="commit-submit" disabled={!message.trim() && !property.trim()}>
          Commit
        </button>
      </div>
    </div>
  );
}
