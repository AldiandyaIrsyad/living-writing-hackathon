// Stories tool: the story picker, the outline (arc → chapter → scene) of the current story, and "+ Scene".

import { moveChapterBeside, moveSceneBeside, moveSceneToChapterEnd } from '../../core/reorder';
import { openReviewItems } from '../../core/review';
import { STATUS_LABELS, chapterRollup, type Rollup } from '../../core/status';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Scene, Story } from '../../core/types';
import { formatCompact, formatCount, storyWordCounts } from '../../core/wordcount';
import { update, useStore, useVault } from '../../store/store';
import { sceneAddresses } from '../goto';
import { appendScene, appendSomedayScene, createStory } from '../stories';
import { PanelHeader } from './PanelHeader';
import { buildOutline, countByStory, indent, type OutlineChapter } from './panelData';

export function StoriesPanel() {
  const vault = useVault();
  const { stories, arcs, chapters, scenes } = vault;
  const view = useStore((s) => s.view);
  const currentStoryId = useStore((s) => s.currentStoryId);
  const hiddenStories = useStore((s) => s.hiddenStories);
  const navigate = useStore((s) => s.navigate);
  const setCurrentStory = useStore((s) => s.setCurrentStory);

  const [storyOpen, setStoryOpen] = useState(false);
  // Arcs start open and chapters start closed: the list is for jumping to a chapter, and a chapter opens to its scenes.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [openChapters, setOpenChapters] = useState<Set<string>>(() => new Set());
  const pickerRef = useRef<HTMLDivElement>(null);
  // Drag and drop in the outline: what is being dragged, and the row and side it would land on.
  const dragging = useRef<{ kind: 'scene' | 'chapter'; id: string } | null>(null);
  const [dropMark, setDropMark] = useState<{ id: string; side: 'before' | 'after' | 'into' } | null>(null);

  const storyList = useMemo(() => Object.values(stories).sort((a, b) => a.order - b.order), [stories]);
  const counts = useMemo(() => countByStory(chapters, scenes), [chapters, scenes]);
  const story: Story | null = storyList.find((s) => s.id === currentStoryId) ?? storyList[0] ?? null;
  const storyId = story?.id ?? null;
  const outline = useMemo(() => buildOutline(storyId, arcs, chapters, scenes), [storyId, arcs, chapters, scenes]);
  const chapterKeys = useMemo(() => [...outline.arcs.flatMap((g) => g.chapters), ...outline.chapters].map((c) => `ch:${c.chapter.id}`), [outline]);
  const allOpen = chapterKeys.length > 0 && chapterKeys.every((k) => openChapters.has(k));
  const storyCount = storyId === null ? undefined : counts.get(storyId);
  const wordCounts = useMemo(() => (storyId === null ? null : storyWordCounts(vault, storyId)), [vault, storyId]);
  const storyWords = wordCounts?.total ?? 0;
  const reviewScenes = useMemo(() => new Set(openReviewItems(vault).map((i) => i.sceneId)), [vault]);
  const activeSceneId = view.kind === 'scene' ? view.id : null;

  // The scene being written stays findable: its chapter opens when it becomes the open scene.
  // Not when it was opened by clicking its title in this list: that opens the chapter without unfolding it.
  const activeChapterId = activeSceneId === null ? null : (scenes[activeSceneId]?.chapterId ?? null);
  const openedFromTitle = useRef<string | null>(null);
  useEffect(() => {
    if (activeChapterId === null) return;
    if (openedFromTitle.current === activeChapterId) {
      openedFromTitle.current = null;
      return;
    }
    const key = `ch:${activeChapterId}`;
    setOpenChapters((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, [activeChapterId, activeSceneId]);

  // The story picker closes on an outside click or Escape.
  useEffect(() => {
    if (!storyOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Node) || !pickerRef.current?.contains(e.target)) setStoryOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStoryOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [storyOpen]);

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleChapter = (key: string) => {
    setOpenChapters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** Opens every chapter (and any arc folded away), or closes every chapter again. */
  const toggleAll = () => {
    if (allOpen) {
      setOpenChapters(new Set());
    } else {
      setOpenChapters(new Set(chapterKeys));
      setCollapsed(new Set());
    }
  };

  const newStory = () => {
    createStory();
    setStoryOpen(false);
  };

  const addScene = () => {
    if (storyId !== null) appendScene(storyId);
  };

  const reordered = () => useStore.getState().toast('info', 'Reading order changed. Story time unchanged.');

  /** Which half of the row the pointer is over. */
  const halfOf = (e: React.DragEvent): 'before' | 'after' => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  };

  /** Alt+Up / Alt+Down moves a scene one place within its chapter, and keeps the keyboard on it. */
  const nudgeScene = (e: React.KeyboardEvent, s: Scene, siblings: Scene[]) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const i = siblings.findIndex((x) => x.id === s.id);
    const neighbour = siblings[i + (e.key === 'ArrowUp' ? -1 : 1)];
    if (!neighbour) return;
    update((v) => moveSceneBeside(v, s.id, neighbour.id, e.key === 'ArrowUp' ? 'before' : 'after'));
    reordered();
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-scene-id="${s.id}"]`)?.focus());
  };

  // A scene's address in the Timetable look: chapter number, then its place in the chapter (2.03).
  const addresses = useMemo(() => (storyId === null ? new Map<string, string>() : sceneAddresses(vault, storyId)), [vault, storyId]);

  const renderScene = (s: Scene, depth: number, siblings: Scene[]) => {
    const on = s.id === activeSceneId;
    const address = addresses.get(s.id);
    const mark = dropMark?.id === s.id ? dropMark.side : null;
    return (
      <button
        key={s.id}
        type="button"
        data-testid="side-scene"
        data-scene-id={s.id}
        draggable
        onDragStart={(e) => {
          dragging.current = { kind: 'scene', id: s.id };
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', `scenes:${s.id}`);
        }}
        onDragEnd={() => {
          dragging.current = null;
          setDropMark(null);
        }}
        onDragOver={(e) => {
          if (dragging.current?.kind !== 'scene' || dragging.current.id === s.id) return;
          e.preventDefault();
          const side = halfOf(e);
          if (dropMark?.id !== s.id || dropMark.side !== side) setDropMark({ id: s.id, side });
        }}
        onDrop={(e) => {
          const d = dragging.current;
          if (d?.kind !== 'scene' || d.id === s.id) return;
          e.preventDefault();
          update((v) => moveSceneBeside(v, d.id, s.id, halfOf(e)));
          setDropMark(null);
          reordered();
        }}
        onKeyDown={(e) => nudgeScene(e, s, siblings)}
        className={`lp-row lp-scene${on ? ' on' : ''}${mark ? ` drop-${mark}` : ''}`}
        style={{ paddingLeft: indent(depth) }}
        aria-current={on ? 'true' : undefined}
        title={s.synopsis ? `${s.title || 'Untitled scene'} — ${s.synopsis}` : undefined}
        onClick={() => navigate({ kind: 'scene', id: s.id })}
      >
        <span className="lp-glyph" aria-hidden="true">
          {s.someday ? '☁' : '¶'}
        </span>
        {address !== undefined && (
          <span className="lp-addr" aria-hidden="true">
            {address}
          </span>
        )}
        <span className="lp-row-name">{s.title || 'Untitled scene'}</span>
        {s.status && <span className={`status-dot status-${s.status}`} data-testid="outline-status" data-status={s.status} title={STATUS_LABELS[s.status]} />}
      </button>
    );
  };

  /**
   * A chapter or arc row: the arrow button folds it, the title opens it (at its first scene). Two separate buttons, so
   * a click on the name never folds the row by accident.
   */
  const renderGroupRow = (o: {
    className: string;
    depth: number;
    open: boolean;
    name: string;
    count: number;
    words: number;
    wordsTestId: string;
    /** Scenes in this row that are on the review list. */
    review?: number;
    /** "3 of 5 done", for a chapter. */
    rollup?: Rollup;
    firstSceneId: string | undefined;
    /** Set for a chapter: what a drag started here moves, and what a drop here lands on. */
    dropId?: string;
    onToggle: () => void;
  }) => (
    <div
      className={`lp-row lp-split ${o.className}${dropMark && dropMark.id === o.dropId ? ` drop-${dropMark.side}` : ''}`}
      style={{ paddingLeft: indent(o.depth) }}
      draggable={o.dropId !== undefined}
      data-testid={o.dropId === undefined ? undefined : 'outline-chapter-row'}
      onDragStart={(e) => {
        if (o.dropId === undefined) return;
        dragging.current = { kind: 'chapter', id: o.dropId };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', o.name);
      }}
      onDragEnd={() => {
        dragging.current = null;
        setDropMark(null);
      }}
      onDragOver={(e) => {
        const d = dragging.current;
        if (o.dropId === undefined || !d || d.id === o.dropId) return;
        e.preventDefault();
        // A scene dropped on a chapter goes to its end; a chapter dropped on a chapter goes before or after it.
        const side = d.kind === 'scene' ? 'into' : halfOf(e);
        if (dropMark?.id !== o.dropId || dropMark.side !== side) setDropMark({ id: o.dropId, side });
      }}
      onDrop={(e) => {
        const d = dragging.current;
        if (o.dropId === undefined || !d || d.id === o.dropId) return;
        e.preventDefault();
        const target = o.dropId;
        if (d.kind === 'scene') update((v) => moveSceneToChapterEnd(v, d.id, target));
        else update((v) => moveChapterBeside(v, d.id, target, halfOf(e)));
        setDropMark(null);
        reordered();
      }}
    >
      <button
        type="button"
        className="lp-twisty"
        data-testid="outline-fold"
        aria-expanded={o.open}
        aria-label={`${o.open ? 'Collapse' : 'Expand'} ${o.name}`}
        title={o.open ? 'Collapse' : 'Expand'}
        onClick={o.onToggle}
      >
        {o.open ? '▾' : '▸'}
      </button>
      <button
        type="button"
        className="lp-row-main"
        data-testid="outline-open"
        disabled={o.firstSceneId === undefined}
        title={o.firstSceneId === undefined ? 'No scenes yet' : `Open ${o.name}`}
        onClick={() => {
          if (o.firstSceneId === undefined) return;
          const chapterId = scenes[o.firstSceneId]?.chapterId ?? null;
          openedFromTitle.current = chapterId !== activeChapterId ? chapterId : null;
          navigate({ kind: 'scene', id: o.firstSceneId });
        }}
      >
        <span className="lp-row-name">{o.name}</span>
        {!!o.review && (
          <span className="lp-row-review" data-testid="outline-review" title={`${o.review} scene${o.review === 1 ? '' : 's'} to look at again`}>
            ● {o.review}
          </span>
        )}
        {o.rollup && o.rollup.total > 0 && o.rollup.done > 0 && (
          <span className="lp-row-rollup" data-testid="outline-rollup" title={`${o.rollup.done} of ${o.rollup.total} scenes done`}>
            ✓ {o.rollup.done}/{o.rollup.total}
          </span>
        )}
        <span className="lp-row-count">{o.count}</span>
        <span className="lp-row-words" data-testid={o.wordsTestId} title={`${formatCount(o.words)} words`}>
          {formatCompact(o.words)}
        </span>
      </button>
    </div>
  );

  const renderChapter = ({ chapter, scenes: list }: OutlineChapter, depth: number) => {
    const key = `ch:${chapter.id}`;
    // An empty chapter has nothing to hide, and shows where its first scene is added.
    const open = openChapters.has(key) || list.length === 0;
    const chapterWords = wordCounts?.byChapter.get(chapter.id) ?? 0;
    return (
      <div key={chapter.id}>
        {renderGroupRow({
          className: 'lp-chapter',
          depth,
          open,
          name: chapter.title || 'Untitled chapter',
          count: list.length,
          words: chapterWords,
          wordsTestId: 'outline-words',
          review: list.filter((sc) => reviewScenes.has(sc.id)).length,
          rollup: chapterRollup(vault, chapter.id),
          firstSceneId: list[0]?.id,
          dropId: chapter.id,
          onToggle: () => toggleChapter(key),
        })}
        {open && list.map((s) => renderScene(s, depth + 1, list))}
        {open && list.length === 0 && (
          <button
            type="button"
            className="lp-row lp-add-in-chapter"
            data-testid="add-scene-in-chapter"
            style={{ paddingLeft: indent(depth + 1) }}
            onClick={() => appendScene(chapter.storyId, chapter.id)}
          >
            + Add the first scene
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      <PanelHeader title="Stories" />
      <div className="lp-body">
        <div className="lp-picker-row">
          <div className="lp-picker-wrap" ref={pickerRef}>
            <button
              type="button"
              className="lp-picker"
              data-testid="story-picker"
              aria-haspopup="listbox"
              aria-expanded={storyOpen}
              onClick={() => setStoryOpen((o) => !o)}
            >
              {story ? (
                <>
                  <span className="lp-swatch" style={{ background: story.color }} aria-hidden="true" />
                  <span className="lp-picker-name">{story.name}</span>
                  <span className="lp-picker-meta" data-testid="picker-words" title={`${formatCount(storyWords)} words`}>
                    {storyCount?.scenes ?? 0} scenes · {formatCompact(storyWords)} words
                  </span>
                </>
              ) : (
                <span className="lp-picker-name lp-faint">No stories yet</span>
              )}
              <span className="lp-caret" aria-hidden="true">
                ▾
              </span>
            </button>

            {storyOpen && (
              <div className="lp-pop" role="listbox" aria-label="Stories">
                {storyList.map((st) => {
                  const c = counts.get(st.id);
                  const on = st.id === storyId;
                  const isHidden = hiddenStories.includes(st.id);
                  return (
                    <button
                      key={st.id}
                      type="button"
                      role="option"
                      aria-selected={on}
                      data-testid="story-option"
                      className={`lp-pop-item${on ? ' on' : ''}`}
                      onClick={() => {
                        setCurrentStory(st.id);
                        setStoryOpen(false);
                      }}
                    >
                      <span className="lp-swatch" style={{ background: st.color }} aria-hidden="true" />
                      <span className="lp-pop-main">
                        <span className="lp-picker-name">{st.name}</span>
                        <span className="lp-pop-sub">
                          {c?.chapters ?? 0} {c?.chapters === 1 ? 'chapter' : 'chapters'} · {c?.scenes ?? 0} {c?.scenes === 1 ? 'scene' : 'scenes'}
                        </span>
                      </span>
                      {isHidden && <span className="lp-badge">hidden</span>}
                    </button>
                  );
                })}
                <button type="button" className="lp-pop-item lp-pop-new" data-testid="new-story" onClick={newStory}>
                  + New story
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="lp-icon"
            title="Open story page"
            aria-label="Open story page"
            disabled={story === null}
            onClick={() => {
              if (story) navigate({ kind: 'story', id: story.id });
            }}
          >
            ↗
          </button>
        </div>

        <div className="lp-outline-tools">
          <span className="lp-faint">Outline</span>
          <button
            type="button"
            className="lp-outline-btn"
            data-testid="outline-toggle-all"
            disabled={chapterKeys.length === 0}
            title={allOpen ? 'Close every chapter' : 'Show the scenes of every chapter'}
            onClick={toggleAll}
          >
            <span aria-hidden="true">{allOpen ? '▸' : '▾'}</span> {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>

        <div className="lp-outline">
          {outline.arcs.map((group) => {
            const key = `arc:${group.arc.id}`;
            const open = !collapsed.has(key);
            const arcWords = wordCounts?.byArc.get(group.arc.id) ?? 0;
            return (
              <div key={group.arc.id} className="lp-group">
                {renderGroupRow({
                  className: 'lp-arc',
                  depth: 0,
                  open,
                  name: group.arc.title || 'Untitled arc',
                  count: group.sceneCount,
                  words: arcWords,
                  wordsTestId: 'outline-arc-words',
                  firstSceneId: group.chapters.find((c) => c.scenes.length > 0)?.scenes[0].id,
                  onToggle: () => toggle(key),
                })}
                {open && group.chapters.map((c) => renderChapter(c, 1))}
              </div>
            );
          })}
          {outline.chapters.map((c) => renderChapter(c, 0))}
          {outline.scenes.map((s) => renderScene(s, 0, outline.scenes))}
          {outline.someday.length > 0 && (
            <div className="lp-group" data-testid="someday-tray">
              {renderGroupRow({
                className: 'lp-arc',
                depth: 0,
                open: !collapsed.has('someday'),
                name: 'Someday (Unplaced)',
                count: outline.someday.length,
                words: outline.someday.reduce((n, sc) => n + (wordCounts?.byScene.get(sc.id) ?? 0), 0),
                wordsTestId: 'outline-someday-words',
                firstSceneId: outline.someday[0]?.id,
                onToggle: () => toggle('someday'),
              })}
              {!collapsed.has('someday') && outline.someday.map((s) => renderScene(s, 1, outline.someday))}
            </div>
          )}
          {story === null && <div className="lp-empty">No stories yet. Add one with the picker above.</div>}
          {story !== null && outline.arcs.length + outline.chapters.length + outline.scenes.length + outline.someday.length === 0 && (
            <div className="lp-empty">No scenes yet.</div>
          )}
        </div>

        <div className="lp-add-row" style={{ gap: 6 }}>
          <button type="button" className="lp-add-scene" data-testid="add-scene" disabled={story === null} onClick={addScene}>
            + Scene
          </button>
          <button
            type="button"
            className="lp-add-scene"
            data-testid="add-someday-scene"
            title="Write a scene now without committing to where it sits in time yet"
            onClick={() => appendSomedayScene(storyId)}
          >
            + Someday
          </button>
        </div>
      </div>
    </>
  );
}
