// App state (zustand). The vault is immutable: every edit produces a new vault via `commit`,
// which also feeds undo/redo and persistence. UI state (tabs, playhead, zoom…) lives here too.

import { create } from 'zustand';
import { buildGraph, type MomentGraph } from '../core/graph';
import { recordVisit, type Visits } from '../core/home';
import { Resolver } from '../core/resolve';
import type { Id, TimePoint, Vault } from '../core/types';
import { starterVault } from '../core/presets';
import { commitRevision } from './actions';
import { addReviewItems } from '../core/review';
import { impactOf, reviewCauses, type Impact } from './impact';
import { IndexedDBStorage, type Storage } from './db';
import { BACKEND, ServerStorage } from './server';

export type View =
  | { kind: 'home' }
  | { kind: 'scene'; id: Id }
  | { kind: 'entity'; id: Id; at?: TimePoint }
  | { kind: 'story'; id: Id }
  | { kind: 'types' }
  | { kind: 'tag'; tag: string }
  | { kind: 'search'; query: string }
  | { kind: 'notes' };

/** Stable identity of a view, used to find an existing tab for it. */
export function viewKey(v: View): string {
  switch (v.kind) {
    case 'home':
    case 'types':
    case 'search':
    case 'notes':
      return v.kind;
    case 'tag':
      return `tag:${v.tag}`;
    default:
      return `${v.kind}:${v.id}`;
  }
}

/** Which tab a view lives in: the scenes of a chapter share the chapter's tab. */
export function tabKey(v: View, vault: Vault): string {
  if (v.kind === 'scene') {
    const chapterId = vault.scenes[v.id]?.chapterId;
    if (chapterId && vault.chapters[chapterId]) return `chapter:${chapterId}`;
  }
  return viewKey(v);
}

export interface Tab {
  id: string;
  view: View;
}

export type TimelineMode = 'move' | 'constrain';
/** Which tool the left activity bar shows. */
export type LeftView = 'stories' | 'wiki' | 'search' | 'notes' | 'tags';

/** How the docked timeline behaves while writing. */
export type TimelineBehaviour = 'always' | 'autohide' | 'hidden';
export type StateTime = 'timeline' | 'slider';

/** An edit that changes what other scenes see, held back until the writer has looked at what it touches. */
export interface Proposal {
  label: string;
  next: Vault;
  impacts: Impact[];
}

export interface Toast {
  id: number;
  kind: 'error' | 'info';
  text: string;
}

export type SaveStatus = 'saved' | 'saving' | 'error';

/** Zoom = pixels per timeline column. */
export const ZOOM_MIN = 4;
export const ZOOM_MAX = 420;

interface AppState {
  vault: Vault;
  loaded: boolean;
  /** Why the saved vault could not be read. While set, nothing is written, so the data that is there stays as it is. */
  loadError: string | null;
  past: Vault[];
  future: Vault[];
  lastCommitKey: string | null;
  lastCommitAt: number;

  /** Open documents in the center area. `view` mirrors the active tab (home when none). */
  tabs: Tab[];
  activeTabId: string | null;
  view: View;
  /** Views of recently closed tabs, newest last (see reopenClosedTab). */
  closedViews: View[];
  /** On start, open the tabs that were open last time (else the home page). */
  reopenTabs: boolean;
  setReopenTabs(on: boolean): void;

  /** Timeline playhead, in columns (see TimePoint 'position'). */
  playhead: number;
  zoom: number;
  timelineMode: TimelineMode;
  timelineHeight: number;
  timelineMaximized: boolean;
  hiddenStories: Id[];
  /** Characters and wiki pages with a row of their own on the timeline (their changes as keyframes). */
  castTracks: Id[];
  /** What the entity page's State follows: the timeline playhead, or a slider of its own. */
  stateTime: StateTime;
  /** Entities whose scenes are highlighted on the timeline (empty = no highlight). */
  highlightEntities: Id[];
  /** Show author notes inline in the editor (false = collapsed to small markers). */
  showNotesInEditor: boolean;
  /** The scene the Inspector is pinned to, as a reference while writing elsewhere. Not saved: a reload unpins. */
  inspectorPin: Id | null;
  /** Bumped to ask the timeline to scroll a column into view. */
  reveal: { column: number; seq: number } | null;

