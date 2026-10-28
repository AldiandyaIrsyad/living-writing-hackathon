import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getSavedAt } from '../store/db';
import { BACKEND, accountEmail, logOut } from '../store/server';
import { forgetReports } from '../agent/run';
import { getSyncState, subscribeSync } from '../store/fsSync';
import { checkStorage, safetySummary, type StorageHealth } from '../store/health';
import { flushPendingSave, getGraph, useStore, useVault, viewKey, type Tab } from '../store/store';
import { ExportDialog } from './export/ExportDialog';
import { FolderSyncBanner, FolderSyncStatus, useFolderSyncBoot } from './FolderSync';
import { ErrorBoundary } from './ErrorBoundary';
import { FloatingWiki } from './FloatingWiki';
import { HoverCard } from './HoverCard';
import { ImpactDialog } from './ImpactDialog';
import { CaptureBox, IdeaQueueDialog, InboxBadge, OPEN_CAPTURE_EVENT } from './CaptureBox';
import { ImportNotesDialog } from './ImportNotesDialog';
import { ProblemsBadge, ProblemsDialog } from './ProblemsDialog';
import { ReplaceDialog } from './ReplaceDialog';
import { ReviewBadge, ReviewDialog } from './ReviewDialog';
import { TodayBadge } from './TodayBadge';
import { ShortcutsDialog } from './ShortcutsDialog';
import { Inspector } from './inspector/Inspector';
import { Recovery } from './Recovery';
import { Sidebar } from './left/Sidebar';
import { clearVault, exportVaultJSON, exportVaultZip, importVaultFile, loadDemo, loadLargeSample } from './io';
import { toggleTheme, useTheme } from './theme';
import { TimelinePanel } from './timeline/TimelinePanel';
import { TimelineStrip } from './timeline/TimelineStrip';
import { EntityView } from './views/EntityView';
import { HomeView } from './views/HomeView';
import { NotesView } from './views/NotesView';
import { QuickSwitcher } from './views/QuickSwitcher';
import { SceneView } from './views/SceneView';
import { SearchView } from './views/SearchView';
import { StoryView } from './views/StoryView';
import { TagView } from './views/TagView';
import { TypesView } from './views/TypesView';
import './shell.css';

