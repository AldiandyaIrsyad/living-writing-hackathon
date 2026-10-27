// The timeline's toolbar: playhead readout, fit, drag mode, highlight, shortcuts and behaviour menus, and the + Track menu.

import { TIMELINE_SHORTCUTS } from '../shortcuts';
import { Fragment, useEffect, useRef, useState } from 'react';
import { addStandaloneMilestone } from '../../core/labels';
import { useStore, useVault, type StateTime, type TimelineBehaviour } from '../../store/store';
import { createStory } from '../stories';
import { HighlightPicker } from './HighlightPicker';
import { HEADER_W } from './model';

export function Toolbar({
  readout,
  mode,
  onFit,
  nav,
}: {
  readout: string;
  mode: 'move' | 'constrain';
  onFit: () => void;
  /** Back and forward through the views jumped between. */
  nav: { canBack: boolean; canForward: boolean; onBack: () => void; onForward: () => void };
}) {
  const maximized = useStore((s) => s.timelineMaximized);
  const s = useStore.getState();
  return (
    <div className="tl-toolbar">
      <div className="tl-readout" title="Playhead — where you are in the story" data-testid="tl-readout">
        <span className="tl-readout-dot" />
        {readout}
      </div>
      <button className="tl-btn" onClick={onFit} title="Fit the whole work" data-testid="tl-fit">
        Fit
      </button>
      <div className="tl-group tl-seg" role="group" aria-label="View history">
        <button className="tl-btn" onClick={nav.onBack} disabled={!nav.canBack} title="Back to the previous view (Alt+[)" aria-label="Back to the previous view" data-testid="tl-view-back">
          ‹
        </button>
        <button className="tl-btn" onClick={nav.onForward} disabled={!nav.canForward} title="Forward to the next view (Alt+])" aria-label="Forward to the next view" data-testid="tl-view-forward">
          ›
        </button>
      </div>
      <div className="tl-group tl-seg" role="group" aria-label="Drag mode">
        <button className={`tl-btn ${mode === 'move' ? 'on' : ''}`} onClick={() => s.setTimelineMode('move')} data-testid="mode-move" title="Dragging moves scenes to a new place in time">
          Move
        </button>
        <button
          className={`tl-btn ${mode === 'constrain' ? 'on' : ''}`}
          onClick={() => s.setTimelineMode('constrain')}
          data-testid="mode-constrain"
          title="Dragging only adds an ordering rule; current placement is kept"
        >
          Constrain
        </button>
      </div>
      {!maximized && (
        <button className="tl-minimize" onClick={() => s.setTimelineCollapsed(true)} title="Minimize the timeline (Ctrl+J)" data-testid="tl-minimize">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Minimize<span className="tl-minimize-long"> timeline</span>
        </button>
      )}
      <span className="grow" />
      <MilestoneMenu />
      <HighlightPicker />
      <ShortcutsMenu />
      <BehaviourMenu />
      <button className="tl-btn" onClick={() => s.setTimelineMaximized(!maximized)} title={maximized ? 'Restore' : 'Maximise timeline'} data-testid="tl-maximize">
        {maximized ? '▾' : '▴'}
      </button>
      <button className="tl-btn" onClick={() => s.setTimelineCollapsed(true)} title="Hide timeline (Ctrl+J)" data-testid="tl-hide">
        ✕
      </button>
    </div>
  );
}


