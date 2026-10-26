import { useMemo, useState } from 'react';
import { momentConcrete, parseConcrete } from '../../core/concrete';
import { allLabels, constrainScenesToLabel, moveScenesToLabel } from '../../core/labels';
import { findEntity, parseLinks } from '../../core/links';
import { constrainScenes, deleteScene, insertScene, moveScenes, removeConstraint } from '../../core/timeline';
import type { ChangeOp, Id, Scene, StateChange, Vault } from '../../core/types';
import {
  addChange,
  addChapter,
  addChapterLabel,
  addSceneLabel,
  chaptersOfStory,
  deleteChange,
  parseQuickCommit,
  removeChapterLabel,
  removeSceneLabel,
  renameSceneEverywhere,
  setMomentConcrete,
  setMomentTimeSkip,
  setSceneChapter,
  setSceneSomeday,
  shiftSceneOrder,
  updateChange,
  updateSceneProse,
  updateSceneSynopsis,
} from '../../store/actions';
import { flushEditors, getResolver, update, useStore, useVault } from '../../store/store';
import { Editor, type InsertTextDetail } from '../editor/Editor';
import { pickImageFile } from '../imageUpload';
import { ChapterView } from './ChapterView';
import { chronologicalScenes } from '../follow';
import { Markdown } from '../Markdown';
import { ValueInput } from '../props';
import { StatusSelect } from '../StatusSelect';
import { formatCount, readingMinutes, sceneWordCount } from '../../core/wordcount';
import './scene.css';

/**
 * A scene in a chapter opens as its chapter (all its scenes in one document, scrolled to this one).
 * A scene without a chapter is a document of its own.
 */
export function SceneView({ id }: { id: Id }) {
  const chapterId = useStore((s) => {
    const c = s.vault.scenes[id]?.chapterId;
    return c && s.vault.chapters[c] ? c : null;
  });
  if (chapterId) return <ChapterView key={chapterId} chapterId={chapterId} activeSceneId={id} />;
  return <SingleSceneView id={id} />;
}

function SingleSceneView({ id }: { id: Id }) {
  const scene = useStore((s) => s.vault.scenes[id]);
  const [preview, setPreview] = useState(false);
  if (!scene) return <div className="empty">This scene no longer exists.</div>;
  return (
    <div className="scene-layout">
      <div className="view">
        <div className="view-narrow">
          <SceneHeader scene={scene} preview={preview} setPreview={setPreview} />
          {preview ? (
            <Markdown text={scene.prose} contextSceneId={scene.id} testId="scene-preview" />
          ) : (
            <Editor
              key={scene.id}
              value={scene.prose}
              contextSceneId={scene.id}
              testId="scene-editor"
              editorId="manuscript-editor"
              onChange={(text) => update((v) => updateSceneProse(v, scene.id, text), `prose:${scene.id}`)}
            />
          )}
          <SingleSceneFooterNav scene={scene} />
        </div>
      </div>
    </div>
  );
}

/** Reader-style bottom navigation for scenes that don't belong to a chapter yet. */
function SingleSceneFooterNav({ scene }: { scene: Scene }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const storyScenes = useMemo(
    () =>
      Object.values(vault.scenes)
        .filter((s) => s.storyId === scene.storyId && Boolean(s.someday) === Boolean(scene.someday))
        .sort((a, b) => a.order - b.order),
    [vault.scenes, scene.storyId, scene.someday],
  );
  const idx = storyScenes.findIndex((s) => s.id === scene.id);
  const prev = idx > 0 ? storyScenes[idx - 1] : null;
  const next = idx >= 0 && idx < storyScenes.length - 1 ? storyScenes[idx + 1] : null;

  const createNextChapterFromScene = () => {
    flushEditors();
    const st = useStore.getState();
    let v = st.vault;
    const chs = chaptersOfStory(v, scene.storyId);
    const createdCh = addChapter(v, scene.storyId, `Chapter ${chs.length + 1}`);
    v = createdCh.vault;
    const ins = insertScene(
      v,
      { storyId: scene.storyId, title: 'Opening scene', chapterId: createdCh.id },
      scene.someday ? null : 'after',
      scene.someday ? null : scene.id,
    );
    st.commit(ins.vault);
    navigate({ kind: 'scene', id: ins.sceneId });
  };

  return (
    <nav className="chapter-footer-nav" aria-label="Scene navigation" data-testid="scene-footer-nav">
      <div className="chapter-nav-side">
        {prev ? (
          <button
            type="button"
            className="btn btn-sm chapter-nav-btn"
            data-testid="scene-prev"
            onClick={() => {
              flushEditors();
              navigate({ kind: 'scene', id: prev.id });
            }}
          >
            ← <span className="chapter-nav-label">{prev.title || 'Untitled scene'}</span>
          </button>
        ) : (
          <span className="faint small">{scene.someday ? 'Someday scene (unplaced)' : 'First scene'}</span>
        )}
      </div>
      <div className="chapter-nav-side chapter-nav-right">
        {next && (
          <button
            type="button"
            className="btn btn-sm chapter-nav-btn"
            data-testid="scene-next"
            onClick={() => {
              flushEditors();
              navigate({ kind: 'scene', id: next.id });
            }}
          >
            <span className="chapter-nav-label">{next.title || 'Untitled scene'}</span> →
          </button>
        )}
        <button type="button" className="btn btn-sm btn-primary" data-testid="scene-create-chapter" onClick={createNextChapterFromScene} title="Create a new chapter after this scene">
          + Next Chapter →
        </button>
      </div>
    </nav>
  );
}

