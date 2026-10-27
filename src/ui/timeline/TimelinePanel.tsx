// The docked timeline: story tracks, scene clips, chapter/arc bands, playhead, and the range bar underneath.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { findEntity, parseLinks } from '../../core/links';
import { constrainScenes, insertScene, moveScenes, setSceneSpan, type Relation } from '../../core/timeline';
import { addChapterAfter, chapterForNewScene } from '../../store/actions';
import type { Id, Scene, Vault } from '../../core/types';
import { describeImpact, impactOf } from '../../store/impact';
import { getGraph, getResolver, useStore, useVault, ZOOM_MAX, ZOOM_MIN } from '../../store/store';
import { describePlayhead } from '../follow';
import { HoverPreview } from './HoverPreview';
import { buildTimelineModel, entityKeyframes, HEADER_W, targetForColumn, type ClipModel, type TimelineModel, type TrackModel } from './model';
import { RangeBar } from './RangeBar';
import { Ruler } from './Ruler';
import { Toolbar } from './Toolbar';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { buildMenu, type MenuTarget } from './menuItems';
import { CastTrack, Track, hintKey, type Hint, type LaneContext } from './TrackLane';
import { EMPTY_HISTORY, canTravel, goBack, goForward, recordJump, type ViewHistory } from './viewHistory';
import { ZOOM_TWEEN_MS, clampView, clampZoom, fitZoom, nextStart, prefersReducedMotion, scrollForAnchor, stepZoom, tweenAt, viewForRange, zoomAnchor, zoomRange, type ViewState, type ViewTween } from './zoom';
import './timeline.css';
import './menus.css';

const TAIL_COLS = 4;
/** Ctrl/Alt+wheel zoom factor per wheel delta pixel (exponential, so it is symmetric). */
const WHEEL_ZOOM = 0.0018;
/** Zoom (px per column) at which a one-column scene clip is comfortably wide: the `1` key. */
const SCENE_ZOOM = 160;
/** A view no real view equals: a range-bar gesture is about to leave the current one, so Back should be offered. */
const MOVED_AWAY = { zoom: -1, scroll: -1 };

type DragPayload = { kind: 'scenes'; ids: Id[] } | { kind: 'story'; id: Id };
let dragPayload: DragPayload | null = null;

/** Scenes that involve an entity: it has a state change there, or a [[link]] to it in the prose. */
function involvement(vault: Vault, entityId: Id): Set<Id> {
  const set = new Set<Id>();
  const r = getResolver(vault);
  for (const c of r.changesFor(entityId)) for (const sceneId of r.scenesOfChange(c)) set.add(sceneId);
  for (const s of Object.values(vault.scenes)) if (parseLinks(s.prose).some((l) => findEntity(vault, l.target)?.id === entityId)) set.add(s.id);
  return set;
}

/** Scenes that involve any of the given entities (empty list: no highlight, so null). */
function involvementOfAny(vault: Vault, entityIds: Id[]): Set<Id> | null {
  if (!entityIds.length) return null;
  const set = new Set<Id>();
  for (const id of entityIds) for (const sceneId of involvement(vault, id)) set.add(sceneId);
  return set;
}

function readPayload(e: React.DragEvent): DragPayload | null {
  if (dragPayload) return dragPayload;
  const data = e.dataTransfer.getData('text/plain');
  if (data.startsWith('story:')) return { kind: 'story', id: data.slice(6) };
  if (data.startsWith('scenes:')) return { kind: 'scenes', ids: data.slice(7).split(',') };
  return null;
}

/**
 * The story the keyboard steps through: the focused story if it has chapters, else the first
 * visible story that has chapters, else the first with clips.
 */
function keyTrack(model: TimelineModel, focusStoryId: Id | undefined): TrackModel | undefined {
  return model.tracks.find((t) => t.story.id === focusStoryId && t.chapters.length) ?? model.tracks.find((t) => t.chapters.length) ?? model.tracks.find((t) => t.clips.length);
}

