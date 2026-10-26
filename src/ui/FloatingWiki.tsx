// Floating Wiki Window: opens when an author clicks a [[wiki link]], cast member, or wiki entry while writing a scene.
// Shows the entity's state & latest commit as of that scene, lets the author edit its page or log a commit attached
// directly to the open scene without leaving their manuscript, and offers a one-click "⤢ Full history" button to
// switch to the full EntityView tab when they want the complete timeline scrubber.

import { useEffect, useRef, useState } from 'react';
import { atLabel, changeWhere } from '../core/anchor';
import { formatValue } from '../core/resolve';
import type { Id, TimePoint } from '../core/types';
import { addChange, commitRevision, deleteChange, parseQuickCommit, renameEntityEverywhere, updateEntity } from '../store/actions';
import { getResolver, update, useStore, useVault } from '../store/store';
import { AffiliationChips } from './affiliations/Affiliations';
import { Editor, type InsertTextDetail } from './editor/Editor';
import { PropLines } from './EntityState';
import { describeTime } from './follow';
import { pickImageFile } from './imageUpload';
import { Markdown } from './Markdown';
import { PropsEditor } from './props';
import './floatingWiki.css';

export function FloatingWiki() {
  const floating = useStore((s) => s.floatingEntity);
  const view = useStore((s) => s.view);
  if (!floating) return null;
  const effectiveSceneId = floating.sceneId ?? (view.kind === 'scene' ? view.id : null);
  return (
    <FloatingWikiWindow
      key={`${floating.entityId}:${ JSON.stringify(floating.at ?? null)}`}
      entityId={floating.entityId}
      sceneId={effectiveSceneId}
      at={floating.at}
    />
  );
}