  /** Story shown in the left panel's outline ("which story am I working on"). */
  currentStoryId: Id | null;
  /** Last scene opened in each story, for the home page's "Continue". */
  lastVisits: Visits;
  timelineBehaviour: TimelineBehaviour;
  /** Timeline collapsed right now (auto-hide while typing, or hidden by the user). */
  timelineCollapsed: boolean;
  /** Left activity bar: selected tool and whether its panel is open. */
  leftView: LeftView;
  /** The wiki panel's type: one entity type, or 'all'. */
  wikiType: Id | 'all';
  leftOpen: boolean;
  rightOpen: boolean;

  toasts: Toast[];
  saveStatus: SaveStatus;
  switcherOpen: boolean;
  /** A retcon waiting for the writer's yes (see propose). */
  proposal: Proposal | null;
  /** Counts refused proposals; a field that showed the refused edit watches it to show the real value again. */
  proposalsRefused: number;
  /** Set by the Cast's "Update page…": the entity page opens in revise mode after this scene. */
  pendingRevise: { entityId: Id; sceneId: Id } | null;
  /** Floating wiki window opened while writing a scene so the author doesn't leave their manuscript. */
  floatingEntity: { entityId: Id; sceneId: Id | null; at?: TimePoint } | null;

  /**
   * Apply an edit that may rewrite the past. If no scene would see anything different it is committed at once; otherwise
   * it waits as `proposal` until resolveProposal says yes or no. Returns true when it was committed at once.
   */
  propose(label: string, next: Vault): boolean;
  /** `flagScenes` also puts every scene the edit touches on the review list, in the same undo step. */
  resolveProposal(apply: boolean, flagScenes?: boolean): void;
  /**
   * Replace the vault with a new version. Same `coalesceKey` within 1.5 s merges into one undo step. A `label` names the
   * step for the writer: Undo and Redo say what they undid.
   */
  commit(next: Vault, coalesceKey?: string, label?: string): void;
  /** Replace the whole vault and reset history (load, import, clear). */
  replaceVault(next: Vault): void;
  undo(): void;
  redo(): void;
  /** Open a view: focuses its tab if already open, else opens a new tab. */
  navigate(view: View): void;
  activateTab(id: string): void;
  closeTab(id: string): void;
  /** Close every open document; the center falls back to the home page. */
  closeAllTabs(): void;
  /** Open the most recently closed tab again, skipping any whose scene or entity has been deleted since. */
  reopenClosedTab(): void;
  setPlayhead(x: number): void;
  /** Scroll the timeline to a column, optionally moving the playhead too. */
  revealColumn(column: number, playhead?: number): void;
  setZoom(zoom: number): void;
  setTimelineMode(mode: TimelineMode): void;
  setTimelineHeight(h: number): void;
  setTimelineMaximized(on: boolean): void;
  toggleStoryHidden(id: Id): void;
  toggleCastTrack(id: Id): void;
  setStateTime(how: StateTime): void;
  toggleHighlight(id: Id): void;
  clearHighlights(): void;
  setShowNotesInEditor(on: boolean): void;
  setCurrentStory(id: Id | null): void;
  setTimelineBehaviour(b: TimelineBehaviour): void;
  setTimelineCollapsed(on: boolean): void;
  /** Select a left tool; selecting the open one again collapses the panel (VS Code style). */
  setLeftView(v: LeftView): void;
  /** Change the wiki panel's type without opening or closing it. */
  setWikiType(type: Id | 'all'): void;
  /** Show the wiki panel on one type (or 'all'); asking for the type it already shows collapses the panel. */
  openWiki(type: Id | 'all'): void;
  setInspectorPin(sceneId: Id | null): void;
  setLeftOpen(open: boolean): void;
  setRightOpen(open: boolean): void;
  toast(kind: Toast['kind'], text: string): void;
  dismissToast(id: number): void;
  setSwitcherOpen(open: boolean): void;
  /** Open an entity's page just after a scene, in revise mode (the page's draft editor). */
  openRevision(entityId: Id, sceneId: Id): void;
  clearPendingRevise(): void;
  /** Open or close the floating wiki window (keeps the main scene editor open). */
  openFloatingEntity(entityId: Id, sceneId?: Id | null, at?: TimePoint): void;
  closeFloatingEntity(): void;
}

const HISTORY_LIMIT = 200;

/** What each committed vault was made by, for naming the step when it is undone or redone. Keyed by the vault itself, so it needs no history of its own. */
const stepLabels = new WeakMap<Vault, string>();
const CLOSED_TABS_KEPT = 10;