export function TimelinePanel() {
  const vault = useVault();
  const storeZoom = useStore((s) => s.zoom);
  const mode = useStore((s) => s.timelineMode);
  const hidden = useStore((s) => s.hiddenStories);
  const playhead = useStore((s) => s.playhead);
  const castTracks = useStore((s) => s.castTracks);
  const highlightEntities = useStore((s) => s.highlightEntities);
  const reveal = useStore((s) => s.reveal);
  const maximized = useStore((s) => s.timelineMaximized);
  const scrollbar = useStore((s) => s.timelineScrollbar);
  const activeView = useStore((s) => s.view);
  const currentStoryId = useStore((s) => s.currentStoryId);
  const [selected, setSelected] = useState<Set<Id>>(new Set());
  const [hint, setHint] = useState<Hint | null>(null);
  /** A clip being stretched: its span while the pointer is down (committed on release, cancelled by Esc). */
  const [resizing, setResizing] = useState<{ sceneId: Id; span: number } | null>(null);
  const [flash, setFlash] = useState<Id | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [viewport, setViewport] = useState({ left: 0, width: 800, top: 0, height: 300 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number | null>(null);

  const graph = getGraph(vault);
  const model = useMemo(() => buildTimelineModel(vault, graph, hidden), [vault, graph, hidden]);
  const castEntities = castTracks.map((id) => vault.entities[id]).filter(Boolean);

  // The dock is as tall as these rows need (unless the writer dragged it): say how tall that is.
  useEffect(() => {
    const content = contentRef.current;
    const scroll = scrollRef.current;
    if (!content || !scroll) return;
    const measure = () => {
      const rows = [...content.children].filter((c) => !c.classList.contains('tl-playhead')).reduce((n, c) => n + (c as HTMLElement).offsetHeight, 0);
      useStore.getState().setTimelineNatural(scroll.parentElement!.offsetHeight - scroll.clientHeight + rows + 6);
    };
    measure();
    // Measured a frame later, so a resize caused by the measuring never loops back into it.
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    ro.observe(content);
    for (const c of content.children) ro.observe(c);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [model.tracks.length, castEntities.length]);
  const involved = useMemo(() => involvementOfAny(vault, highlightEntities), [vault, highlightEntities]);
  const changeCount = useMemo(() => {
    const map = new Map<Id, number>();
    const r = getResolver(vault);
    for (const c of Object.values(vault.changes)) for (const sceneId of r.scenesOfChange(c)) map.set(sceneId, (map.get(sceneId) ?? 0) + 1);
    return map;
  }, [vault]);
  const activeSceneId = activeView.kind === 'scene' ? activeView.id : null;
  const activeStoryId = activeSceneId ? vault.scenes[activeSceneId]?.storyId : undefined;
  const focusStoryId = activeStoryId ?? currentStoryId ?? undefined;
  const totalCols = model.columns + TAIL_COLS;
  const laneW = Math.max(1, viewport.width - HEADER_W);
  // Zoom is limited to fit-all (the whole work, tail included, fills the lane) up to ZOOM_MAX. The stored zoom
  // can be outside that after a resize or an old session, so the shown zoom is clamped and the store follows it.
  const range = zoomRange(totalCols, laneW, ZOOM_MIN, ZOOM_MAX);
  const zoom = clampZoom(storeZoom, range.min, range.max);
  const contentW = HEADER_W + totalCols * zoom;
  useEffect(() => {
    if (storeZoom !== zoom) useStore.getState().setZoom(zoom);
  }, [storeZoom, zoom]);

  // ---- scrolling / virtualisation ----
  const syncViewport = useCallback(() => {
    const el = scrollRef.current;
    if (el) setViewport({ left: el.scrollLeft, width: el.clientWidth, top: el.scrollTop, height: el.clientHeight });
  }, []);
  useLayoutEffect(() => {
    syncViewport();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(syncViewport);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncViewport]);

  const c0 = Math.max(0, Math.floor((viewport.left - HEADER_W) / zoom) - 2);
  const c1 = Math.ceil((viewport.left + viewport.width) / zoom) + 2;
  const visible = (from: number, to: number) => to >= c0 && from <= c1;

  const scrollToColumn = useCallback(
    (col: number, center = true) => {
      const el = scrollRef.current;
      if (!el) return;
      const x = HEADER_W + col * zoom;
      const left = center ? x - (el.clientWidth + HEADER_W) / 2 + zoom / 2 : x - HEADER_W - 40;
      el.scrollLeft = Math.max(0, left);
    },
    [zoom],
  );

  useEffect(() => {
    if (reveal) scrollToColumn(reveal.column);
    // Only react to new reveal requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.seq]);

  // ---- zoom: the wheel is immediate, the Fit button animates, the range bar drives the view directly ----
  const cancelAnim = useCallback(() => {
    if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    animRef.current = null;
  }, []);

  useEffect(() => () => cancelAnim(), [cancelAnim]);

  // The work's size for the handlers below, which run outside render.
  const columnsRef = useRef(totalCols);
  useLayoutEffect(() => {
    columnsRef.current = totalCols;
  }, [totalCols]);

  /** Every view change goes through here, so no zoom or scroll can show anything outside the work. */
  const applyView = useCallback(
    (v: ViewState) => {
      const el = scrollRef.current;
      if (!el) return;
      const lane = Math.max(1, el.clientWidth - HEADER_W);
      const columns = columnsRef.current;
      const c = clampView(v, columns, lane, zoomRange(columns, lane, ZOOM_MIN, ZOOM_MAX));
      // Commit the zoom to the DOM before moving the scroll, or the browser clamps scrollLeft to the old width.
      flushSync(() => useStore.getState().setZoom(c.zoom));
      el.scrollLeft = c.scroll;
      syncViewport();
    },
    [syncViewport],
  );

  /** A manual view change (range bar, wheel) always wins over a running tween. */
  const setView = useCallback(
    (v: ViewState) => {
      cancelAnim();
      applyView(v);
    },
    [applyView, cancelAnim],
  );

  const runTween = useCallback(
    (tw: ViewTween) => {
      cancelAnim();
      if (prefersReducedMotion()) {
        applyView(tweenAt(tw, 1));
        return;
      }
      const t0 = performance.now();
      const step = (now: number) => {
        const t = (now - t0) / ZOOM_TWEEN_MS;
        applyView(tweenAt(tw, t));
        animRef.current = t < 1 ? requestAnimationFrame(step) : null;
      };
      animRef.current = requestAnimationFrame(step);
    },
    [applyView, cancelAnim],
  );

  /** Where the timeline has been looking before each deliberate jump (Fit, zoom keys, framing a chapter). */
  const historyRef = useRef<ViewHistory>(EMPTY_HISTORY);
  const [canGo, setCanGo] = useState({ back: false, forward: false });
  /** Keeps the toolbar arrows in step with the history (Back skips the place we are already at, so the arrows depend on where the view is going). */
  const setHistory = useCallback((h: ViewHistory, current: ViewState) => {
    historyRef.current = h;
    setCanGo(canTravel(h, current));
  }, []);

  /** A deliberate jump to another view: remember the one we leave, then animate. */
  const jump = useCallback(
    (tw: ViewTween) => {
      const el = scrollRef.current;
      if (el) {
        const here = { zoom: useStore.getState().zoom, scroll: el.scrollLeft };
        setHistory(recordJump(historyRef.current, here), tw.to);
      }
      runTween(tw);
    },
    [runTween, setHistory],
  );

  /** Back (-1) or forward (1) through the remembered views. */
  const travel = useCallback(
    (dir: 1 | -1) => {
      const el = scrollRef.current;
      if (!el) return;
      const here = { zoom: useStore.getState().zoom, scroll: el.scrollLeft };
      const step = (dir === -1 ? goBack : goForward)(historyRef.current, here);
      if (!step) return;
      setHistory(step.history, step.view);
      runTween({ from: here, to: step.view });
    },
    [runTween, setHistory],
  );

  /** Fit the whole work into the lane: the smallest zoom, where the window fills the range bar. */
  const fit = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    jump({
      from: { zoom: useStore.getState().zoom, scroll: el.scrollLeft },
      to: { zoom: fitZoom(totalCols, el.clientWidth - HEADER_W, ZOOM_MIN, ZOOM_MAX), scroll: 0 },
    });
  }, [totalCols, jump]);

  useEffect(() => {
    const onFit = () => fit();
    window.addEventListener('lw:timeline-fit', onFit);
    return () => window.removeEventListener('lw:timeline-fit', onFit);
  }, [fit]);

  /** The viewport x a zoom without a pointer keeps still (see zoomAnchor): the playhead, or the centre if it is off screen. */
  const keyAnchorPx = useCallback((el: HTMLElement) => {
    const s = useStore.getState();
    return zoomAnchor({ pointerPx: null, playheadPx: HEADER_W + s.playhead * s.zoom - el.scrollLeft, headerW: HEADER_W, laneW: Math.max(1, el.clientWidth - HEADER_W) });
  }, []);

  /** Animate to zoom `z`, keeping whatever the playhead anchor points at in place. */
  const zoomTo = useCallback(
    (z: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const s = useStore.getState();
      const lane = Math.max(1, el.clientWidth - HEADER_W);
      const px = keyAnchorPx(el);
      const col = (el.scrollLeft + px - HEADER_W) / s.zoom;
      const range = zoomRange(columnsRef.current, lane, ZOOM_MIN, ZOOM_MAX);
      const next = clampZoom(z, range.min, range.max);
      jump({ from: { zoom: s.zoom, scroll: el.scrollLeft }, to: { zoom: next, scroll: scrollForAnchor(col, next, px, HEADER_W) } });
    },
    [keyAnchorPx, jump],
  );

  /** Frame columns [from, to) in the lane. */
  const frameRange = useCallback(
    (from: number, to: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const lane = Math.max(1, el.clientWidth - HEADER_W);
      const range = zoomRange(columnsRef.current, lane, ZOOM_MIN, ZOOM_MAX);
      const target = clampView(viewForRange(from, to, lane, range.min, range.max), columnsRef.current, lane, range);
      jump({ from: { zoom: useStore.getState().zoom, scroll: el.scrollLeft }, to: target });
    },
    [jump],
  );

  useEffect(() => {
    const onRange = (e: Event) => {
      const d = (e as CustomEvent<{ from: number; to: number }>).detail;
      frameRange(d.from, d.to);
    };
    window.addEventListener('lw:timeline-zoom-range', onRange);
    return () => window.removeEventListener('lw:timeline-zoom-range', onRange);
  }, [frameRange]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    /** Zoom by `factor`, keeping the column at viewport x `px` where it is. applyView keeps the result within the work. */
    const zoomAt = (factor: number, px: number) => {
      const z0 = useStore.getState().zoom;
      const z = z0 * factor;
      cancelAnim();
      applyView({ zoom: z, scroll: scrollForAnchor((el.scrollLeft + px - HEADER_W) / z0, z, px, HEADER_W) });
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(Math.exp(-e.deltaY * WHEEL_ZOOM), e.clientX - el.getBoundingClientRect().left); // the pointer is the anchor
      } else if (e.altKey) {
        e.preventDefault();
        zoomAt(Math.exp(-e.deltaY * WHEEL_ZOOM), keyAnchorPx(el));
      } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX) && (e.target as HTMLElement).closest('.tl-ruler')) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyView, cancelAnim, keyAnchorPx]);

  // ---- playhead ----
  const colAtClientX = (clientX: number) => {
    const rect = contentRef.current!.getBoundingClientRect();
    return (clientX - rect.left - HEADER_W) / useStore.getState().zoom;
  };
  const scrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // The playhead is a whole column: the one under the pointer.
    const set = (clientX: number) => useStore.getState().setPlayhead(Math.max(0, Math.min(model.columns, Math.floor(colAtClientX(clientX)))));
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    set(e.clientX);
    const move = (ev: PointerEvent) => set(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Move the playhead to a column (clamped), scrolling it into view if needed. */
  const moveTo = (x: number) => {
    const s = useStore.getState();
    const col = Math.max(0, Math.min(model.columns, Math.round(x)));
    s.setPlayhead(col);
    const el = scrollRef.current;
    if (el) {
      const px = HEADER_W + col * s.zoom;
      if (px < el.scrollLeft + HEADER_W + 20 || px > el.scrollLeft + el.clientWidth - 20) scrollToColumn(col);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, select, textarea, [contenteditable="true"]')) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === '[' || e.key === ']')) {
      e.preventDefault();
      travel(e.key === '[' ? -1 : 1);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const s = useStore.getState();
    const k = e.key;
    const move = (x: number | null) => {
      if (x === null) return;
      e.preventDefault();
      moveTo(x);
    };
    const track = keyTrack(model, focusStoryId);
    const chapterStarts = track ? track.chapters.map((c) => c.from) : [];
    const clipStarts = track ? [...new Set(track.clips.map((c) => c.col))] : [];

    if (k === 'ArrowRight') move(Math.round(s.playhead) + (e.shiftKey ? 5 : 1));
    else if (k === 'ArrowLeft') move(Math.round(s.playhead) - (e.shiftKey ? 5 : 1));
    else if (k === 'Home') move(0);
    else if (k === 'End') move(model.columns);
    else if (k === '[' || k === ']') move(nextStart(chapterStarts, s.playhead, k === ']' ? 1 : -1));
    else if (k === ',' || k === '.') move(nextStart(clipStarts, s.playhead, k === '.' ? 1 : -1));
    else if (k === '=' || k === '+' || k === '-' || k === '_') {
      e.preventDefault();
      zoomTo(stepZoom(s.zoom, k === '=' || k === '+' ? 1 : -1, ZOOM_MIN, ZOOM_MAX));
    } else if (k === '0') {
      e.preventDefault();
      fit();
    } else if (k === '1') {
      e.preventDefault();
      zoomTo(SCENE_ZOOM);
    } else if (k === 'z' || k === 'Z') {
      // Z frames the chapter under the playhead, Shift+Z its arc: the part that holds the playhead, else the nearest before it.
      const spans = (k === 'z' ? track?.chapters : track?.arcs) ?? [];
      const here = spans.filter((p) => p.from <= s.playhead).sort((a, b) => b.from - a.from)[0] ?? spans[0];
      if (here) {
        e.preventDefault();
        frameRange(here.from, here.to);
      }
    }
  };

  // ---- editing ----
  const apply = (payload: DragPayload, relation: Relation, targetSceneId: Id) => {
    const s = useStore.getState();
    const ids = payload.kind === 'story' ? Object.values(s.vault.scenes).filter((x) => x.storyId === payload.id).map((x) => x.id) : payload.ids;
    if (!ids.length) return;
    if (payload.kind === 'story' && s.vault.scenes[targetSceneId]?.storyId === payload.id) {
      s.toast('error', 'Drop a story onto a scene from a different story.');
      return;
    }
    const res = (s.timelineMode === 'move' ? moveScenes : constrainScenes)(s.vault, ids, relation, targetSceneId);
    if (!res.ok) {
      s.toast('error', res.error);
      setFlash(targetSceneId);
      setTimeout(() => setFlash(null), 700);
      return;
    }
    const before = s.vault;
    s.commit(res.vault, undefined, 'Move scenes');
    setSelected(new Set());
    // A move can change what other scenes see (a death now happens after them). Say so, once the drop has been drawn.
    setTimeout(() => {
      const note = describeImpact(res.vault, impactOf(before, res.vault));
      if (note) useStore.getState().toast('info', note);
    }, 60);
  };

  /** Stretch a clip by dragging its right edge. Snaps to whole columns; Esc cancels; release commits. */
  const startResize = (clip: ClipModel, e: React.PointerEvent) => {
    const startX = e.clientX;
    const startSpan = clip.span;
    const sceneId = clip.scene.id;
    let span = startSpan;
    let done = false;
    setResizing({ sceneId, span: startSpan });
    const move = (ev: PointerEvent) => {
      span = Math.max(1, Math.round(startSpan + (ev.clientX - startX) / useStore.getState().zoom));
      setResizing({ sceneId, span });
    };
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
      setResizing(null);
      if (commit && span !== startSpan) {
        const s = useStore.getState();
        s.commit(setSceneSpan(s.vault, sceneId, span), undefined, 'Resize scene');
      }
    };
    const onUp = () => finish(true);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      finish(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
  };

  /** A new scene next to a target; it joins a chapter (see chapterForNewScene) unless `chapterId` is null. */
  const insertAt = (storyId: Id, relation: Relation | null, targetSceneId: Id | null, chapterId?: Id | null) => {
    const s = useStore.getState();
    let v = s.vault;
    if (chapterId === undefined) ({ vault: v, chapterId } = chapterForNewScene(v, storyId, targetSceneId));
    const { vault: next, sceneId } = insertScene(v, { storyId, title: 'Untitled scene', chapterId }, relation, targetSceneId);
    s.commit(next);
    s.navigate({ kind: 'scene', id: sceneId });
  };

  const addChapterAt = (storyId: Id, afterChapterId: Id | null, relation: Relation | null, targetSceneId: Id | null) => {
    const s = useStore.getState();
    const made = addChapterAfter(s.vault, storyId, afterChapterId, relation, targetSceneId);
    s.commit(made.vault, undefined, `Create ${made.vault.chapters[made.chapterId].title}`);
    s.navigate({ kind: 'scene', id: made.sceneId });
  };

  const openClip = (scene: Scene, col: number) => {
    const s = useStore.getState();
    s.navigate({ kind: 'scene', id: scene.id });
    s.setPlayhead(col);
  };

  /** Right-click: build the menu for what was clicked and show it at the pointer. */
  const openMenu = (track: TrackModel | null, target: MenuTarget, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items: buildMenu(target, { model, track, selected, setSelected, insertAt, addChapterAt }) });
  };
  const laneTarget = (t: LaneContext): MenuTarget => (t.kind === 'lane' ? { kind: 'lane', col: Math.max(0, Math.floor(colAtClientX(t.clientX))) } : t);

  // The corner says when the playhead is, not which chapter: the clip under it already names that (the full place is its tooltip).
  const moment = [...model.labels].reverse().find((l) => l.col <= playhead);
  const readout = `Time ${Math.floor(playhead) + 1}${moment ? ` · ${moment.text}` : ''}`;
  const where = describePlayhead(vault, playhead, activeStoryId, false);

  return (
    <section className={`timeline ${maximized ? 'maximized' : ''}${scrollbar ? '' : ' no-hscroll'}`} data-testid="timeline" onKeyDown={onKeyDown} tabIndex={-1}>
      <Toolbar readout={readout} where={where} mode={mode} onFit={fit} nav={{ canBack: canGo.back, canForward: canGo.forward, onBack: () => travel(-1), onForward: () => travel(1) }} />
      <div className="tl-scroll" ref={scrollRef} onScroll={syncViewport}>
        <div className="tl-content" ref={contentRef} style={{ width: contentW }}>
          <Ruler
            model={model}
            zoom={zoom}
            c0={c0}
            c1={c1}
            totalCols={totalCols}
            onScrub={scrub}
            onContext={(e) => openMenu(null, { kind: 'ruler', col: Math.max(0, Math.floor(colAtClientX(e.clientX))) }, e)}
          />
          {model.tracks.map((t) => (
            <Track
              key={t.story.id}
              track={t}
              zoom={zoom}
              visible={visible}
              selected={selected}
              hint={hint}
              flash={flash}
              involved={involved}
              changeCount={changeCount}
              activeSceneId={activeSceneId}
              playhead={playhead}
              width={totalCols * zoom}
              onClip={(clip, e) => {
                if (e.shiftKey) {
                  const next = new Set(selected);
                  if (next.has(clip.scene.id)) next.delete(clip.scene.id);
                  else next.add(clip.scene.id);
                  setSelected(next);
                } else openClip(clip.scene, clip.col);
              }}
              onDragStartClip={(clip, e) => {
                const ids = selected.has(clip.scene.id) ? [...selected] : [clip.scene.id];
                dragPayload = { kind: 'scenes', ids };
                e.dataTransfer.setData('text/plain', `scenes:${ids.join(',')}`);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                dragPayload = null;
                setHint(null);
              }}
              resizing={resizing}
              onResizeStart={startResize}
              onHint={(h) => hintKey(h) !== hintKey(hint) && setHint(h)}
              onDropClip={(clip, relation, e) => {
                const p = readPayload(e);
                dragPayload = null;
                setHint(null);
                if (p) apply(p, relation, clip.scene.id);
              }}
              onDropLane={(clientX, e) => {
                const p = readPayload(e);
                dragPayload = null;
                setHint(null);
                if (!p) return;
                const col = Math.floor(colAtClientX(clientX));
                const exclude = p.kind === 'scenes' ? p.ids : Object.values(vault.scenes).filter((x) => x.storyId === p.id).map((x) => x.id);
                const target = targetForColumn(vault, model, col, exclude);
                if (target) apply(p, target.relation, target.sceneId);
              }}
              onInsertAfter={(clip) => insertAt(t.story.id, 'after', clip.scene.id)}
              onInsertAtColumn={(clientX) => {
                const target = targetForColumn(vault, model, Math.floor(colAtClientX(clientX)));
                insertAt(t.story.id, target?.relation ?? null, target?.sceneId ?? null);
              }}
              onContext={(target, e) => openMenu(t, laneTarget(target), e)}
              onSpan={(span) => {
                const s = useStore.getState();
                s.setPlayhead(span.from);
                const first = t.clips.find((c) => c.col === span.from);
                if (first) s.navigate({ kind: 'scene', id: first.scene.id });
              }}
              onStoryDragStart={(e) => {
                dragPayload = { kind: 'story', id: t.story.id };
                e.dataTransfer.setData('text/plain', `story:${t.story.id}`);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onNewSceneAtEnd={() => {
                const last = [...t.clips].sort((a, b) => b.col + b.span - (a.col + a.span))[0];
                insertAt(t.story.id, last ? 'after' : null, last?.scene.id ?? null);
              }}
            />
          ))}
          {castEntities.map((e) => (
            <CastTrack key={e.id} entity={e} keyframes={entityKeyframes(getResolver(vault), e.id)} zoom={zoom} width={totalCols * zoom} visible={visible} playhead={playhead} />
          ))}
          {!model.tracks.length && <div className="tl-empty">No story tracks on the timeline — use “+ Track” to bring one in, or load the demo world from the Vault menu.</div>}
          <div className="tl-playhead" style={{ left: HEADER_W + playhead * zoom, width: zoom }} data-testid="tl-playhead" data-x={playhead}>
            <div className="tl-playhead-cap">{playhead + 1}</div>
          </div>
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      <HoverPreview model={model} zoom={zoom} headerW={HEADER_W} contentRef={contentRef} />
      <RangeBar
        model={model}
        view={{ zoom, scroll: viewport.left }}
        laneW={laneW}
        extent={totalCols}
        minZoom={range.min}
        maxZoom={range.max}
        headerW={HEADER_W}
        playhead={playhead}
        onView={setView}
        onGestureStart={(from) => setHistory(recordJump(historyRef.current, from), MOVED_AWAY)}
        onFit={fit}
      />
    </section>
  );
}