export function App() {
  const loaded = useStore((s) => s.loaded);
  const loadError = useStore((s) => s.loadError);
  const view = useStore((s) => s.view);
  const timelineHeight = useStore((s) => s.timelineHeight);
  const timelineFit = useStore((s) => s.timelineFit);
  const timelineNatural = useStore((s) => s.timelineNatural);
  const maximized = useStore((s) => s.timelineMaximized);
  const collapsed = useStore((s) => s.timelineCollapsed);
  const leftOpen = useStore((s) => s.leftOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  useFolderSyncBoot();
  const [zen, setZen] = useState(false);
  const zenRef = useRef(zen);
  zenRef.current = zen;
  const toggleZen = () => {
    const st = useStore.getState();
    if (!zenRef.current) {
      st.setTimelineMaximized(false);
      st.setTimelineCollapsed(true);
    } else if (st.timelineBehaviour !== 'hidden') {
      st.setTimelineCollapsed(false);
    }
    setZen(!zenRef.current);
  };
  const toggleZenRef = useRef(toggleZen);
  toggleZenRef.current = toggleZen;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'k') {
        e.preventDefault();
        useStore.getState().setSwitcherOpen(true);
        return;
      }
      if (mod && e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        window.dispatchEvent(new Event(OPEN_CAPTURE_EVENT));
        return;
      }
      if (mod && e.shiftKey && key === 'f') {
        e.preventDefault();
        toggleZenRef.current();
        return;
      }
      if (e.key === 'Escape' && zenRef.current && !document.querySelector('.cm-tooltip-autocomplete, .modal-backdrop')) {
        toggleZenRef.current();
        return;
      }
      // In the editor Ctrl+B is bold (the editor handled it); anywhere else it toggles the sidebar.
      if (mod && key === 'b' && !e.defaultPrevented) {
        e.preventDefault();
        const st = useStore.getState();
        if (e.altKey) st.setRightOpen(!st.rightOpen);
        else st.setLeftOpen(!st.leftOpen);
        return;
      }
      if (mod && key === 'j') {
        e.preventDefault();
        const st = useStore.getState();
        st.setTimelineMaximized(false);
        st.setTimelineCollapsed(!st.timelineCollapsed);
        return;
      }
      if (e.key === 'Escape' && !e.defaultPrevented) {
        const st = useStore.getState();
        if (st.timelineCollapsed && st.timelineBehaviour === 'autohide' && !document.querySelector('.cm-tooltip-autocomplete')) st.setTimelineCollapsed(false);
      }
      const inEditor = (e.target as HTMLElement)?.closest?.('.cm-editor, input, textarea, select');
      if (mod && !inEditor && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) useStore.getState().redo();
        else useStore.getState().undo();
      } else if (mod && !inEditor && key === 'y') {
        e.preventDefault();
        useStore.getState().redo();
      } else if (mod && key === 'w') {
        const id = useStore.getState().activeTabId;
        if (id) {
          e.preventDefault();
          useStore.getState().closeTab(id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Focus mode: auto-hide the timeline while typing, bring it back when leaving the editor.
  useEffect(() => {
    const onTyping = () => {
      const st = useStore.getState();
      if (st.timelineBehaviour === 'autohide' && !st.timelineCollapsed && !st.timelineMaximized) st.setTimelineCollapsed(true);
    };
    // Out of the way until asked for (click its strip, Esc, Ctrl+J). Clicking around the side panels is not a request,
    // unless the writer chose the timeline that comes back by itself.
    const reveal = () => {
      const st = useStore.getState();
      if (st.timelineBehaviour === 'autohide' && st.timelineComesBack && st.timelineCollapsed) st.setTimelineCollapsed(false);
    };
    // Clicking away from the editor blurs it on the mouse press. The timeline coming back then resizes the page
    // under the pointer (a button at the bottom of the side bar jumps up), and the click is lost. So with a button
    // held down, wait until it is released and the click has happened.
    let pressed = false;
    let pressedOnTimeline = false;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const onDown = (e: PointerEvent) => {
      pressed = true;
      pressedOnTimeline = !!(e.target as HTMLElement | null)?.closest?.('.timeline, .tl-strip');
    };
    const onUp = () => {
      pressed = false;
      if (pending !== null) {
        clearTimeout(pending);
        pending = setTimeout(reveal, 150);
      }
    };
    const onBlur = () => {
      // Pressing Minimize (or anything in the timeline) takes focus from the editor too: that is not "clicking away".
      if (pressedOnTimeline) return;
      if (!pressed) reveal();
      else if (pending === null) pending = setTimeout(reveal, 5000);
    };
    window.addEventListener('lw:typing', onTyping);
    window.addEventListener('lw:editor-blur', onBlur);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    return () => {
      if (pending !== null) clearTimeout(pending);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('lw:typing', onTyping);
      window.removeEventListener('lw:editor-blur', onBlur);
    };
  }, []);

  // When a scene document becomes active, park the playhead at its start so the Inspector follows.
  useEffect(() => {
    return useStore.subscribe((s, prev) => {
      if (s.view === prev.view || s.view.kind !== 'scene') return;
      const scene = s.vault.scenes[s.view.id];
      if (!scene) return;
      const col = getGraph(s.vault).layerOf(scene.momentId);
      if (!(col <= s.playhead && s.playhead < col + 1)) s.revealColumn(col, col);
    });
  }, []);

  if (!loaded) return <div className="empty">Opening your world…</div>;
  if (loadError) return <Recovery />;

  let main: React.ReactNode;
  switch (view.kind) {
    case 'scene':
      main = <SceneView id={view.id} />;
      break;
    case 'entity':
      main = <EntityView id={view.id} at={view.at} />;
      break;
    case 'story':
      main = <StoryView id={view.id} />;
      break;
    case 'types':
      main = <TypesView />;
      break;
    case 'tag':
      main = <TagView tag={view.tag} />;
      break;
    case 'search':
      main = <SearchView query={view.query} />;
      break;
    case 'notes':
      main = <NotesView />;
      break;
    default:
      main = <HomeView />;
  }

  const columns = `${zen ? '0px' : leftOpen ? '300px' : '44px'} minmax(0, 1fr) ${zen ? '0px' : rightOpen ? '330px' : '34px'}`;

  return (
    <div className={`app ${maximized && !collapsed ? 'tl-max' : ''} ${zen ? 'zen' : ''} ${!rightOpen ? 'right-collapsed' : ''}`} style={{ gridTemplateRows: maximized && !collapsed ? '44px 0 minmax(0,1fr)' : `44px minmax(0,1fr) ${collapsed ? '30px' : timelineFit ? `clamp(190px, ${timelineNatural}px, 45vh)` : `${timelineHeight}px`}` }}>
      <TopBar zen={zen} toggleZen={toggleZen} />
      <div className="workspace" style={{ gridTemplateColumns: columns }}>
        <div className="left-pane">
          {!zen && (
            <ErrorBoundary label="side panel">
              <Sidebar />
            </ErrorBoundary>
          )}
        </div>
        <div className="center">
          <TabBar />
          <main className="doc">
            <ErrorBoundary label="document" resetKey={viewKey(view)}>
              {main}
            </ErrorBoundary>
          </main>
        </div>
        <div className="right-pane">
          {!zen &&
            (rightOpen ? (
              <>
                <div className="qp-head">
                  <button className="pane-min" onClick={() => useStore.getState().setRightOpen(false)} title="Hide quick panel (Ctrl+Alt+B)" aria-label="Hide quick panel" data-testid="right-minimize">
                    »
                  </button>
                  <span className="qp-title">Quick panel</span>
                </div>
                <ErrorBoundary label="quick panel">
                  <Inspector />
                </ErrorBoundary>
              </>
            ) : (
              <button className="right-rail" onClick={() => useStore.getState().setRightOpen(true)} title="Show quick panel (Ctrl+Alt+B)" data-testid="right-rail">
                <span className="right-rail-icon">«</span>
                <span className="right-rail-label">Quick panel</span>
              </button>
            ))}
        </div>
      </div>
      <div className={`dock ${collapsed ? 'collapsed' : ''}`}>
        {collapsed ? (
          <TimelineStrip />
        ) : (
          <>
            {!maximized && <DockResizer />}
            <ErrorBoundary label="timeline">
              <TimelinePanel />
            </ErrorBoundary>
          </>
        )}
      </div>
      <FloatingWiki />
      <HoverCard />
      <QuickSwitcher />
      <ExportDialog />
      <ImpactDialog />
      <ShortcutsDialog />
      <ProblemsDialog />
      {!BACKEND && <FolderSyncBanner />}
      <ReviewDialog />
      <ReplaceDialog />
      <CaptureBox />
      <IdeaQueueDialog />
      <ImportNotesDialog />
      <Toasts />
    </div>
  );
}

function DockResizer() {
  return (
    <div
      className="dock-resizer"
      title="Drag to resize the timeline"
      onPointerDown={(e) => {
        const startY = e.clientY;
        // Dragging leaves "fit to tracks": from the height it has now, as the writer's own.
        const startH = document.querySelector<HTMLElement>('[data-testid="timeline"]')?.offsetHeight ?? useStore.getState().timelineHeight;
        useStore.getState().setTimelineHeight(startH);
        useStore.getState().setTimelineFit(false);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => useStore.getState().setTimelineHeight(startH + (startY - ev.clientY));
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
    />
  );
}

/** Whether the browser is keeping the data, and how full its storage is. Looked up each time the menu opens. */
function StorageLine() {
  const [health, setHealth] = useState<StorageHealth | null>(null);
  useEffect(() => {
    let live = true;
    void checkStorage().then((h) => live && setHealth(h));
    return () => {
      live = false;
    };
  }, []);
  if (!health) return null;
  return (
    <div className={`menu-note ${health.level}`} data-testid="storage-line" title={health.reason || undefined}>
      {health.detail}
      {health.reason && <div>{health.reason}</div>}
    </div>
  );
}

/** The save dot, and a popover that answers "is my work safe right now?" across browser, folder and storage. */
function SaveStatus() {
  const saveStatus = useStore((s) => s.saveStatus);
  const sync = useSyncExternalStore(subscribeSync, getSyncState);
  const [open, setOpen] = useState(false);
  const [storage, setStorage] = useState<StorageHealth | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // What the browser says about its storage is only looked up when the popover opens.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void checkStorage().then((h) => live && setStorage(h));
    void getSavedAt().then((t) => live && setSavedAt(t));
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      live = false;
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, saveStatus]);

  const safety = safetySummary({ save: saveStatus, savedAt, folder: { status: sync.status, name: sync.folderName, lastSync: sync.lastSync, error: sync.error }, storage, server: BACKEND });
  const label = saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving…' : 'Save failed';
  return (
    <div className="save-wrap" ref={wrap}>
      <button className={`save-dot ${saveStatus} ${safety.level}`} onClick={() => setOpen(!open)} aria-expanded={open} data-testid="save-status" title="Is my work safe?">
        {label}
      </button>
      {open && (
        <div className="menu save-popover" role="dialog" aria-label="Is my work safe?" data-testid="save-popover" data-level={safety.level}>
          <div className={`save-headline ${safety.level}`}>{safety.headline}</div>
          <ul className="save-details">
            {safety.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          <button className="menu-item" onClick={() => void exportVaultZip()}>
            Back up now (Markdown zip)
          </button>
        </div>
      )}
    </div>
  );
}

function TopBar({ zen, toggleZen }: { zen: boolean; toggleZen: () => void }) {
  const canUndo = useStore((s) => s.past.length > 0);
  const reopenTabs = useStore((s) => s.reopenTabs);
  const canRedo = useStore((s) => s.future.length > 0);
  const theme = useTheme();
  const [menu, setMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <header className="topbar">
      <span className="brand" onClick={() => useStore.getState().navigate({ kind: 'home' })}>
        Living Writing
      </span>
      <button className="palette-trigger" onClick={() => useStore.getState().setSwitcherOpen(true)} data-testid="open-switcher">
        <span className="faint">⌕</span> Jump to anything, run a command…
        <kbd>Ctrl K</kbd>
      </button>
      <span className="grow" />
      <button className={`btn btn-sm ${zen ? 'active' : ''}`} onClick={toggleZen} title="Focus writing — hide panels and timeline (Ctrl+Shift+F, Esc to leave)" data-testid="zen-toggle">
        {zen ? 'Leave focus' : 'Focus'}
      </button>
      <InboxBadge />
      <TodayBadge />
      <ProblemsBadge />
      <ReviewBadge />
      {!BACKEND && <FolderSyncStatus />}
      <SaveStatus />
      <button className="icon-btn" onClick={() => useStore.getState().undo()} disabled={!canUndo} title="Undo (Ctrl+Z)" data-testid="undo">
        ↶
      </button>
      <button className="icon-btn" onClick={() => useStore.getState().redo()} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" data-testid="redo">
        ↷
      </button>
      <button className="icon-btn" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">
        {theme === 'dark' ? '☀' : '☾'}
      </button>
      <div style={{ position: 'relative' }}>
        <button className="btn btn-sm" onClick={() => setMenu(!menu)} data-testid="vault-menu">
          Vault ▾
        </button>
        {menu && (
          <div className="menu" onMouseLeave={() => setMenu(false)}>
            <button className="menu-item" onClick={() => (setMenu(false), loadDemo())} data-testid="load-demo">
              Load demo world
            </button>
            <button className="menu-item" onClick={() => (setMenu(false), void loadLargeSample())} data-testid="load-large">
              Load large sample (2,000 scenes)
            </button>
            <button className="menu-item" onClick={() => (setMenu(false), useStore.getState().navigate({ kind: 'types' }))} data-testid="nav-types">
              Entity types…
            </button>
            <button className="menu-item" onClick={() => (setMenu(false), useStore.getState().navigate({ kind: 'notes' }))} data-testid="nav-notes">
              Author notes…
            </button>
            <div className="menu-sep" />
            <button className="menu-item" onClick={() => (setMenu(false), void exportVaultJSON())} data-testid="export-json">
              Export JSON
            </button>
            <button className="menu-item" onClick={() => (setMenu(false), void exportVaultZip())} data-testid="export-zip">
              Export Markdown (.zip)
            </button>
            <button
              className="menu-item"
              onClick={() => (setMenu(false), window.dispatchEvent(new CustomEvent('lw:export-manuscript', { detail: { storyId: useStore.getState().currentStoryId ?? undefined } })))}
              data-testid="export-manuscript"
            >
              Export manuscript…
            </button>
            <button className="menu-item" onClick={() => (setMenu(false), fileRef.current?.click())} data-testid="import">
              Import…
            </button>
            <div className="menu-sep" />
            <button
              className="menu-item btn-danger"
              data-testid="clear-vault"
              onClick={() => {
                setMenu(false);
                if (window.confirm('Delete everything in this vault (stories, wiki, notes, timeline)? This cannot be undone. Export first if you want to keep it.')) void clearVault();
              }}
            >
              Delete everything…
            </button>
            <div className="menu-sep" />
            <label className="menu-item" title="Off: the app starts on the home page.">
              <input type="checkbox" checked={reopenTabs} onChange={(e) => useStore.getState().setReopenTabs(e.target.checked)} data-testid="reopen-tabs" /> Reopen my tabs on start
            </label>
            <div className="menu-sep" />
            {BACKEND && (
              <button className="menu-item" onClick={() => (setMenu(false), void flushPendingSave().then(() => (forgetReports(), logOut())))} data-testid="log-out">
                Log out ({accountEmail()})
              </button>
            )}
            <StorageLine />
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".json,.zip"
          hidden
          data-testid="import-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importVaultFile(f);
            e.target.value = '';
          }}
        />
      </div>
      <LayoutToggles />
    </header>
  );
}

const TAB_ICON: Record<Tab['view']['kind'], string> = {
  home: '⌂',
  scene: '¶',
  entity: '◆',
  story: '≡',
  types: '⚙',
  tag: '#',
  search: '⌕',
  notes: '✎',
};

function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.activeTabId);
  const vault = useVault();
  const activate = useStore((s) => s.activateTab);
  const close = useStore((s) => s.closeTab);
  const closeAll = useStore((s) => s.closeAllTabs);
  if (!tabs.length) return <div className="tabbar empty-tabs" />;
  const title = (t: Tab) => {
    const v = t.view;
    switch (v.kind) {
      case 'scene': {
        const scene = vault.scenes[v.id];
        const chapter = scene?.chapterId ? vault.chapters[scene.chapterId] : undefined;
        return chapter ? chapter.title || 'Untitled chapter' : (scene?.title ?? 'Deleted scene');
      }
      case 'entity':
        return vault.entities[v.id]?.name ?? 'Deleted';
      case 'story':
        return vault.stories[v.id]?.name ?? 'Deleted story';
      case 'types':
        return 'Entity types';
      case 'tag':
        return `#${v.tag}`;
      case 'search':
        return v.query ? `“${v.query}”` : 'Search';
      case 'notes':
        return 'Author notes';
      default:
        return 'Home';
    }
  };
  const color = (t: Tab) => {
    const v = t.view;
    if (v.kind === 'scene') return vault.stories[vault.scenes[v.id]?.storyId]?.color;
    if (v.kind === 'entity') return vault.entityTypes[vault.entities[v.id]?.typeId]?.color;
    if (v.kind === 'story') return vault.stories[v.id]?.color;
    return undefined;
  };
  return (
    <div className="tabbar" role="tablist">
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tab"
          aria-selected={t.id === active}
          className={`tab ${t.id === active ? 'on' : ''}`}
          onClick={() => activate(t.id)}
          onAuxClick={(e) => e.button === 1 && close(t.id)}
          data-testid="tab"
          style={{ ['--tab' as string]: color(t) ?? 'var(--fg-faint)' }}
        >
          <span className="tab-icon">{TAB_ICON[t.view.kind]}</span>
          <span className="tab-title">{title(t)}</span>
          <button
            className="tab-close"
            aria-label="Close tab"
            onClick={(e) => {
              e.stopPropagation();
              close(t.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="tabbar-close-all" onClick={closeAll} title="Close all tabs" data-testid="close-all-tabs">
        Close all
      </button>
    </div>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'} data-testid={`toast-${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** VS Code-style layout toggles: left panel, timeline, right panel. */
function LayoutToggles() {
  const leftOpen = useStore((s) => s.leftOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  const timelineOpen = useStore((s) => !s.timelineCollapsed);
  const st = useStore.getState();
  const icon = (side: 'left' | 'bottom' | 'right', on: boolean) => (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      {side === 'left' && <rect x="2" y="3" width="4" height="10" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="0.8" />}
      {side === 'right' && <rect x="10" y="3" width="4" height="10" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="0.8" />}
      {side === 'bottom' && <rect x="2" y="9" width="12" height="4" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="0.8" />}
    </svg>
  );
  return (
    <div className="layout-toggles" role="group" aria-label="Layout">
      <button className={`icon-btn ${leftOpen ? 'on' : ''}`} onClick={() => st.setLeftOpen(!leftOpen)} title="Toggle side panel (Ctrl+B)" aria-label="Toggle side panel" data-testid="toggle-left">
        {icon('left', leftOpen)}
      </button>
      <button
        className={`icon-btn ${timelineOpen ? 'on' : ''}`}
        onClick={() => {
          st.setTimelineMaximized(false);
          st.setTimelineCollapsed(timelineOpen);
        }}
        title="Toggle timeline (Ctrl+J)"
        aria-label="Toggle timeline"
        data-testid="toggle-timeline"
      >
        {icon('bottom', timelineOpen)}
      </button>
      <button className={`icon-btn ${rightOpen ? 'on' : ''}`} onClick={() => st.setRightOpen(!rightOpen)} title="Toggle quick panel (Ctrl+Alt+B)" aria-label="Toggle quick panel" data-testid="toggle-right">
        {icon('right', rightOpen)}
      </button>
    </div>
  );
}