/** Whether what a view shows still exists. */
function viewExists(v: View, vault: Vault): boolean {
  if (v.kind === 'scene') return !!vault.scenes[v.id];
  if (v.kind === 'entity') return !!vault.entities[v.id];
  if (v.kind === 'story') return !!vault.stories[v.id];
  return true;
}
let toastId = 0;
let tabSeq = 0;

function loadUi<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`lw-ui-${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function saveUi(key: string, value: unknown): void {
  try {
    localStorage.setItem(`lw-ui-${key}`, JSON.stringify(value));
  } catch {
    // UI preferences are a convenience only.
  }
}

export const useStore = create<AppState>((set, get) => ({
  vault: starterVault(),
  loaded: false,
  loadError: null,
  past: [],
  future: [],
  lastCommitKey: null,
  lastCommitAt: 0,
  tabs: [],
  activeTabId: null,
  view: { kind: 'home' },
  closedViews: [],
  playhead: 0,
  zoom: loadUi('zoom', 150),
  timelineMode: 'move',
  timelineHeight: loadUi('timelineHeight', 300),
  timelineMaximized: false,
  hiddenStories: loadUi<Id[]>('hiddenStories', []),
  castTracks: loadUi<Id[]>('castTracks', []),
  stateTime: loadUi<StateTime>('stateTime', 'timeline'),
  reveal: null,
  inspectorPin: null,
  highlightEntities: [],
  showNotesInEditor: loadUi<boolean>('showNotesInEditor', true),
  reopenTabs: loadUi<boolean>('reopenTabs', true),
  currentStoryId: loadUi<Id | null>('currentStory', null),
  lastVisits: loadUi<Visits>('lastVisits', {}),
  timelineBehaviour: loadUi<TimelineBehaviour>('timelineBehaviour', 'autohide'),
  timelineCollapsed: loadUi<TimelineBehaviour>('timelineBehaviour', 'autohide') === 'hidden',
  // 'world' is what the wiki panel was called before it grew into the wiki.
  leftView: ((v) => (v === ('world' as string) ? 'wiki' : v))(loadUi<LeftView>('leftView', 'stories')),
  wikiType: loadUi<Id | 'all'>('wikiType', 'all'),
  leftOpen: loadUi<boolean>('leftOpen', true),
  rightOpen: loadUi<boolean>('rightOpen', true),
  toasts: [],
  saveStatus: 'saved',
  switcherOpen: false,
  pendingRevise: null,
  floatingEntity: null,
  proposal: null,
  proposalsRefused: 0,

  propose(label, next) {
    const s = get();
    if (next === s.vault) return true;
    const impacts = impactOf(s.vault, next);
    if (impacts.length === 0) {
      s.commit(next, undefined, label);
      return true;
    }
    set({ proposal: { label, next, impacts } });
    return false;
  },

  resolveProposal(apply, flagScenes = false) {
    const p = get().proposal;
    set({ proposal: null, proposalsRefused: get().proposalsRefused + (p && !apply ? 1 : 0) });
    if (!p || !apply) return;
    const flagged = flagScenes ? addReviewItems(p.next, reviewCauses(p.next, p.label, p.impacts)) : p.next;
    get().commit(flagged, undefined, p.label);
    if (flagged !== p.next) {
      const scenes = new Set(Object.values(flagged.reviewItems).filter((i) => i.status === 'open').map((i) => i.sceneId)).size;
      get().toast('info', `Review list: ${scenes} scene${scenes === 1 ? '' : 's'} to look at again.`);
    }
  },

  commit(next, coalesceKey, label) {
    const s = get();
    if (next === s.vault) return;
    if (label) stepLabels.set(next, label);
    const now = Date.now();
    const coalesce = coalesceKey !== undefined && coalesceKey === s.lastCommitKey && now - s.lastCommitAt < 1500;
    set({
      vault: next,
      past: coalesce ? s.past : [...s.past, s.vault].slice(-HISTORY_LIMIT),
      future: [],
      lastCommitKey: coalesceKey ?? null,
      lastCommitAt: now,
    });
  },

  replaceVault(next) {
    set({
      vault: next,
      past: [],
      future: [],
      lastCommitKey: null,
      tabs: [],
      activeTabId: null,
      view: { kind: 'home' },
      playhead: 0,
      hiddenStories: [],
      castTracks: [],
      currentStoryId: Object.values(next.stories).sort((a, b) => a.order - b.order)[0]?.id ?? null,
    });
  },

  undo() {
    const s = get();
    const prev = s.past[s.past.length - 1];
    if (!prev) return;
    set({ vault: prev, past: s.past.slice(0, -1), future: [s.vault, ...s.future], lastCommitKey: null });
    const label = stepLabels.get(s.vault);
    if (label) get().toast('info', `Undid: ${label}`);
  },

  redo() {
    const s = get();
    const next = s.future[0];
    if (!next) return;
    set({ vault: next, past: [...s.past, s.vault], future: s.future.slice(1), lastCommitKey: null });
    const label = stepLabels.get(next);
    if (label) get().toast('info', `Redid: ${label}`);
  },

  navigate(view) {
    const s = get();
    const storyId = view.kind === 'scene' ? s.vault.scenes[view.id]?.storyId : view.kind === 'story' ? view.id : undefined;
    if (storyId && storyId !== s.currentStoryId) get().setCurrentStory(storyId);
    const nextFloating =
      view.kind !== 'scene'
        ? null
        : s.floatingEntity && !s.floatingEntity.at
          ? { ...s.floatingEntity, sceneId: view.id }
          : s.floatingEntity;
    const key = tabKey(view, s.vault);
    const existing = s.tabs.find((t) => tabKey(t.view, s.vault) === key);
    if (existing) {
      set({ tabs: s.tabs.map((t) => (t.id === existing.id ? { ...t, view } : t)), activeTabId: existing.id, view, floatingEntity: nextFloating });
      return;
    }
    const tab: Tab = { id: `tab${++tabSeq}`, view };
    // No cap: the tab bar scrolls, and a tab only ever closes when the writer closes it.
    set({ tabs: [...s.tabs, tab], activeTabId: tab.id, view, floatingEntity: nextFloating });
  },

  activateTab(id) {
    const s = get();
    const t = s.tabs.find((x) => x.id === id);
    if (t) {
      const nextFloating =
        t.view.kind !== 'scene'
          ? null
          : s.floatingEntity && !s.floatingEntity.at
            ? { ...s.floatingEntity, sceneId: t.view.id }
            : s.floatingEntity;
      set({ activeTabId: id, view: t.view, floatingEntity: nextFloating });
    }
  },

  closeTab(id) {
    const s = get();
    const i = s.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const tabs = s.tabs.filter((t) => t.id !== id);
    const closedViews = [...s.closedViews, s.tabs[i].view].slice(-CLOSED_TABS_KEPT);
    if (s.activeTabId !== id) {
      set({ tabs, closedViews });
      return;
    }
    const next = tabs[Math.min(i, tabs.length - 1)];
    const nextView = next?.view ?? { kind: 'home' as const };
    const nextFloating = nextView.kind === 'scene' ? s.floatingEntity : null;
    set({ tabs, closedViews, activeTabId: next?.id ?? null, view: nextView, floatingEntity: nextFloating });
  },

  closeAllTabs() {
    const s = get();
    set({ tabs: [], activeTabId: null, view: { kind: 'home' }, floatingEntity: null, closedViews: [...s.closedViews, ...s.tabs.map((t) => t.view)].slice(-CLOSED_TABS_KEPT) });
  },

  reopenClosedTab() {
    const s = get();
    const closedViews = [...s.closedViews];
    let view = closedViews.pop();
    while (view && !viewExists(view, s.vault)) view = closedViews.pop();
    set({ closedViews });
    if (view) get().navigate(view);
  },

  setPlayhead(x) {
    set({ playhead: Math.max(0, x) });
  },

  revealColumn(column, playhead) {
    const seq = (get().reveal?.seq ?? 0) + 1;
    set(playhead !== undefined ? { reveal: { column, seq }, playhead: Math.max(0, playhead) } : { reveal: { column, seq } });
  },

  setZoom(zoom) {
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
    saveUi('zoom', z);
    set({ zoom: z });
  },

  setTimelineMode(mode) {
    set({ timelineMode: mode });
  },

  setTimelineHeight(h) {
    const v = Math.round(Math.max(150, Math.min(window.innerHeight - 160, h)));
    saveUi('timelineHeight', v);
    set({ timelineHeight: v });
  },

  setTimelineMaximized(on) {
    set({ timelineMaximized: on });
  },

  toggleStoryHidden(id) {
    const h = get().hiddenStories;
    const next = h.includes(id) ? h.filter((x) => x !== id) : [...h, id];
    saveUi('hiddenStories', next);
    set({ hiddenStories: next });
  },

  toggleCastTrack(id) {
    const t = get().castTracks;
    const next = t.includes(id) ? t.filter((x) => x !== id) : [...t, id];
    saveUi('castTracks', next);
    set({ castTracks: next });
  },

  setStateTime(how) {
    saveUi('stateTime', how);
    set({ stateTime: how });
  },

  toggleHighlight(id) {
    const h = get().highlightEntities;
    set({ highlightEntities: h.includes(id) ? h.filter((x) => x !== id) : [...h, id] });
  },

  clearHighlights() {
    set({ highlightEntities: [] });
  },

  setInspectorPin(sceneId) {
    set({ inspectorPin: sceneId });
  },

  setReopenTabs(on) {
    saveUi('reopenTabs', on);
    set({ reopenTabs: on });
  },

  setShowNotesInEditor(on) {
    saveUi('showNotesInEditor', on);
    set({ showNotesInEditor: on });
  },

  setCurrentStory(id) {
    saveUi('currentStory', id);
    set({ currentStoryId: id });
  },

  setTimelineBehaviour(b) {
    saveUi('timelineBehaviour', b);
    set({ timelineBehaviour: b, timelineCollapsed: b === 'hidden' });
  },

  setLeftView(v) {
    const st = get();
    if (st.leftOpen && st.leftView === v) {
      get().setLeftOpen(false);
      return;
    }
    saveUi('leftView', v);
    saveUi('leftOpen', true);
    set({ leftView: v, leftOpen: true });
  },

  setWikiType(type) {
    saveUi('wikiType', type);
    set({ wikiType: type });
  },

  openWiki(type) {
    const st = get();
    if (st.leftOpen && st.leftView === 'wiki' && st.wikiType === type) {
      get().setLeftOpen(false);
      return;
    }
    saveUi('leftView', 'wiki');
    saveUi('wikiType', type);
    saveUi('leftOpen', true);
    set({ leftView: 'wiki', wikiType: type, leftOpen: true });
  },

  setLeftOpen(open) {
    saveUi('leftOpen', open);
    set({ leftOpen: open });
  },

  setRightOpen(open) {
    saveUi('rightOpen', open);
    set({ rightOpen: open });
  },

  setTimelineCollapsed(on) {
    if (get().timelineCollapsed !== on) set({ timelineCollapsed: on });
  },

  toast(kind, text) {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3000);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  setSwitcherOpen(open) {
    set({ switcherOpen: open });
  },

  openRevision(entityId, sceneId) {
    const { vault, navigate } = get();
    const scene = vault.scenes[sceneId];
    if (!scene || !vault.entities[entityId]) return;
    set({ pendingRevise: { entityId, sceneId } });
    navigate({ kind: 'entity', id: entityId, at: { kind: 'moment', momentId: scene.momentId, includeSceneId: sceneId } });
  },

  clearPendingRevise() {
    set({ pendingRevise: null });
  },

  openFloatingEntity(entityId, sceneId, at) {
    const s = get();
    if (!s.vault.entities[entityId]) return;
    const resolvedSceneId = sceneId !== undefined ? sceneId : s.view.kind === 'scene' ? s.view.id : null;
    set({ floatingEntity: { entityId, sceneId: resolvedSceneId, at } });
  },

  closeFloatingEntity() {
    set({ floatingEntity: null });
  },
}));

// Whatever opens a scene (sidebar, timeline, tab switch, palette), remember it as its story's place to continue.
useStore.subscribe((s, prev) => {
  if (s.view === prev.view || s.view.kind !== 'scene') return;
  const scene = s.vault.scenes[s.view.id];
  if (!scene) return;
  const lastVisits = recordVisit(s.lastVisits, scene, Date.now());
  saveUi('lastVisits', lastVisits);
  useStore.setState({ lastVisits });
});

// The open tabs, kept for the next start (see reopenTabs).
useStore.subscribe((s, prev) => {
  if (s.loaded && (s.tabs !== prev.tabs || s.activeTabId !== prev.activeTabId))
    saveUi('openTabs', { views: s.tabs.map((t) => t.view), active: s.tabs.findIndex((t) => t.id === s.activeTabId) });
});

/** Opens the tabs saved last time, those whose document still exists, and the one that was in front. */
function reopenSavedTabs(vault: Vault): void {
  const saved = loadUi<{ views: View[]; active: number } | null>('openTabs', null);
  if (!saved) return;
  const s = useStore.getState();
  const views = saved.views.filter((v) => viewExists(v, vault));
  for (const view of views) s.navigate(view);
  const front = saved.views[saved.active];
  if (front && viewExists(front, vault)) s.navigate(front);
}

// ---- Derived data, memoised by the references they depend on ----

let graphCache: { moments: Vault['moments']; constraints: Vault['constraints']; graph: MomentGraph } | null = null;
export function getGraph(v: Vault): MomentGraph {
  if (graphCache && graphCache.moments === v.moments && graphCache.constraints === v.constraints) return graphCache.graph;
  graphCache = { moments: v.moments, constraints: v.constraints, graph: buildGraph(v) };
  return graphCache.graph;
}

let resolverCache: { key: unknown[]; resolver: Resolver } | null = null;
/** Resolver for the vault; prose edits don't invalidate it unless a scene moves in time. */
export function getResolver(v: Vault): Resolver {
  const graph = getGraph(v);
  const key = [graph, v.changes, v.entities, v.scenes];
  if (resolverCache && resolverCache.key.every((k, i) => k === key[i])) return resolverCache.resolver;
  resolverCache = { key, resolver: new Resolver(v, graph) };
  return resolverCache.resolver;
}

export function useVault(): Vault {
  return useStore((s) => s.vault);
}

/** Convenience: commit a vault transform. */
export function update(fn: (v: Vault) => Vault, coalesceKey?: string): void {
  const s = useStore.getState();
  s.commit(fn(s.vault), coalesceKey);
}

/** Flush any mounted CodeMirror editors synchronously before navigating or running actions that read scene prose. */
export function flushEditors(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('lw:flush-editors'));
  }
}

/** Commit a living-page revision (see commitRevision). Returns false when nothing changed. */
export function commitPageRevision(fields: Parameters<typeof commitRevision>[1]): boolean {
  const s = useStore.getState();
  const next = commitRevision(s.vault, fields).vault;
  if (next === s.vault) return false;
  s.commit(next);
  return true;
}

// ---- Persistence ----

export const storage: Storage = BACKEND ? new ServerStorage() : new IndexedDBStorage();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSaved: Vault | null = null;
let saving: Promise<void> = Promise.resolve();

async function flushSave(): Promise<void> {
  if (useStore.getState().loadError) return; // never write over what could not be read
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const next = useStore.getState().vault;
  if (next === lastSaved) return;
  const prev = lastSaved;
  lastSaved = next;
  saving = saving.then(async () => {
    try {
      await storage.save(prev, next);
      if (useStore.getState().vault === next) useStore.setState({ saveStatus: 'saved' });
    } catch (e) {
      console.error(e);
      lastSaved = null; // force a full re-save next time
      useStore.setState({ saveStatus: 'error' });
      useStore.getState().toast('error', e instanceof Error ? e.message : 'Saving failed.');
    }
  });
  await saving;
}

export function flushPendingSave(): Promise<void> {
  return flushSave();
}

export async function initPersistence(): Promise<void> {
  try {
    const v = await storage.load();
    if (v) useStore.getState().replaceVault(v);
    lastSaved = v;
    if (v && useStore.getState().reopenTabs) reopenSavedTabs(v);
  } catch (e) {
    console.error('Failed to load vault', e);
    useStore.setState({ loadError: e instanceof Error ? e.message : String(e) });
  }
  useStore.setState({ loaded: true });
  useStore.subscribe((s, prev) => {
    if (s.vault === prev.vault || !s.loaded) return;
    useStore.setState({ saveStatus: 'saving' });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void flushSave(), 300);
  });
  window.addEventListener('beforeunload', () => void flushSave());
}

/** Recovery screen's last resort: forget the unreadable data and start with an empty vault. */
export async function startFresh(): Promise<void> {
  await clearStorage();
  useStore.getState().replaceVault(starterVault());
  useStore.setState({ loadError: null });
}

export async function clearStorage(): Promise<void> {
  await saving;
  await storage.clear();
  lastSaved = null;
}
