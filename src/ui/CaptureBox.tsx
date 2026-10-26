// Quick capture (Ctrl+Shift+Space) & Idea Queue:
// - CaptureBox: a quick box over whatever is on screen. Enter files the idea in the Inbox page and closes the box;
//   focus goes back to where it was, so the caret and scroll of the scene being written do not move.
// - IdeaQueueView / IdeaQueueDialog: an interactive flashcard/deck and list interface for shuffling ideas, inspecting
//   rendered Living Writing syntax vs raw code (`[[Entity@time]]`, `#tags`, `![[embeds]]`, author notes), marking
//   ideas done (`- [x]`), and graduating them into Someday scenes, Wiki entities, StateChange commits, or Milestones.

import { useEffect, useMemo, useRef, useState } from 'react';
import { findAuthorNotesOutsideCode, findScene } from '../core/links';
import type { Id } from '../core/types';
import { sortedStories, sortedTypes } from '../store/actions';
import {
  appendCapture,
  clearDoneIdeas,
  INBOX_NAME,
  inboxCount,
  inboxOf,
  isInboxPage,
  parseIdeas,
  pickRandomIdeaIndex,
  promoteIdeaToCommit,
  promoteIdeaToEntity,
  promoteIdeaToMilestone,
  promoteIdeaToScene,
  removeIdea,
  toggleIdeaDone,
  updateIdeaText,
  type IdeaItem,
} from '../store/inbox';
import { getGraph, useStore, useVault } from '../store/store';
import { Markdown } from './Markdown';
import './impact.css';

export const OPEN_CAPTURE_EVENT = 'lw:capture';
export const OPEN_IDEA_QUEUE_EVENT = 'lw:idea-queue';

export function InboxBadge() {
  const count = useStore((s) => inboxCount(s.vault));
  const totalCount = useStore((s) => {
    const inbox = inboxOf(s.vault);
    return inbox ? parseIdeas(inbox.note).length : 0;
  });
  if (totalCount === 0) return null;
  return (
    <button
      className="btn btn-sm"
      title="Quick captures waiting in the Idea Queue / Inbox page (Click to open, Shift+Click for quick deck)"
      data-testid="inbox-badge"
      onClick={(e) => {
        if (e.shiftKey) {
          window.dispatchEvent(new Event(OPEN_IDEA_QUEUE_EVENT));
          return;
        }
        const inbox = inboxOf(useStore.getState().vault);
        if (inbox) useStore.getState().navigate({ kind: 'entity', id: inbox.id });
      }}
    >
      Inbox ({count})
    </button>
  );
}

type PromoteAction = 'scene' | 'entity' | 'commit' | 'milestone' | null;

export function IdeaQueueSection({ entityId }: { entityId: Id }) {
  const vault = useVault();
  if (!isInboxPage(vault, entityId)) return null;
  return (
    <section className="panel idea-queue-panel" data-testid="idea-queue-panel">
      <IdeaQueueDeck />
    </section>
  );
}

export function IdeaQueueDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener(OPEN_IDEA_QUEUE_EVENT, show);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_IDEA_QUEUE_EVENT, show);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal impact-modal idea-queue-modal" role="dialog" aria-modal="true" aria-label="Idea Queue" data-testid="idea-queue-dialog">
        <IdeaQueueDeck onCloseModal={() => setOpen(false)} />
      </div>
    </div>
  );
}