function MilestoneMenu() {
  const [open, setOpen, ref] = usePopover();
  const [label, setLabel] = useState('');
  const [concrete, setConcrete] = useState('');

  const submit = () => {
    const l = label.trim();
    const c = concrete.trim();
    if (!l && !c) return;
    const s = useStore.getState();
    const res = addStandaloneMilestone(s.vault, {
      label: l || undefined,
      concrete: c || undefined,
    });
    if (!res.ok) {
      s.toast('error', res.error);
      return;
    }
    s.commit(res.vault);
    s.toast('info', `Added milestone ${[l && `“${l}”`, c].filter(Boolean).join(' · ')}`);
    setLabel('');
    setConcrete('');
    setOpen(false);
  };

  return (
    <div className="tl-pop-wrap" ref={ref}>
      <button
        type="button"
        className="tl-btn"
        onClick={() => setOpen(!open)}
        title="Pin a standalone milestone label or concrete date on the timeline"
        aria-expanded={open}
        data-testid="tl-add-milestone"
      >
        + Milestone
      </button>
      {open && (
        <div className="tl-pop tl-pop-right" role="dialog" aria-label="Add milestone" style={{ minWidth: 260, padding: 10 }}>
          <div className="tl-pop-title" style={{ marginBottom: 6 }}>Add Milestone / Concrete Anchor</div>
          <div className="stack" style={{ gap: 6 }}>
            <input
              className="input small"
              placeholder="Label (e.g. The Death of Hero Nora)"
              aria-label="Milestone label"
              data-testid="tl-milestone-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())}
            />
            <input
              className="input small"
              placeholder="Concrete date (e.g. Winter, 2027)"
              aria-label="Milestone concrete date"
              data-testid="tl-milestone-concrete"
              value={concrete}
              onChange={(e) => setConcrete(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())}
            />
            <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                data-testid="tl-milestone-submit"
                disabled={!label.trim() && !concrete.trim()}
                onClick={submit}
              >
                Add milestone
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ShortcutsMenu() {
  const [open, setOpen, ref] = usePopover();
  return (
    <div className="tl-pop-wrap" ref={ref}>
      <button className="tl-btn" onClick={() => setOpen(!open)} title="Keyboard shortcuts" aria-label="Keyboard shortcuts" aria-expanded={open} data-testid="tl-shortcuts">
        ?
      </button>
      {open && (
        <div className="tl-pop tl-pop-right tl-pop-keys" role="dialog" aria-label="Timeline shortcuts">
          <div className="tl-pop-title">Timeline shortcuts</div>
          {TIMELINE_SHORTCUTS.map((sc) => (
            <div key={sc.what} className="tl-key-row">
              <span className="tl-key-keys">
                {sc.keys.map((k, i) => (
                  <Fragment key={k}>
                    {i > 0 && <span className="tl-key-plus">+</span>}
                    <kbd className="tl-kbd">{k}</kbd>
                  </Fragment>
                ))}
              </span>
              <span className="tl-key-what">{sc.what}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function usePopover(): [boolean, (open: boolean) => void, React.RefObject<HTMLDivElement | null>] {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return [open, setOpen, ref];
}

const BEHAVIOURS: { id: TimelineBehaviour; label: string; hint: string }[] = [
  { id: 'always', label: 'Always show', hint: 'The timeline stays put while you write.' },
  { id: 'autohide', label: 'Auto-hide while typing', hint: 'Collapses when you type in an editor; hover the strip or press Esc to bring it back.' },
  { id: 'hidden', label: 'Hidden', hint: 'Only shows when you ask for it (Ctrl+J).' },
];

const STATE_TIMES: { id: StateTime; label: string; hint: string }[] = [
  { id: 'timeline', label: 'Follow the timeline', hint: 'A character or wiki page shows its state at the playhead; step between its changes with the arrows.' },
  { id: 'slider', label: 'Its own slider', hint: 'Each page has a slider over every scene of every story, separate from the playhead.' },
];

const HEIGHTS = [
  { id: 'fit', fit: true, label: 'Fit its tracks', hint: 'As tall as its tracks need, up to nearly half the window.' },
  { id: 'fixed', fit: false, label: 'As I dragged it', hint: 'Keeps the height you gave it by dragging its top edge.' },
];

function BehaviourMenu() {
  const behaviour = useStore((s) => s.timelineBehaviour);
  const stateTime = useStore((s) => s.stateTime);
  const fit = useStore((s) => s.timelineFit);
  const [open, setOpen, ref] = usePopover();
  return (
    <div className="tl-pop-wrap" ref={ref}>
      <button className="tl-btn" onClick={() => setOpen(!open)} title="Timeline behaviour while writing" data-testid="tl-settings">
        ⚙
      </button>
      {open && (
        <div className="tl-pop tl-pop-right">
          <div className="tl-pop-title">While writing</div>
          {BEHAVIOURS.map((b) => (
            <button
              key={b.id}
              className={`tl-pop-item ${behaviour === b.id ? 'on' : ''}`}
              onClick={() => {
                useStore.getState().setTimelineBehaviour(b.id);
                setOpen(false);
              }}
              data-testid={`tl-behaviour-${b.id}`}
            >
              <span className="tl-pop-check">{behaviour === b.id ? '●' : '○'}</span>
              <span>
                <span className="tl-pop-label">{b.label}</span>
                <span className="tl-pop-hint">{b.hint}</span>
              </span>
            </button>
          ))}
          <div className="tl-pop-sep" />
          <div className="tl-pop-title">State panel time</div>
          {STATE_TIMES.map((b) => (
            <button key={b.id} className={`tl-pop-item ${stateTime === b.id ? 'on' : ''}`} onClick={() => useStore.getState().setStateTime(b.id)} data-testid={`tl-state-time-${b.id}`}>
              <span className="tl-pop-check">{stateTime === b.id ? '●' : '○'}</span>
              <span>
                <span className="tl-pop-label">{b.label}</span>
                <span className="tl-pop-hint">{b.hint}</span>
              </span>
            </button>
          ))}
          <div className="tl-pop-sep" />
          <div className="tl-pop-title">Timeline height</div>
          {HEIGHTS.map((b) => (
            <button key={b.id} className={`tl-pop-item ${fit === b.fit ? 'on' : ''}`} onClick={() => useStore.getState().setTimelineFit(b.fit)} data-testid={`tl-height-${b.id}`}>
              <span className="tl-pop-check">{fit === b.fit ? '●' : '○'}</span>
              <span>
                <span className="tl-pop-label">{b.label}</span>
                <span className="tl-pop-hint">{b.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Re-add stories that were removed from the timeline, or start a new one. */
export function AddTrackMenu() {
  const vault = useVault();
  const hidden = useStore((s) => s.hiddenStories);
  const cast = useStore((s) => s.castTracks);
  const [open, setOpen, ref] = usePopover();
  // The list opens over the whole window, not just the timeline: it is fixed above the button.
  const [pos, setPos] = useState<{ left: number; bottom: number; maxHeight: number } | null>(null);
  const [filter, setFilter] = useState('');
  const offTimeline = Object.values(vault.entities)
    .filter((e) => !cast.includes(e.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const shown = offTimeline.filter((e) => e.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const removed = Object.values(vault.stories)
    .filter((st) => hidden.includes(st.id))
    .sort((a, b) => a.order - b.order);
  return (
    <div className="tl-addtrack" style={{ width: HEADER_W }} ref={ref}>
      <button
        className="tl-btn"
        onClick={(e) => {
          if (!open) {
            const r = e.currentTarget.getBoundingClientRect();
            setPos({ left: r.left, bottom: window.innerHeight - r.top + 4, maxHeight: r.top - 56 });
            setFilter('');
          }
          setOpen(!open);
        }}
        data-testid="tl-add-track"
      >
        + Track{removed.length ? ` · ${removed.length} off` : ''}
      </button>
      {open && (
        <div className="tl-pop tl-pop-up" style={pos ?? undefined}>
          <div className="tl-pop-title">Add to timeline</div>
          {!removed.length && <div className="tl-pop-hint tl-pop-note">Every story is already on the timeline.</div>}
          {removed.map((st) => (
            <button
              key={st.id}
              className="tl-pop-item"
              data-testid="tl-add-track-option"
              data-story={st.name}
              onClick={() => {
                useStore.getState().toggleStoryHidden(st.id);
                setOpen(false);
              }}
            >
              <span className="story-swatch" style={{ background: st.color }} />
              <span className="tl-pop-label">{st.name}</span>
            </button>
          ))}
          {offTimeline.length > 0 && (
            <>
              <div className="tl-pop-sep" />
              <div className="tl-pop-title">Characters &amp; wiki pages</div>
              {offTimeline.length > 6 && <input className="input small tl-pop-filter" placeholder="Find a page…" aria-label="Find a page" data-testid="tl-add-cast-filter" autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} />}
              {shown.map((e) => (
                <button
                  key={e.id}
                  className="tl-pop-item"
                  data-testid="tl-add-cast-option"
                  data-entity={e.name}
                  onClick={() => {
                    useStore.getState().toggleCastTrack(e.id);
                    setOpen(false);
                  }}
                >
                  <span className="story-swatch" style={{ background: vault.entityTypes[e.typeId]?.color ?? '#888' }} />
                  <span className="tl-pop-label">{e.name}</span>
                </button>
              ))}
            </>
          )}
          <div className="tl-pop-sep" />
          <button
            className="tl-pop-item"
            data-testid="tl-add-story"
            onClick={() => {
              createStory();
              setOpen(false);
            }}
          >
            <span className="tl-pop-check">+</span>
            <span className="tl-pop-label">New story</span>
          </button>
        </div>
      )}
    </div>
  );
}