function FloatingWikiWindow({ entityId, sceneId, at }: { entityId: Id; sceneId: Id | null; at?: TimePoint }) {
  const vault = useVault();
  const entity = vault.entities[entityId];
  const close = useStore((s) => s.closeFloatingEntity);
  const navigate = useStore((s) => s.navigate);

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [quickInput, setQuickInput] = useState('');
  const [showLasting, setShowLasting] = useState(false);
  const [lastingInput, setLastingInput] = useState('');
  const [attachToScene, setAttachToScene] = useState(true);
  const [editingPage, setEditingPage] = useState(false);
  const [editingBase, setEditingBase] = useState(false);
  const [draftNote, setDraftNote] = useState('');
  const [draftMsg, setDraftMsg] = useState('');
  const [showProps, setShowProps] = useState(false);
  const winRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) {
        if (editingPage) {
          setEditingPage(false);
          return;
        }
        if (editingBase) {
          setEditingBase(false);
          return;
        }
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, editingPage, editingBase]);

  useEffect(() => {
    if (!pos) return;
    const onResize = () => {
      const el = winRef.current;
      const width = el?.offsetWidth ?? 420;
      const height = el?.offsetHeight ?? 400;
      setPos((prev) => {
        if (!prev) return null;
        return {
          x: Math.max(8, Math.min(window.innerWidth - width - 8, prev.x)),
          y: Math.max(8, Math.min(window.innerHeight - Math.min(height, 120) - 8, prev.y)),
        };
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos]);

  if (!entity) return null;

  const r = getResolver(vault);
  const scene = sceneId ? vault.scenes[sceneId] : undefined;
  const effectiveTp: TimePoint = at ?? (scene ? r.atScene(scene.id, true) : { kind: 'latest' });
  const state = r.entityAt(entity.id, effectiveTp);
  const type = vault.entityTypes[entity.typeId];
  const revisions = r.changesFor(entity.id).filter((c) => c.op === 'revise');
  const hasRevisions = revisions.length > 0;

  // Chapter / scene scope for temporary notes: all scenes in the active chapter (or just the active scene if chapterless)
  const chapterSceneIds = new Set<Id>(
    scene
      ? scene.chapterId
        ? Object.values(vault.scenes)
            .filter((s) => s.chapterId === scene.chapterId)
            .map((s) => s.id)
        : [scene.id]
      : [],
  );
  const chapterTitle = scene?.chapterId ? vault.chapters[scene.chapterId]?.title : undefined;

  // Volatile notes recorded in the current chapter/scene
  const chapterNotes = scene
    ? Object.values(vault.changes)
        .filter((c) => c.entityId === entity.id && c.op === 'note' && c.sceneId !== undefined && chapterSceneIds.has(c.sceneId))
        .sort((a, b) => a.order - b.order)
    : [];

  // Lasting state commits recorded specifically in the active scene
  const sceneCommits = scene
    ? state.applied.filter((c) => c.sceneId === scene.id && c.op !== 'note')
    : [];

  // Latest commit applied up to this point in time
  const lastApplied = [...state.applied].reverse().find((c) => c.message || c.property || c.op === 'revise');
  const lastSummary = lastApplied
    ? lastApplied.message
      ? `“${lastApplied.message}”`
      : lastApplied.op === 'revise'
        ? 'Page revised'
        : `${lastApplied.property ?? lastApplied.op}`
    : null;
  const lastWhere = lastApplied ? changeWhere(vault, lastApplied) : null;

  const openFullPage = () => {
    close();
    navigate({ kind: 'entity', id: entity.id, at: effectiveTp });
  };

  /** Default quick input: logs a temporary chapter/scene note (`op: 'note'`) without triggering downstream impact modals. */
  const handleAddChapterNote = () => {
    if (!scene) return;
    const msg = quickInput.trim();
    if (!msg) return;
    const s = useStore.getState();
    const added = addChange(s.vault, {
      sceneId: scene.id,
      entityId: entity.id,
      op: 'note',
      message: msg,
    });
    s.commit(added.vault, undefined, `Note on ${entity.name} in ${scene.title}`);
    s.toast('info', `Added chapter note for ${state.name} in “${scene.title}”`);
    setQuickInput('');
  };

  /** Lasting change input: records a permanent property update (`op: 'set'`) that carries forward to future chapters. */
  const handleLastingChange = () => {
    if (!scene) return;
    const parsed = parseQuickCommit(lastingInput);
    if (!parsed) return;
    const colEnd = r.clipEnd(scene.id);
    const place = attachToScene ? { sceneId: scene.id } : { at: colEnd };
    const s = useStore.getState();
    const fields =
      parsed.op === 'set' && parsed.property !== undefined
        ? { ...place, entityId: entity.id, op: 'set' as const, property: parsed.property, value: parsed.value, ...(parsed.message ? { message: parsed.message } : {}) }
        : { ...place, entityId: entity.id, op: 'note' as const, message: parsed.message ?? lastingInput.trim() };
    const done = s.propose(`Record change to ${entity.name}`, addChange(s.vault, fields).vault);
    if (done) {
      s.toast('info', `Saved lasting change on ${state.name} from “${scene.title}” onward`);
    }
    setLastingInput('');
    setShowLasting(false);
  };

  const startRevisePage = () => {
    setDraftNote(state.note);
    setDraftMsg('');
    setEditingPage(true);
  };

  const savePageRevision = () => {
    if (!scene) {
      useStore.getState().toast('error', 'No active scene to attach this page revision to.');
      setEditingPage(false);
      return;
    }
    const anchor = attachToScene ? { sceneId: scene.id } : { at: r.clipEnd(scene.id) };
    const before = r.entityBefore(entity.id, anchor);
    const st = useStore.getState();
    const res = commitRevision(st.vault, {
      entityId: entity.id,
      anchor,
      note: draftNote,
      name: state.name,
      message: draftMsg.trim() || undefined,
      before: { note: before.note, name: before.name },
    });
    if (res.vault !== st.vault) {
      st.commit(res.vault, undefined, `Revise ${state.name}’s page in ${scene.title}`);
      st.toast('info', `Updated ${state.name}’s page for “${scene.title}”`);
    }
    setEditingPage(false);
  };

  const onHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select, a')) return;
    const el = winRef.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = rect.left;
    const origY = rect.top;
    const onMove = (ev: MouseEvent) => {
      setPos({
        x: Math.max(8, Math.min(window.innerWidth - rect.width - 8, origX + (ev.clientX - startX))),
        y: Math.max(8, Math.min(window.innerHeight - 80, origY + (ev.clientY - startY))),
      });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const style: React.CSSProperties = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : {};

  return (
    <aside
      ref={winRef}
      className="floating-wiki"
      data-testid="floating-wiki"
      aria-label={`Wiki: ${state.name}`}
      style={style}
    >
      <div className="fw-head" onMouseDown={onHeaderMouseDown} title="Drag to move">
        {entity.image ? (
          <img
            src={entity.image}
            alt={state.name}
            data-testid="floating-portrait"
            style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--border-strong)', cursor: 'pointer' }}
            title="Click to change portrait image"
            onClick={() => {
              void pickImageFile(512).then((img) => {
                if (img) update((v) => updateEntity(v, entity.id, { image: img.dataUrl }));
              });
            }}
          />
        ) : (
          <span className="dot" style={{ background: type?.color }} />
        )}
        <input
          className="fw-title-input"
          aria-label="Entity name"
          data-testid="floating-entity-name"
          defaultValue={state.name}
          key={state.name}
          readOnly={hasRevisions}
          onBlur={(e) => !hasRevisions && e.target.value.trim() && e.target.value !== entity.name && update((v) => renameEntityEverywhere(v, entity.id, e.target.value))}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        />
        <span className="badge small">{type?.name}</span>
        {!entity.image && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            title="Upload portrait image"
            onClick={() => {
              void pickImageFile(512).then((img) => {
                if (img) update((v) => updateEntity(v, entity.id, { image: img.dataUrl }));
              });
            }}
          >
            + Portrait
          </button>
        )}
        <span className="grow" />
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          data-testid="floating-open-full"
          title="Open full entity page & timeline history"
          onClick={openFullPage}
        >
          ⤢ Full history
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          data-testid="floating-close"
          aria-label="Close floating wiki"
          title="Close (Esc)"
          onClick={close}
        >
          ×
        </button>
      </div>

      <div className="fw-context small">
        <span className="fw-time-badge" data-testid="floating-time">
          {scene ? `As of “${scene.title}”` : describeTime(vault, effectiveTp)}
        </span>
        {!state.exists && (
          <span className="badge small" style={{ color: 'var(--danger, #dc2626)' }}>
            Does not exist at this point
          </span>
        )}
        {lastSummary && (
          <span className="fw-last-commit" data-testid="floating-last-commit" title={`Last change in ${lastWhere ?? 'timeline'}`}>
            Latest: <em>{lastSummary}</em> <span className="faint">({lastWhere})</span>
          </span>
        )}
      </div>

      <div className="fw-body">
        {/* Current resolved state & affiliations */}
        <div className="fw-state-box">
          <div className="row small" style={{ marginBottom: 4 }}>
            <strong className="faint">Current state (lasting)</strong>
            <span className="grow" />
            {scene && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                data-testid="floating-lasting-toggle"
                title="Record a permanent property change that carries forward to future chapters (e.g. status = dead)"
                onClick={() => setShowLasting(!showLasting)}
              >
                {showLasting ? 'Cancel lasting' : '+ Lasting change'}
              </button>
            )}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowProps(!showProps)}>
              {showProps ? 'Hide base props' : 'Base props'}
            </button>
          </div>
          <PropLines vault={vault} state={state} />
          <AffiliationChips entityId={entity.id} tp={effectiveTp} compact />
          {scene && showLasting && (
            <div className="stack small" data-testid="floating-lasting-box" style={{ marginTop: 8, paddingTop: 6, borderTop: '1px dashed var(--border)', gap: 4 }}>
              <span className="faint">Lasting state change (carries into future chapters):</span>
              <div className="row small">
                <input
                  className="input small grow"
                  placeholder="e.g. status = dead — Falls defending the inn"
                  aria-label="Lasting property change"
                  data-testid="floating-lasting-input"
                  value={lastingInput}
                  onChange={(e) => setLastingInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && lastingInput.trim()) {
                      e.preventDefault();
                      handleLastingChange();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  data-testid="floating-lasting-submit"
                  disabled={!lastingInput.trim()}
                  onClick={handleLastingChange}
                >
                  Save lasting
                </button>
              </div>
              <label className="row small faint" style={{ gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={attachToScene}
                  onChange={(e) => setAttachToScene(e.target.checked)}
                />
                <span>Attach to “{scene.title}” (uncheck to pin to {atLabel(r.clipEnd(scene.id))})</span>
              </label>
            </div>
          )}
          {scene && sceneCommits.length > 0 && (
            <div className="stack small" style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--border)', gap: 4 }}>
              <span className="faint">Lasting changes in “{scene.title}”:</span>
              {sceneCommits.map((c) => (
                <div key={c.id} className="row small" style={{ gap: 6 }}>
                  <span className="grow">
                    {c.op === 'set' && c.property ? (
                      <>
                        <code>{c.property}</code> = <strong>{formatValue(c.value)}</strong>
                        {c.message ? ` — ${c.message}` : ''}
                      </>
                    ) : (
                      <>Page revised{c.message ? ` — ${c.message}` : ''}</>
                    )}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    aria-label="Remove lasting change"
                    title="Remove this lasting change"
                    onClick={() => update((v) => deleteChange(v, c.id))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {showProps && (
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
              <div className="faint small" style={{ marginBottom: 4 }}>Starting properties:</div>
              <PropsEditor
                props={entity.props}
                onChange={(props) => useStore.getState().propose(`Change ${entity.name}’s starting properties`, updateEntity(useStore.getState().vault, entity.id, { props }))}
              />
            </div>
          )}
        </div>

        {/* Volatile Chapter / Scene Notes (default quick input — local to this chapter/scene, no future modal) */}
        {scene && (
          <div className="fw-commit-box" data-testid="floating-commit-box">
            <div className="row small" style={{ marginBottom: 4 }}>
              <strong className="faint">
                {chapterTitle ? `Notes in ${chapterTitle} (temporary)` : `Notes in “${scene.title}” (temporary)`}
              </strong>
              <span className="grow" />
              <span className="faint small">Local to this chapter</span>
            </div>
            <div className="row small">
              <input
                className="input small grow"
                placeholder={`Add note in “${scene.title}” (e.g. Suspicious, exhausted, carrying brass key)…`}
                aria-label="Add chapter or scene note"
                data-testid="floating-quick-commit"
                value={quickInput}
                onChange={(e) => setQuickInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && quickInput.trim()) {
                    e.preventDefault();
                    handleAddChapterNote();
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-sm btn-primary"
                data-testid="floating-quick-commit-submit"
                disabled={!quickInput.trim()}
                onClick={handleAddChapterNote}
              >
                + Note
              </button>
            </div>
            {chapterNotes.length > 0 && (
              <div className="stack small" data-testid="floating-scene-commits" style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--border)', gap: 4 }}>
                {chapterNotes.map((c) => {
                  const noteScene = c.sceneId ? vault.scenes[c.sceneId] : undefined;
                  return (
                    <div key={c.id} className="row small" style={{ gap: 6 }}>
                      <span className="grow">
                        • {c.message}
                        {noteScene && noteScene.id !== scene.id && (
                          <span className="faint"> ({noteScene.title})</span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        aria-label="Remove note"
                        title="Remove this note"
                        onClick={() => update((v) => deleteChange(v, c.id))}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Living Page / Notes */}
        <div className="fw-note-box">
          <div className="row small" style={{ marginBottom: 6 }}>
            <strong className="faint">
              {state.revision
                ? `Page (revised in ${changeWhere(vault, state.revision)})`
                : 'Base Wiki Page (origin)'}
            </strong>
            <span className="grow" />
            {(editingBase || editingPage || !scene) && !hasRevisions && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                title="Insert image into wiki note"
                onClick={() => {
                  void pickImageFile().then((img) => {
                    if (!img) return;
                    window.dispatchEvent(
                      new CustomEvent<InsertTextDetail>('lw:insert-text', {
                        detail: { text: `${img.markdown}\n`, targetEditorId: 'floating-wiki-editor' },
                      }),
                    );
                  });
                }}
              >
                + Image
              </button>
            )}
            {scene && !hasRevisions && !editingPage && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                data-testid="floating-edit-base"
                onClick={() => setEditingBase(!editingBase)}
                title="Edit the universal origin/backstory note that applies before any scene revisions"
              >
                {editingBase ? 'Done editing base' : 'Edit base page'}
              </button>
            )}
            {scene && !editingPage && (
              <button
                type="button"
                className="btn btn-sm"
                data-testid="floating-revise-page"
                onClick={startRevisePage}
                title={`Revise ${state.name}’s page from “${scene.title}” onward`}
              >
                Revise page in this scene…
              </button>
            )}
          </div>

          {editingPage ? (
            <div className="stack" data-testid="floating-revision-box">
              <Editor
                key={`rev:${entity.id}:${scene?.id ?? 'base'}`}
                value={draftNote}
                contextSceneId={scene?.id}
                testId="floating-revision-editor"
                editorId="floating-wiki-editor"
                placeholder={`How ${state.name}’s page reads from “${scene?.title ?? 'here'}” onward… (supports [[wikilinks]] and #tags)`}
                onChange={(note) => setDraftNote(note)}
              />
              {scene && (
                <input
                  className="input small"
                  placeholder="Revision summary (optional, e.g. Learns the secret of Ashford)"
                  data-testid="floating-revision-message"
                  value={draftMsg}
                  onChange={(e) => setDraftMsg(e.target.value)}
                />
              )}
              <div className="row">
                <span className="small faint grow">
                  {scene ? `Takes effect in “${scene.title}”` : 'Base page'}
                </span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditingPage(false)}>
                  Cancel
                </button>
                <button type="button" className="btn btn-sm btn-primary" data-testid="floating-revision-save" onClick={savePageRevision}>
                  Save revision
                </button>
              </div>
            </div>
          ) : !hasRevisions && (editingBase || !scene) ? (
            <Editor
              key={entity.id}
              value={entity.note}
              testId="floating-note-editor"
              editorId="floating-wiki-editor"
              placeholder="Write character/world notes… (updates base page; click 'Revise page in this scene' to branch by time)"
              onChange={(note) => update((v) => updateEntity(v, entity.id, { note }), `note:${entity.id}`)}
            />
          ) : (
            <div onDoubleClick={startRevisePage} title="Double-click to revise page at this scene">
              <Markdown text={state.note} contextSceneId={scene?.id} testId="floating-note-preview" />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