function IdeaQueueDeck({ onCloseModal }: { onCloseModal?: () => void }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const view = useStore((s) => s.view);
  const inbox = inboxOf(vault);
  const allIdeas = useMemo(() => (inbox ? parseIdeas(inbox.note) : []), [inbox]);
  const activeIdeas = useMemo(() => allIdeas.filter((i) => !i.done), [allIdeas]);
  const doneCount = allIdeas.length - activeIdeas.length;

  const [mode, setMode] = useState<'deck' | 'list'>('deck');
  const [showDone, setShowDone] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [quickInput, setQuickInput] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [promoteKind, setPromoteKind] = useState<PromoteAction>(null);

  // Promotion form state
  const [sceneTitle, setSceneTitle] = useState('');
  const [sceneTarget, setSceneTarget] = useState<'someday' | 'current'>('someday');
  const [entityName, setEntityName] = useState('');
  const [entityTypeId, setEntityTypeId] = useState<Id>('');
  const [appendEntityId, setAppendEntityId] = useState<Id>('');
  const [commitEntityId, setCommitEntityId] = useState<Id>('');
  const [commitInput, setCommitInput] = useState('');
  const [milestoneLabel, setMilestoneLabel] = useState('');
  const [milestoneConcrete, setMilestoneConcrete] = useState('');

  const candidateList = showDone ? allIdeas : activeIdeas;
  const candidateIndices = useMemo(() => candidateList.map((i) => i.index), [candidateList]);

  const effectiveIndex = useMemo(() => {
    if (candidateIndices.length === 0) return null;
    if (candidateIndices.includes(currentIdx)) return currentIdx;
    return candidateIndices[0];
  }, [candidateIndices, currentIdx]);

  const currentIdea: IdeaItem | undefined = effectiveIndex !== null ? allIdeas[effectiveIndex] : undefined;
  const posInCandidates = effectiveIndex !== null ? candidateIndices.indexOf(effectiveIndex) : -1;

  const selectIdea = (idx: number) => {
    setCurrentIdx(idx);
    setEditingIndex(null);
    setPromoteKind(null);
  };

  const shuffleIdea = () => {
    const next = pickRandomIdeaIndex(candidateIndices, effectiveIndex);
    if (next !== null) selectIdea(next);
  };

  const stepIdea = (delta: 1 | -1) => {
    if (candidateIndices.length === 0) return;
    const nextPos = (Math.max(0, posInCandidates) + delta + candidateIndices.length) % candidateIndices.length;
    selectIdea(candidateIndices[nextPos]);
  };

  const handleQuickAdd = () => {
    const trimmed = quickInput.trim();
    if (!trimmed) return;
    const s = useStore.getState();
    const scene = s.view.kind === 'scene' ? s.vault.scenes[s.view.id] : undefined;
    const next = appendCapture(s.vault, trimmed, new Date(), scene?.title);
    if (next !== s.vault) {
      s.commit(next, undefined, 'Add idea to queue');
      const updatedInbox = inboxOf(next);
      const updatedIdeas = updatedInbox ? parseIdeas(updatedInbox.note) : [];
      if (updatedIdeas.length > 0) {
        setCurrentIdx(updatedIdeas[updatedIdeas.length - 1].index);
      }
    }
    setQuickInput('');
  };

  const handleToggleDone = (item: IdeaItem) => {
    const s = useStore.getState();
    const next = toggleIdeaDone(s.vault, item.index);
    if (next !== s.vault) {
      s.commit(next, undefined, item.done ? 'Reopen idea' : 'Mark idea done');
      s.toast('info', item.done ? 'Idea reopened in queue.' : 'Idea marked done.');
    }
  };

  const handleDelete = (item: IdeaItem) => {
    const s = useStore.getState();
    const next = removeIdea(s.vault, item.index);
    if (next !== s.vault) {
      s.commit(next, undefined, 'Remove idea from queue');
      setEditingIndex(null);
      setPromoteKind(null);
    }
  };

  const handleSaveEdit = (item: IdeaItem) => {
    const s = useStore.getState();
    const next = updateIdeaText(s.vault, item.index, editDraft);
    if (next !== s.vault) {
      s.commit(next, undefined, 'Edit idea');
    }
    setEditingIndex(null);
  };

  const handleClearDone = () => {
    const s = useStore.getState();
    const next = clearDoneIdeas(s.vault);
    if (next !== s.vault) {
      s.commit(next, undefined, 'Clear done ideas');
      s.toast('info', 'Cleared completed ideas.');
    }
  };

  const openPromote = (kind: PromoteAction, item: IdeaItem) => {
    if (promoteKind === kind) {
      setPromoteKind(null);
      return;
    }
    setPromoteKind(kind);
    const firstLine = item.text
      .split(/\r?\n/)[0]
      ?.replace(/^[#>*-\s]+/, '')
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => alias || target)
      .trim()
      .slice(0, 48);

    if (kind === 'scene') {
      setSceneTitle(firstLine || 'New scene');
      setSceneTarget(view.kind === 'scene' && vault.scenes[view.id] ? 'current' : 'someday');
    } else if (kind === 'entity') {
      setEntityName(firstLine || 'New entity');
      const types = sortedTypes(vault).filter((t) => t.name !== INBOX_NAME);
      setEntityTypeId(types[0]?.id ?? '');
      setAppendEntityId('');
    } else if (kind === 'commit') {
      const entities = Object.values(vault.entities)
        .filter((e) => e.id !== inbox?.id)
        .sort((a, b) => a.name.localeCompare(b.name));
      setCommitEntityId(entities[0]?.id ?? '');
      setCommitInput(item.text);
    } else if (kind === 'milestone') {
      setMilestoneLabel(firstLine || 'New milestone');
      setMilestoneConcrete('');
    }
  };

  const executePromote = (item: IdeaItem) => {
    const s = useStore.getState();
    if (promoteKind === 'scene') {
      const appendId = sceneTarget === 'current' && s.view.kind === 'scene' ? s.view.id : undefined;
      const res = promoteIdeaToScene(s.vault, item.index, {
        title: sceneTitle,
        storyId: s.currentStoryId ?? sortedStories(s.vault)[0]?.id,
        appendToSceneId: appendId,
      });
      if (res) {
        s.commit(res.vault, undefined, appendId ? 'Insert idea into scene' : 'Promote idea to Someday scene');
        s.toast('info', appendId ? 'Inserted idea into current scene.' : `Created Someday scene “${res.vault.scenes[res.sceneId]?.title}”.`);
        setPromoteKind(null);
        s.navigate({ kind: 'scene', id: res.sceneId });
        onCloseModal?.();
      }
    } else if (promoteKind === 'entity') {
      const res = promoteIdeaToEntity(s.vault, item.index, {
        name: entityName,
        typeId: entityTypeId || undefined,
        appendToEntityId: appendEntityId || undefined,
      });
      if (res) {
        s.commit(res.vault, undefined, appendEntityId ? 'Append idea to entity' : 'Promote idea to entity');
        s.toast('info', appendEntityId ? `Appended idea to “${res.vault.entities[res.entityId]?.name}”.` : `Created entity “${res.vault.entities[res.entityId]?.name}”.`);
        setPromoteKind(null);
        s.navigate({ kind: 'entity', id: res.entityId });
        onCloseModal?.();
      }
    } else if (promoteKind === 'commit') {
      if (!commitEntityId) return;
      const fromScene = item.fromSceneTitle ? findScene(s.vault, item.fromSceneTitle) : undefined;
      const activeSceneId = s.view.kind === 'scene' ? s.view.id : fromScene?.id;
      const res = promoteIdeaToCommit(s.vault, item.index, {
        entityId: commitEntityId,
        sceneId: activeSceneId,
        at: Math.floor(s.playhead),
        overrideInput: commitInput,
      });
      if (res) {
        s.commit(res.vault, undefined, 'Promote idea to state change');
        s.toast('info', `Recorded state change on ${res.vault.entities[commitEntityId]?.name}.`);
        setPromoteKind(null);
      }
    } else if (promoteKind === 'milestone') {
      const res = promoteIdeaToMilestone(s.vault, item.index, {
        label: milestoneLabel,
        concrete: milestoneConcrete || undefined,
      });
      if (!res.ok) {
        s.toast('error', res.error);
        return;
      }
      s.commit(res.vault, undefined, 'Promote idea to milestone');
      s.revealColumn(getGraph(res.vault).layerOf(res.momentId));
      s.toast('info', `Added milestone “${milestoneLabel}” on the timeline.`);
      setPromoteKind(null);
    }
  };

  const authorNotesInCurrent = useMemo(
    () => (currentIdea ? findAuthorNotesOutsideCode(currentIdea.text) : []),
    [currentIdea],
  );

  const originScene = useMemo(
    () => (currentIdea?.fromSceneTitle ? findScene(vault, currentIdea.fromSceneTitle) : undefined),
    [vault, currentIdea],
  );

  return (
    <div className="idea-queue-wrap" data-testid="idea-queue">
      <div className="panel-head idea-queue-head">
        <span className="idea-queue-title">
          Idea Queue
          <span className="faint small" style={{ marginLeft: 8 }} data-testid="idea-queue-counts">
            {activeIdeas.length} active{doneCount > 0 ? ` · ${doneCount} done` : ''}
          </span>
        </span>
        <span className="grow" />
        <div className="row" style={{ gap: 6 }}>
          <button
            type="button"
            className="btn btn-sm"
            data-testid="idea-shuffle"
            disabled={candidateIndices.length < 2}
            title="Pick a random idea from the queue"
            onClick={shuffleIdea}
          >
            ⇄ Shuffle
          </button>
          <button
            type="button"
            className={`btn btn-sm ${showCode ? 'active' : 'btn-ghost'}`}
            data-testid="idea-toggle-code"
            title="Toggle between rendered Living Writing syntax and raw Markdown / code"
            onClick={() => setShowCode(!showCode)}
          >
            {showCode ? 'Preview' : '</> Code'}
          </button>
          <button
            type="button"
            className={`btn btn-sm ${mode === 'deck' ? 'active' : 'btn-ghost'}`}
            data-testid="idea-mode-deck"
            onClick={() => setMode('deck')}
          >
            Deck
          </button>
          <button
            type="button"
            className={`btn btn-sm ${mode === 'list' ? 'active' : 'btn-ghost'}`}
            data-testid="idea-mode-list"
            onClick={() => setMode('list')}
          >
            List ({candidateList.length})
          </button>
          {doneCount > 0 && (
            <button
              type="button"
              className={`btn btn-sm ${showDone ? 'active' : 'btn-ghost'}`}
              data-testid="idea-toggle-done-filter"
              onClick={() => setShowDone(!showDone)}
            >
              {showDone ? 'Hide done' : `Show done (${doneCount})`}
            </button>
          )}
          {onCloseModal && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onCloseModal} aria-label="Close Idea Queue">
              ×
            </button>
          )}
        </div>
      </div>

      <div className="panel-body stack idea-queue-body">
        <div className="row idea-quick-add">
          <input
            className="input grow"
            type="text"
            placeholder="Drop a quick idea… Supports [[Entity@time]], #tags, ![[embeds]], // notes"
            aria-label="Quick add idea"
            data-testid="idea-quick-input"
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleQuickAdd();
              }
            }}
          />
          <button type="button" className="btn btn-sm btn-primary" data-testid="idea-quick-submit" onClick={handleQuickAdd}>
            + Queue
          </button>
        </div>

        {candidateList.length === 0 ? (
          <div className="faint small idea-empty" data-testid="idea-empty">
            {allIdeas.length === 0
              ? 'No ideas in the queue yet. Press Ctrl+Shift+Space anytime while writing, or type above to drop one in.'
              : 'All queued ideas are marked done! Toggle "Show done" to review or reopen them.'}
          </div>
        ) : mode === 'deck' && currentIdea ? (
          <div className={`idea-card ${currentIdea.done ? 'is-done' : ''}`} data-testid="idea-card" data-done={currentIdea.done}>
            <div className="row small muted idea-card-meta">
              <span className="idea-card-pos" data-testid="idea-card-pos">
                Idea {posInCandidates + 1} of {candidateIndices.length}
              </span>
              {currentIdea.timestamp && <span>· {currentIdea.timestamp}</span>}
              {currentIdea.fromSceneTitle && (
                <span>
                  · from{' '}
                  {originScene ? (
                    <a
                      href="#"
                      data-testid="idea-origin-link"
                      onClick={(e) => {
                        e.preventDefault();
                        navigate({ kind: 'scene', id: originScene.id });
                        onCloseModal?.();
                      }}
                    >
                      {currentIdea.fromSceneTitle}
                    </a>
                  ) : (
                    <span>[[{currentIdea.fromSceneTitle}]]</span>
                  )}
                </span>
              )}
              {currentIdea.done && <span className="idea-done-pill">✓ Done</span>}
              <span className="grow" />
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={candidateIndices.length < 2}
                onClick={() => stepIdea(-1)}
                title="Previous idea"
                data-testid="idea-prev"
              >
                ← Prev
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={candidateIndices.length < 2}
                onClick={() => stepIdea(1)}
                title="Next idea"
                data-testid="idea-next"
              >
                Next →
              </button>
            </div>

            {editingIndex === currentIdea.index ? (
              <div className="stack" style={{ marginTop: 8 }}>
                <textarea
                  className="input"
                  rows={4}
                  autoFocus
                  aria-label="Edit idea markdown"
                  data-testid="idea-edit-textarea"
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                />
                <div className="row">
                  <span className="faint small">Supports multi-line Markdown, `[[links]]`, `#tags`, and fenced code blocks.</span>
                  <span className="grow" />
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditingIndex(null)}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-sm btn-primary" data-testid="idea-edit-save" onClick={() => handleSaveEdit(currentIdea)}>
                    Save idea
                  </button>
                </div>
              </div>
            ) : showCode ? (
              <pre className="idea-code-block" data-testid="idea-code-view">
                <code>{currentIdea.text}</code>
              </pre>
            ) : (
              <div className="idea-rendered-body" data-testid="idea-rendered-view">
                <Markdown text={currentIdea.text} contextSceneId={originScene?.id} />
                {authorNotesInCurrent.length > 0 && (
                  <div className="idea-author-notes small" data-testid="idea-author-notes">
                    {authorNotesInCurrent.map((n, idx) => (
                      <div key={idx} className="idea-author-note-chip">
                        <span className="faint">// Author note:</span> {n.text}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="row idea-card-actions" style={{ marginTop: 10, flexWrap: 'wrap', gap: 6 }}>
              <button
                type="button"
                className={`btn btn-sm ${currentIdea.done ? 'active' : ''}`}
                data-testid="idea-mark-done"
                onClick={() => handleToggleDone(currentIdea)}
              >
                {currentIdea.done ? '↺ Reopen' : '✓ Done'}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                data-testid="idea-edit-btn"
                onClick={() => {
                  setEditingIndex(currentIdea.index);
                  setEditDraft(currentIdea.text);
                }}
              >
                ✎ Edit syntax
              </button>
              <span className="faint small" style={{ margin: '0 4px' }}>
                Graduate to:
              </span>
              <button
                type="button"
                className={`btn btn-sm ${promoteKind === 'scene' ? 'active' : 'btn-ghost'}`}
                data-testid="idea-promote-scene-btn"
                onClick={() => openPromote('scene', currentIdea)}
              >
                ¶ Scene…
              </button>
              <button
                type="button"
                className={`btn btn-sm ${promoteKind === 'entity' ? 'active' : 'btn-ghost'}`}
                data-testid="idea-promote-entity-btn"
                onClick={() => openPromote('entity', currentIdea)}
              >
                ◆ Wiki Entity…
              </button>
              <button
                type="button"
                className={`btn btn-sm ${promoteKind === 'commit' ? 'active' : 'btn-ghost'}`}
                data-testid="idea-promote-commit-btn"
                onClick={() => openPromote('commit', currentIdea)}
              >
                Δ State Change…
              </button>
              <button
                type="button"
                className={`btn btn-sm ${promoteKind === 'milestone' ? 'active' : 'btn-ghost'}`}
                data-testid="idea-promote-milestone-btn"
                onClick={() => openPromote('milestone', currentIdea)}
              >
                🏷 Milestone…
              </button>
              <span className="grow" />
              <button
                type="button"
                className="btn btn-sm btn-ghost btn-danger"
                data-testid="idea-delete-btn"
                onClick={() => handleDelete(currentIdea)}
              >
                Delete
              </button>
            </div>

            {promoteKind && (
              <div className="idea-promote-drawer stack" data-testid="idea-promote-drawer">
                {promoteKind === 'scene' && (
                  <>
                    <div className="row small" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <label className="row" style={{ gap: 4 }}>
                        <input
                          type="radio"
                          name="sceneTarget"
                          checked={sceneTarget === 'someday'}
                          onChange={() => setSceneTarget('someday')}
                        />
                        New Someday (unplaced) scene
                      </label>
                      {view.kind === 'scene' && vault.scenes[view.id] && (
                        <label className="row" style={{ gap: 4 }}>
                          <input
                            type="radio"
                            name="sceneTarget"
                            checked={sceneTarget === 'current'}
                            onChange={() => setSceneTarget('current')}
                          />
                          Append to current scene (“{vault.scenes[view.id]?.title}”)
                        </label>
                      )}
                    </div>
                    {sceneTarget === 'someday' && (
                      <input
                        className="input small"
                        placeholder="Scene title"
                        aria-label="Scene title"
                        data-testid="idea-promote-scene-title"
                        value={sceneTitle}
                        onChange={(e) => setSceneTitle(e.target.value)}
                      />
                    )}
                  </>
                )}

                {promoteKind === 'entity' && (
                  <div className="row small" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <input
                      className="input small grow"
                      placeholder="New entity name"
                      aria-label="Entity name"
                      data-testid="idea-promote-entity-name"
                      disabled={Boolean(appendEntityId)}
                      value={entityName}
                      onChange={(e) => setEntityName(e.target.value)}
                    />
                    <select
                      className="select small"
                      aria-label="Entity type"
                      disabled={Boolean(appendEntityId)}
                      value={entityTypeId}
                      onChange={(e) => setEntityTypeId(e.target.value)}
                    >
                      {sortedTypes(vault)
                        .filter((t) => t.name !== INBOX_NAME)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                    <select
                      className="select small"
                      aria-label="Or append to existing entity"
                      data-testid="idea-promote-entity-append"
                      value={appendEntityId}
                      onChange={(e) => setAppendEntityId(e.target.value)}
                    >
                      <option value="">— Or append to existing entity —</option>
                      {Object.values(vault.entities)
                        .filter((e) => e.id !== inbox?.id)
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            Append to {e.name}
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                {promoteKind === 'commit' && (
                  <div className="row small" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <select
                      className="select small"
                      aria-label="Target entity for state change"
                      data-testid="idea-promote-commit-entity"
                      value={commitEntityId}
                      onChange={(e) => setCommitEntityId(e.target.value)}
                    >
                      {Object.values(vault.entities)
                        .filter((e) => e.id !== inbox?.id)
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                    </select>
                    <input
                      className="input small grow"
                      placeholder="e.g. status = dead — Falls at the bridge, or a note"
                      aria-label="Quick commit expression"
                      data-testid="idea-promote-commit-input"
                      value={commitInput}
                      onChange={(e) => setCommitInput(e.target.value)}
                    />
                  </div>
                )}

                {promoteKind === 'milestone' && (
                  <div className="row small" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <input
                      className="input small grow"
                      placeholder="Milestone label (e.g. The Fall of Ashford)"
                      aria-label="Milestone label"
                      data-testid="idea-promote-milestone-label"
                      value={milestoneLabel}
                      onChange={(e) => setMilestoneLabel(e.target.value)}
                    />
                    <input
                      className="input small"
                      placeholder="Concrete date (optional, e.g. Autumn, 2026)"
                      aria-label="Milestone concrete date"
                      data-testid="idea-promote-milestone-concrete"
                      value={milestoneConcrete}
                      onChange={(e) => setMilestoneConcrete(e.target.value)}
                    />
                  </div>
                )}

                <div className="row">
                  <span className="faint small">Graduating removes the idea from the queue (Ctrl+Z undoes).</span>
                  <span className="grow" />
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPromoteKind(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    data-testid="idea-promote-confirm"
                    onClick={() => executePromote(currentIdea)}
                  >
                    Confirm & graduate
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <ul className="idea-list" data-testid="idea-list">
            {candidateList.map((item) => {
              const itemOrigin = item.fromSceneTitle ? findScene(vault, item.fromSceneTitle) : undefined;
              return (
                <li key={item.index} className={`idea-list-row ${item.done ? 'is-done' : ''}`} data-testid="idea-list-item" data-done={item.done}>
                  <input
                    type="checkbox"
                    checked={item.done}
                    aria-label="Mark idea done"
                    data-testid="idea-list-checkbox"
                    onChange={() => handleToggleDone(item)}
                  />
                  <div
                    className="idea-list-content grow"
                    onClick={() => {
                      selectIdea(item.index);
                      setMode('deck');
                    }}
                  >
                    {showCode ? (
                      <code className="idea-inline-code">{item.text}</code>
                    ) : (
                      <Markdown text={item.text} contextSceneId={itemOrigin?.id} />
                    )}
                    <div className="faint small">
                      {item.timestamp && <span>{item.timestamp}</span>}
                      {item.fromSceneTitle && <span> · from {item.fromSceneTitle}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      selectIdea(item.index);
                      setMode('deck');
                    }}
                  >
                    Inspect
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => handleDelete(item)}>
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {doneCount > 0 && (
          <div className="row small muted" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-sm btn-ghost" data-testid="idea-clear-done" onClick={handleClearDone}>
              Clear {doneCount} done {doneCount === 1 ? 'idea' : 'ideas'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function CaptureBox() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const before = useRef<HTMLElement | null>(null);

  const close = () => {
    setOpen(false);
    setText('');
    const back = before.current;
    before.current = null;
    // Not scrolled into view: the page is exactly as it was.
    if (back?.isConnected) back.focus({ preventScroll: true });
  };

  useEffect(() => {
    const show = () => {
      before.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    };
    window.addEventListener(OPEN_CAPTURE_EVENT, show);
    return () => window.removeEventListener(OPEN_CAPTURE_EVENT, show);
  }, []);

  if (!open) return null;

  const file = () => {
    const s = useStore.getState();
    const scene = s.view.kind === 'scene' ? s.vault.scenes[s.view.id] : undefined;
    const next = appendCapture(s.vault, text, new Date(), scene?.title);
    if (next !== s.vault) {
      s.commit(next, undefined, 'Quick capture');
      s.toast('info', 'Captured in the Idea Queue (Inbox).');
    }
    close();
  };

  return (
    <div className="modal-backdrop capture-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal capture-modal" role="dialog" aria-modal="true" aria-label="Quick capture" data-testid="capture-box">
        <input
          className="input"
          autoFocus
          placeholder="Capture an idea for the queue (supports [[links]], #tags, // notes). Enter files it"
          aria-label="Quick capture"
          data-testid="capture-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              file();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
        />
      </div>
    </div>
  );
}

