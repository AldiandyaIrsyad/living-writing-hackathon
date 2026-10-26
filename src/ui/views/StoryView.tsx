// Story screen: edit the name and colour, manage arcs and chapters, and list scenes in telling order.

import { useMemo, useState, type FormEvent } from 'react';
import { momentConcrete } from '../../core/concrete';
import type { Resolver } from '../../core/resolve';
import type { Arc, Chapter, Id, Scene, StateChange } from '../../core/types';
import { insertScene } from '../../core/timeline';
import { formatCount, readingMinutes, storyWordCounts } from '../../core/wordcount';
import {
  addArc,
  addChapter,
  addChapterLabel,
  arcsOfStory,
  chaptersOfStory,
  deleteArc,
  deleteChapter,
  removeChapterLabel,
  scenesOfStory,
  setChapterArc,
  shiftSceneOrder,
  updateArc,
  updateChapter,
  updateStory,
} from '../../store/actions';
import { getGraph, getResolver, update, useStore, useVault } from '../../store/store';
import './views.css';

export function StoryView({ id }: { id: string }) {
  // Keyed so local drafts reset when the route moves to another story.
  return <StoryPage key={id} storyId={id} />;
}

function StoryPage({ storyId }: { storyId: Id }) {
  const vault = useVault();
  const [chapterTitle, setChapterTitle] = useState('');
  const [arcTitle, setArcTitle] = useState('');
  const changeCounts = useMemo(() => countChanges(getResolver(vault), vault.changes), [vault]);
  const wordCounts = useMemo(() => storyWordCounts(vault, storyId), [vault, storyId]);

  const story = vault.stories[storyId];
  if (!story) {
    return (
      <div className="view view-narrow">
        <div className="empty">This story no longer exists.</div>
      </div>
    );
  }

  const arcs = arcsOfStory(vault, storyId);
  const chapters = chaptersOfStory(vault, storyId);
  const scenes = scenesOfStory(vault, storyId);
  const positions = new Map<Id, number>(scenes.map((s, i): [Id, number] => [s.id, i]));

  const submitChapter = (e: FormEvent) => {
    e.preventDefault();
    const title = chapterTitle.trim();
    if (!title) return;
    update((v) => addChapter(v, storyId, title).vault);
    setChapterTitle('');
  };

  const submitArc = (e: FormEvent) => {
    e.preventDefault();
    const title = arcTitle.trim();
    if (!title) return;
    update((v) => addArc(v, storyId, title).vault);
    setArcTitle('');
  };

  const renderGroup = (group: SceneGroup) => (
    <section key={group.key} className="scene-group">
      <h3 className="scene-group-title">{group.title}</h3>
      {group.scenes.length > 0 ? (
        <ul className="scene-list">
          {group.scenes.map((s) => {
            const position = positions.get(s.id) ?? 0;
            return (
              <SceneRow
                key={s.id}
                scene={s}
                number={position + 1}
                isFirst={position === 0}
                isLast={position === scenes.length - 1}
                momentLabel={momentConcrete(vault.moments[s.momentId])}
                changes={changeCounts.get(s.id) ?? 0}
              />
            );
          })}
        </ul>
      ) : (
        <p className="muted small scene-empty">No scenes in this group yet.</p>
      )}
    </section>
  );

  const createScene = () => {
    const store = useStore.getState();
    const current = store.vault;
    const graph = getGraph(current);
    // New scenes go after the story's chronologically latest scene; a story with none gets a floating one.
    const latest = scenesOfStory(current, storyId).reduce<Scene | undefined>(
      (best, s) => (!best || graph.topoIndex(s.momentId) > graph.topoIndex(best.momentId) ? s : best),
      undefined,
    );
    const created = insertScene(current, { storyId, title: 'Untitled scene' }, latest ? 'after' : null, latest?.id ?? null);
    store.commit(created.vault);
    store.navigate({ kind: 'scene', id: created.sceneId });
  };

  const groupsByArc = arcs.length > 0 ? groupByArc(arcs, chapters, scenes) : null;
  const flatGroups = groupsByArc ? [] : groupByChapter(chapters, scenes);

  const barRows = [
    ...chapters.map((c) => ({ key: c.id, title: c.title || 'Untitled chapter', words: wordCounts.byChapter.get(c.id) ?? 0 })),
    ...(wordCounts.byChapter.has(null) ? [{ key: 'no-chapter', title: 'No chapter', words: wordCounts.byChapter.get(null) ?? 0 }] : []),
  ];
  const barMax = Math.max(1, ...barRows.map((r) => r.words));

  return (
    <div className="view view-narrow">
      <header className="view-header story-head">
        <span className="dot" style={{ background: story.color }} />
        <InlineText
          className="view-title"
          label="Story name"
          value={story.name}
          onCommit={(name) => update((v) => updateStory(v, storyId, { name }))}
        />
        <input
          type="color"
          className="color-input"
          aria-label="Story colour"
          value={story.color}
          onChange={(e) => {
            const color = e.target.value;
            update((v) => updateStory(v, storyId, { color }), `story-color:${storyId}`);
          }}
        />
      </header>

      <section className="story-stats" data-testid="story-words" aria-label="Word counts">
        <div className="story-stats-main">
          <StatCell label="words" value={formatCount(wordCounts.total)} />
          <StatCell label="reading" value={`${readingMinutes(wordCounts.total)} min`} />
          <StatCell label="chapters" value={formatCount(chapters.length)} />
          <StatCell label="scenes" value={formatCount(scenes.length)} />
        </div>
        {barRows.length > 0 && (
          <ul className="story-bars" aria-label="Words per chapter">
            {barRows.map((row) => (
              <li key={row.key} className="story-bar-row">
                <span className="story-bar-name" title={row.title}>
                  {row.title}
                </span>
                <span className="story-bar-track" aria-hidden="true">
                  <span className="story-bar-fill" style={{ width: `${(row.words / barMax) * 100}%` }} />
                </span>
                <span className="story-bar-num">{formatCount(row.words)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="section-title">Arcs</div>
      {arcs.length > 0 ? (
        <ul className="list arc-list">
          {arcs.map((arc) => (
            <li key={arc.id} className="chapter-row">
              <InlineText
                className="input grow"
                label="Arc title"
                value={arc.title}
                onCommit={(title) => update((v) => updateArc(v, arc.id, { title }))}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-danger"
                aria-label={`Delete arc ${arc.title}`}
                onClick={() => update((v) => deleteArc(v, arc.id))}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No arcs yet. Arcs group consecutive chapters into larger parts.</p>
      )}
      <form className="row wrap add-arc" onSubmit={submitArc}>
        <input
          className="input grow"
          data-testid="new-arc-title"
          aria-label="New arc title"
          placeholder="New arc title"
          value={arcTitle}
          onChange={(e) => setArcTitle(e.target.value)}
        />
        <button type="submit" className="btn" data-testid="add-arc" disabled={!arcTitle.trim()}>
          Add arc
        </button>
      </form>

      <div className="section-title">Chapters</div>
      {chapters.length > 0 ? (
        <ul className="list chapter-list">
          {chapters.map((ch) => (
            <li key={ch.id} className="chapter-row">
              <InlineText
                className="input grow"
                label="Chapter title"
                value={ch.title}
                onCommit={(title) => update((v) => updateChapter(v, ch.id, { title }))}
              />
              {(ch.labels ?? []).map((lbl) => (
                <span key={lbl} className="badge" data-testid="story-chapter-label">
                  🏷 {lbl}{' '}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-label={`Remove label ${lbl} from ${ch.title}`}
                    onClick={() => update((v) => removeChapterLabel(v, ch.id, lbl))}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                title="Add an event Label bookmark to this chapter"
                aria-label={`Add label to ${ch.title}`}
                onClick={() => {
                  const lbl = window.prompt(`Add Label to ${ch.title} (e.g. The Death of Hero Nora):`)?.trim();
                  if (lbl) update((v) => addChapterLabel(v, ch.id, lbl));
                }}
              >
                + Label
              </button>
              <select
                className="input"
                aria-label="Arc"
                value={ch.arcId ?? ''}
                onChange={(e) => {
                  const arcId = e.target.value === '' ? null : e.target.value;
                  update((v) => setChapterArc(v, ch.id, arcId));
                }}
              >
                <option value="">No arc</option>
                {arcs.map((arc) => (
                  <option key={arc.id} value={arc.id}>
                    {arc.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-danger"
                aria-label={`Delete chapter ${ch.title}`}
                onClick={() => update((v) => deleteChapter(v, ch.id))}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No chapters yet. Scenes can exist without one.</p>
      )}
      <form className="row wrap add-chapter" onSubmit={submitChapter}>
        <input
          className="input grow"
          aria-label="New chapter title"
          placeholder="New chapter title"
          value={chapterTitle}
          onChange={(e) => setChapterTitle(e.target.value)}
        />
        <button type="submit" className="btn" data-testid="add-chapter" disabled={!chapterTitle.trim()}>
          Add chapter
        </button>
      </form>

      <div className="section-head">
        <h2 className="section-title">Scenes</h2>
        <button type="button" className="btn btn-primary btn-sm" data-testid="new-scene" onClick={createScene}>
          New scene
        </button>
      </div>

      {groupsByArc
        ? groupsByArc.map((arc) => (
            <section key={arc.key} className="arc-group">
              <h3 className="arc-group-title">{arc.title}</h3>
              {arc.groups.length > 0 ? (
                arc.groups.map(renderGroup)
              ) : (
                <p className="muted small scene-empty">No chapters in this arc yet.</p>
              )}
            </section>
          ))
        : flatGroups.map(renderGroup)}
      {scenes.length === 0 && <p className="empty">No scenes yet. Create the first one.</p>}
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="story-stat">
      <span className="story-stat-value">{value}</span>
      <span className="story-stat-label">{label}</span>
    </div>
  );
}

function SceneRow({
  scene,
  number,
  isFirst,
  isLast,
  momentLabel,
  changes,
}: {
  scene: Scene;
  number: number;
  isFirst: boolean;
  isLast: boolean;
  momentLabel: string | undefined;
  changes: number;
}) {
  const navigate = useStore((s) => s.navigate);
  return (
    <li className="scene-row">
      <button type="button" className="scene-open" onClick={() => navigate({ kind: 'scene', id: scene.id })}>
        <span className="scene-num">{number}</span>
        <span className="scene-title">{scene.title || 'Untitled scene'}</span>
        {momentLabel && <span className="badge">{momentLabel}</span>}
        {(scene.labels ?? []).map((lbl) => (
          <span key={lbl} className="badge">
            🏷 {lbl}
          </span>
        ))}
        <span className="muted small">
          {changes} {changes === 1 ? 'change' : 'changes'}
        </span>
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-label="Move scene up"
        title="Move up"
        disabled={isFirst}
        onClick={() => update((v) => shiftSceneOrder(v, scene.id, -1))}
      >
        ↑
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-label="Move scene down"
        title="Move down"
        disabled={isLast}
        onClick={() => update((v) => shiftSceneOrder(v, scene.id, 1))}
      >
        ↓
      </button>
    </li>
  );
}

/** Text input with a local draft. Commits on blur or Enter; empty or unchanged text is ignored. */
function InlineText({
  value,
  label,
  className,
  onCommit,
}: {
  value: string;
  label: string;
  className: string;
  onCommit: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className={className}
      aria-label={label}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null) {
          const next = draft.trim();
          if (next !== '' && next !== value) onCommit(next);
        }
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

interface SceneGroup {
  key: string;
  title: string;
  scenes: Scene[];
}

interface ArcGroup {
  key: string;
  title: string;
  /** Chapter groups of this arc (plus a "No chapter" group in the "No arc" section, if needed). */
  groups: SceneGroup[];
}

/** One group per chapter. */
function chapterGroups(chapters: Chapter[], scenes: Scene[]): SceneGroup[] {
  return chapters.map((c) => ({ key: c.id, title: c.title, scenes: scenes.filter((s) => s.chapterId === c.id) }));
}

/** Scenes whose chapter is missing or is not one of `chapters`. */
function looseScenes(chapters: Chapter[], scenes: Scene[]): Scene[] {
  const known = new Set(chapters.map((c) => c.id));
  return scenes.filter((s) => s.chapterId === null || !known.has(s.chapterId));
}

/** One group per chapter, then a "No chapter" group for scenes without a (known) chapter. */
function groupByChapter(chapters: Chapter[], scenes: Scene[]): SceneGroup[] {
  const groups = chapterGroups(chapters, scenes);
  const loose = looseScenes(chapters, scenes);
  if (loose.length > 0) groups.push({ key: 'no-chapter', title: 'No chapter', scenes: loose });
  return groups;
}

/**
 * One section per arc, in arc order. Chapters without a (known) arc go under a trailing "No arc"
 * section, which is only shown when it has something in it.
 */
function groupByArc(arcs: Arc[], chapters: Chapter[], scenes: Scene[]): ArcGroup[] {
  const arcIds = new Set(arcs.map((a) => a.id));
  const arcOf = (c: Chapter): Id | null => (c.arcId !== undefined && arcIds.has(c.arcId) ? c.arcId : null);
  const out: ArcGroup[] = arcs.map((arc) => ({
    key: arc.id,
    title: arc.title,
    groups: chapterGroups(
      chapters.filter((c) => arcOf(c) === arc.id),
      scenes,
    ),
  }));
  const unarced = chapterGroups(
    chapters.filter((c) => arcOf(c) === null),
    scenes,
  );
  const loose = looseScenes(chapters, scenes);
  if (loose.length > 0) unarced.push({ key: 'no-chapter', title: 'No chapter', scenes: loose });
  if (unarced.length > 0) out.push({ key: 'no-arc', title: 'No arc', groups: unarced });
  return out;
}

function countChanges(r: Resolver, changes: Record<Id, StateChange>): Map<Id, number> {
  const counts = new Map<Id, number>();
  for (const c of Object.values(changes)) for (const sceneId of r.scenesOfChange(c)) counts.set(sceneId, (counts.get(sceneId) ?? 0) + 1);
  return counts;
}