function SceneHeader({ scene, preview, setPreview }: { scene: Scene; preview: boolean; setPreview: (p: boolean) => void }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const showNotes = useStore((s) => s.showNotesInEditor);
  const story = vault.stories[scene.storyId];
  const chapters = chaptersOfStory(vault, scene.storyId);
  const [title, setTitle] = useState(scene.title);
  const [prevTitle, setPrevTitle] = useState(scene.title);
  if (scene.title !== prevTitle) {
    setPrevTitle(scene.title);
    setTitle(scene.title);
  }
  const commitTitle = () => title.trim() && title !== scene.title && update((v) => renameSceneEverywhere(v, scene.id, title));
  const words = useMemo(() => sceneWordCount(scene), [scene]);
  return (
    <div className="stack" style={{ marginBottom: 12 }}>
      <div className="row small muted wrap">
        <span className="dot" style={{ background: story?.color }} />
        <a href="#" onClick={(e) => (e.preventDefault(), navigate({ kind: 'story', id: scene.storyId }))}>
          {story?.name}
        </a>
        <span>·</span>
        <select
          className="select small"
          aria-label="Chapter"
          value={scene.chapterId ?? ''}
          onChange={(e) => update((v) => setSceneChapter(v, scene.id, e.target.value || null))}
        >
          <option value="">No chapter</option>
          {chapters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <StatusSelect scene={scene} className="select" testId="scene-status" />
        <span className="grow" />
        <span className="faint" data-testid="scene-words" title="Words in this scene and estimated reading time">
          {formatCount(words)} {words === 1 ? 'word' : 'words'}
          {words > 0 && ` · ${readingMinutes(words)} min`}
        </span>
        <span>·</span>
        <span title="Reading order within the story">Reading order #{scene.order + 1}</span>
        <button className="btn btn-sm btn-ghost" title="Earlier in reading order" onClick={() => update((v) => shiftSceneOrder(v, scene.id, -1))}>
          ↑
        </button>
        <button className="btn btn-sm btn-ghost" title="Later in reading order" onClick={() => update((v) => shiftSceneOrder(v, scene.id, 1))}>
          ↓
        </button>
        <button
          className="btn btn-sm btn-ghost"
          disabled={preview}
          data-testid="scene-insert-image"
          title="Upload or insert an image at the cursor (you can also paste or drag-and-drop images directly into the editor)"
          onClick={() => {
            void pickImageFile().then((img) => {
              if (!img) return;
              window.dispatchEvent(
                new CustomEvent<InsertTextDetail>('lw:insert-text', {
                  detail: { text: `${img.markdown}\n`, targetEditorId: 'manuscript-editor' },
                }),
              );
            });
          }}
        >
          + Image
        </button>
        <button className={`btn btn-sm ${preview ? '' : 'active'}`} onClick={() => setPreview(false)}>
          Write
        </button>
        <button className={`btn btn-sm ${preview ? 'active' : ''}`} onClick={() => setPreview(true)} data-testid="toggle-preview">
          Preview
        </button>
        <button
          className={`btn btn-sm ${showNotes ? 'active' : ''}`}
          onClick={() => useStore.getState().setShowNotesInEditor(!showNotes)}
          data-testid="toggle-notes"
          title="Show author notes in the editor, or collapse them to markers (Ctrl+Shift+/)"
        >
          {showNotes ? 'Notes: shown' : 'Notes: hidden'}
        </button>
        <button
          className="btn btn-sm btn-ghost btn-danger"
          onClick={() => {
            if (!window.confirm(`Delete scene “${scene.title}”?`)) return;
            update((v) => deleteScene(v, scene.id));
            navigate({ kind: 'home' });
          }}
        >
          Delete
        </button>
      </div>
      <input
        className="view-title"
        aria-label="Scene title"
        data-testid="scene-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
      <input
        className="input small"
        placeholder="Beat / synopsis (optional 1-line summary — excluded from manuscript word count)"
        aria-label="Scene synopsis"
        data-testid="scene-synopsis"
        defaultValue={scene.synopsis ?? ''}
        key={`${scene.id}:${scene.synopsis ?? ''}`}
        onBlur={(e) => e.target.value.trim() !== (scene.synopsis ?? '') && update((v) => updateSceneSynopsis(v, scene.id, e.target.value))}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
    </div>
  );
}

function sceneTitles(vault: Vault, momentId: Id, except?: Id): string {
  const list = Object.values(vault.scenes).filter((s) => s.momentId === momentId && s.id !== except);
  return list.map((s) => s.title).join(', ') || momentConcrete(vault.moments[momentId]) || '(empty moment)';
}

export function PlacementPanel({ scene }: { scene: Scene }) {
  const vault = useVault();
  const toast = useStore((s) => s.toast);
  const navigate = useStore((s) => s.navigate);
  const m = scene.momentId;
  const after = Object.values(vault.constraints).filter((c) => c.after === m);
  const before = Object.values(vault.constraints).filter((c) => c.before === m);
  const same = Object.values(vault.scenes).filter((s) => s.momentId === m && s.id !== scene.id);
  const others = chronologicalScenes(vault).filter((s) => s.id !== scene.id);
  const labels = useMemo(() => allLabels(vault), [vault]);
  const [rel, setRel] = useState<'before' | 'after' | 'same'>('after');
  const [target, setTarget] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [labelScope, setLabelScope] = useState<'scene' | 'chapter'>(scene.chapterId ? 'chapter' : 'scene');
  const concrete = momentConcrete(vault.moments[m]) ?? '';
  const timeSkip = vault.moments[m]?.timeSkip ?? '';
  const parsedConcrete = useMemo(() => (concrete ? parseConcrete(concrete) : null), [concrete]);
  const chapter = scene.chapterId ? vault.chapters[scene.chapterId] : undefined;
  const sceneLabels = scene.labels ?? [];
  const chapterLabels = chapter?.labels ?? [];

  const commitConcrete = (val: string) => {
    if (val === concrete) return;
    const res = setMomentConcrete(vault, m, val);
    if (!res.ok) toast('error', res.error);
    else useStore.getState().commit(res.vault);
  };

  const add = () => {
    if (!target) return;
    const baseVault = scene.someday ? setSceneSomeday(vault, scene.id, false) : vault;
    const res = target.startsWith('label:')
      ? constrainScenesToLabel(baseVault, [scene.id], rel, target.slice(6))
      : constrainScenes(baseVault, [scene.id], rel, target);
    if (!res.ok) toast('error', res.error);
    else useStore.getState().commit(res.vault);
  };

  const move = () => {
    if (!target) return;
    const baseVault = scene.someday ? setSceneSomeday(vault, scene.id, false) : vault;
    const res = target.startsWith('label:')
      ? moveScenesToLabel(baseVault, [scene.id], rel, target.slice(6))
      : moveScenes(baseVault, [scene.id], rel, target);
    if (!res.ok) toast('error', res.error);
    else useStore.getState().commit(res.vault);
  };

  const submitLabel = () => {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    if (labelScope === 'chapter' && scene.chapterId) {
      update((v) => addChapterLabel(v, scene.chapterId!, trimmed));
    } else {
      update((v) => addSceneLabel(v, scene.id, trimmed));
    }
    setNewLabel('');
  };

  const sceneLink = (momentId: Id) => {
    const s = Object.values(vault.scenes).find((x) => x.momentId === momentId);
    return (
      <a href="#" onClick={(e) => (e.preventDefault(), s && navigate({ kind: 'scene', id: s.id }))}>
        {sceneTitles(vault, momentId)}
      </a>
    );
  };

  return (
    <section className="panel" data-testid="placement-panel">
      <div className="panel-head">When</div>
      <div className="panel-body stack">
        <div className="stack" style={{ gap: 4 }}>
          <input
            className="input"
            placeholder="Concrete date (e.g. Autumn, 2026 or 2026-10-25)"
            aria-label="Concrete date"
            data-testid="concrete-input"
            defaultValue={concrete}
            key={m + concrete}
            onBlur={(e) => commitConcrete(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
          {parsedConcrete ? (
            <div className="small faint" data-testid="concrete-parsed">
              Concrete constraint: <strong>{parsedConcrete.canonical}</strong> ({parsedConcrete.precision})
            </div>
          ) : concrete ? (
            <div className="small faint" data-testid="concrete-freeform">
              Custom time label (displayed on ruler; add a year like “Autumn, 2026” to enforce calendar order)
            </div>
          ) : null}
          <input
            className="input small"
            placeholder="Relative time skip (optional, e.g. 3 days later, 10 years ago)"
            aria-label="Relative time skip"
            data-testid="timeskip-input"
            defaultValue={timeSkip}
            key={`${m}:skip:${timeSkip}`}
            onBlur={(e) => e.target.value.trim() !== timeSkip && update((v) => setMomentTimeSkip(v, m, e.target.value))}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
          <label className="row small muted" style={{ cursor: 'pointer', gap: 6, marginTop: 2 }}>
            <input
              type="checkbox"
              data-testid="scene-someday-toggle"
              checked={Boolean(scene.someday)}
              onChange={(e) => update((v) => setSceneSomeday(v, scene.id, e.target.checked))}
            />
            Keep in Someday tray (unplaced — write freely without committing to timeline order yet)
          </label>
        </div>
        <div className="small">
          {after.map((c) => (
            <div className="row place-row" key={c.id}>
              <span className="muted">after</span> {sceneLink(c.before)}
              <button className="btn btn-ghost btn-sm" aria-label="Remove rule" onClick={() => update((v) => removeConstraint(v, c.id))}>
                ×
              </button>
            </div>
          ))}
          {before.map((c) => (
            <div className="row place-row" key={c.id}>
              <span className="muted">before</span> {sceneLink(c.after)}
              <button className="btn btn-ghost btn-sm" aria-label="Remove rule" onClick={() => update((v) => removeConstraint(v, c.id))}>
                ×
              </button>
            </div>
          ))}
          {same.length > 0 && (
            <div className="row place-row">
              <span className="muted">same time as</span> {same.map((s) => s.title).join(', ')}
            </div>
          )}
          {!after.length && !before.length && !same.length && !parsedConcrete && (
            <div className="faint">Floating — not placed relative to anything yet.</div>
          )}
        </div>
        <div className="row">
          <select className="select small" value={rel} onChange={(e) => setRel(e.target.value as 'before' | 'after' | 'same')} aria-label="Relation">
            <option value="after">after</option>
            <option value="before">before</option>
            <option value="same">same time as</option>
          </select>
          <select className="select small grow" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Other scene or label" data-testid="placement-target">
            <option value="">choose label or scene…</option>
            {labels.length > 0 && (
              <optgroup label="Labels (Milestones)">
                {labels.map((l) => (
                  <option key={`label:${l.name}`} value={`label:${l.name}`}>
                    🏷 {l.name}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Scenes">
              {others.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </optgroup>
          </select>
          <button className="btn btn-sm" onClick={add} disabled={!target} data-testid="placement-add" title="Add an ordering constraint without removing existing rules">
            Add
          </button>
          <button className="btn btn-sm btn-ghost" onClick={move} disabled={!target} data-testid="placement-move" title="Move scene here (replaces conflicting ordering rules)">
            Move
          </button>
        </div>

        <div className="stack" style={{ marginTop: 6, gap: 6 }}>
          <div className="small muted">Labels (Event Bookmarks)</div>
          {(sceneLabels.length > 0 || chapterLabels.length > 0) && (
            <div className="row wrap" style={{ gap: 4 }}>
              {chapterLabels.map((l) => (
                <span key={`ch:${l}`} className="chip small" data-testid="chapter-label-chip" title={`Label on ${chapter?.title ?? 'chapter'}`}>
                  🏷 {l} <span className="faint">(ch)</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-label={`Remove chapter label ${l}`}
                    onClick={() => scene.chapterId && update((v) => removeChapterLabel(v, scene.chapterId!, l))}
                  >
                    ×
                  </button>
                </span>
              ))}
              {sceneLabels.map((l) => (
                <span key={`sc:${l}`} className="chip small" data-testid="scene-label-chip" title="Label on this scene">
                  🏷 {l}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-label={`Remove scene label ${l}`}
                    onClick={() => update((v) => removeSceneLabel(v, scene.id, l))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="row">
            <input
              className="input small grow"
              placeholder="Add label (e.g. The Death of Hero Nora)"
              aria-label="New label"
              data-testid="new-label-input"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submitLabel())}
            />
            {scene.chapterId && (
              <select
                className="select small"
                aria-label="Label scope"
                data-testid="label-scope"
                value={labelScope}
                onChange={(e) => setLabelScope(e.target.value as 'scene' | 'chapter')}
              >
                <option value="chapter">on chapter</option>
                <option value="scene">on scene</option>
              </select>
            )}
            <button type="button" className="btn btn-sm" onClick={submitLabel} disabled={!newLabel.trim()} data-testid="add-label-btn">
              + Label
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

const OPS: { op: ChangeOp; label: string }[] = [
  { op: 'set', label: 'set' },
  { op: 'remove', label: 'remove' },
  { op: 'add', label: 'add to list' },
  { op: 'removeItem', label: 'remove from list' },
  { op: 'create', label: 'comes into existence' },
  { op: 'retire', label: 'stops existing' },
  { op: 'note', label: 'note only' },
];

/** Sets or clears a change's commit message. Clearing removes the key instead of storing undefined. */
function setChangeMessage(v: Vault, id: Id, message: string): Vault {
  const c = v.changes[id];
  if (!c) return v;
  const { message: _previous, ...rest } = c;
  const next: StateChange = message ? { ...rest, message } : rest;
  return { ...v, changes: { ...v.changes, [id]: next } };
}

export function mentionedEntityIds(vault: Vault, scene: Scene): Id[] {
  const ids = new Set<Id>();
  for (const l of parseLinks(scene.prose)) {
    const e = findEntity(vault, l.target);
    if (e) ids.add(e.id);
  }
  for (const c of getResolver(vault).changesInScene(scene.id)) if (vault.entities[c.entityId]) ids.add(c.entityId);
  return [...ids];
}

export function ChangesPanel({ scene }: { scene: Scene }) {
  const vault = useVault();
  const refused = useStore((s) => s.proposalsRefused);
  const propose = useStore.getState().propose;
  // The scene's own commits, and the ones on the timeline that fall in its stretch of time.
  const r = getResolver(vault);
  const changes = r.changesInScene(scene.id).sort((a, b) => r.compare(a, b));
  const entities = useMemo(() => Object.values(vault.entities).sort((a, b) => a.name.localeCompare(b.name)), [vault.entities]);
  const propNames = useMemo(() => {
    const set = new Set<string>();
    for (const e of Object.values(vault.entities)) for (const k of Object.keys(e.props)) set.add(k);
    for (const c of Object.values(vault.changes)) if (c.property) set.add(c.property);
    return [...set].sort();
  }, [vault.entities, vault.changes]);

  const [quickEntity, setQuickEntity] = useState<Id>('');
  const [quickText, setQuickText] = useState('');

  const addRow = () => {
    const first = mentionedEntityIds(vault, scene)[0] ?? entities[0]?.id;
    if (!first) {
      useStore.getState().toast('info', 'Create an entity first, then record how this scene changes it.');
      return;
    }
    // Attach to the scene by default so moving the scene carries its consequences along.
    update((v) => addChange(v, { sceneId: scene.id, entityId: first, op: 'note' }).vault);
  };

  const submitQuick = () => {
    const entId = quickEntity || mentionedEntityIds(vault, scene)[0] || entities[0]?.id;
    if (!entId) {
      useStore.getState().toast('info', 'Create an entity first, then record how this scene changes it.');
      return;
    }
    const parsed = parseQuickCommit(quickText);
    if (!parsed) return;
    propose(
      `Record change to ${vault.entities[entId]?.name ?? 'entity'}`,
      addChange(vault, { sceneId: scene.id, entityId: entId, ...parsed }).vault,
    );
    setQuickText('');
  };

  return (
    <section className="panel" data-testid="changes-panel">
      <div className="panel-head">
        State changes <span className="grow" />
        <button className="btn btn-sm" onClick={addRow} data-testid="add-change">
          + Change
        </button>
      </div>
      <div className="panel-body stack">
        {entities.length > 0 && (
          <div className="row" style={{ gap: 4 }}>
            <select
              className="select small"
              aria-label="Quick commit entity"
              data-testid="quick-commit-entity"
              value={quickEntity || mentionedEntityIds(vault, scene)[0] || entities[0]?.id || ''}
              onChange={(e) => setQuickEntity(e.target.value)}
            >
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <input
              className="input small grow"
              placeholder="Quick commit: e.g. “Breaks his arm” or “status = wounded”"
              aria-label="Quick commit"
              data-testid="quick-commit-input"
              value={quickText}
              onChange={(e) => setQuickText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submitQuick())}
            />
          </div>
        )}
        {!changes.length && <div className="faint small">This scene doesn't change anything yet. Record deaths, moves, new owners, shifting loyalties…</div>}
        <datalist id="prop-names">
          {propNames.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        {changes.map((c) => {
          if (c.op === 'revise') {
            // A living-page revision: edited from the entity's page, not as a property here.
            const ent = entities.find((e) => e.id === c.entityId);
            return (
              <div className="change-row" key={c.id} data-testid="change-row" data-op="revise">
                <div className="row">
                  <span className="grow small">
                    <strong>{ent?.name ?? '?'}</strong> <span className="muted">· page revised</span>
                    {c.rename !== undefined && <span className="muted"> · renamed to {c.rename}</span>}
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={() => useStore.getState().openRevision(c.entityId, scene.id)}>
                    Open page
                  </button>
                  <button className="btn btn-ghost btn-sm" aria-label="Delete change" onClick={() => useStore.getState().propose('Delete this change', deleteChange(useStore.getState().vault, c.id))}>
                    ×
                  </button>
                </div>
                {c.message && <div className="small faint">{c.message}</div>}
              </div>
            );
          }
          const needsProp = c.op !== 'create' && c.op !== 'retire' && c.op !== 'note';
          const needsValue = needsProp && c.op !== 'remove';
          return (
            <div className="change-row" key={c.id} data-testid="change-row">
              <div className="row">
                <select
                  className="select small grow"
                  aria-label="Entity"
                  data-testid="change-entity"
                  value={c.entityId}
                  onChange={(e) => propose('Change who this commit is about', updateChange(useStore.getState().vault, c.id, { entityId: e.target.value }))}
                >
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
                <select
                  className="select small"
                  aria-label="Operation"
                  data-testid="change-op"
                  value={c.op}
                  onChange={(e) => {
                    const op = e.target.value as ChangeOp;
                    const keep = op !== 'create' && op !== 'retire' && op !== 'note';
                    propose('Change what this commit does', updateChange(useStore.getState().vault, c.id, { op, property: keep ? (c.property ?? 'status') : undefined, value: keep && op !== 'remove' ? (c.value ?? '') : undefined }));
                  }}
                >
                  {OPS.map((o) => (
                    <option key={o.op} value={o.op}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button className="btn btn-ghost btn-sm" aria-label="Delete change" onClick={() => useStore.getState().propose('Delete this change', deleteChange(useStore.getState().vault, c.id))}>
                  ×
                </button>
              </div>
              <div className="row">
                <input
                  className="input small grow"
                  placeholder="Commit message — what happened?"
                  aria-label="Commit message"
                  data-testid="change-message"
                  defaultValue={c.message ?? ''}
                  key={c.id + (c.message ?? '')}
                  onBlur={(e) => {
                    const message = e.target.value.trim();
                    if (message !== (c.message ?? '')) update((v) => setChangeMessage(v, c.id, message));
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                />
              </div>
              {needsProp && (
                <div className="row">
                  <input
                    className="input small"
                    style={{ width: 110 }}
                    list="prop-names"
                    aria-label="Property"
                    data-testid="change-prop"
                    defaultValue={c.property}
                    key={`${c.id}${c.property ?? ''}:${refused}`}
                    onBlur={(e) => e.target.value.trim() && e.target.value !== c.property && propose('Change which property this commit sets', updateChange(useStore.getState().vault, c.id, { property: e.target.value.trim() }))}
                    onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                  />
                  {needsValue && <ValueInput value={c.value} onChange={(value) => propose('Change the value this commit sets', updateChange(useStore.getState().vault, c.id, { value }))} testId="change-value" />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
