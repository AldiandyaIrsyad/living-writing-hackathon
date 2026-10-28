// The collapsed timeline: a thin strip with the playhead readout. Click it to bring the timeline back.

import { useRef } from 'react';
import { getGraph, useStore, useVault } from '../../store/store';
import { describePlayhead } from '../follow';
import { ChapterStep } from './ChapterStep';
import './menus.css';

export function TimelineStrip() {
  const vault = useVault();
  const playhead = useStore((s) => s.playhead);
  const behaviour = useStore((s) => s.timelineBehaviour);
  const comesBack = useStore((s) => s.timelineComesBack);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cols = Math.max(1, getGraph(vault).columns);
  const expand = () => useStore.getState().setTimelineCollapsed(false);
  return (
    <div
      className="tl-strip"
      data-testid="tl-strip"
      title="Show timeline (Ctrl+J)"
      onClick={expand}
      onMouseEnter={() => {
        // Only for the timeline that comes back by itself; otherwise it takes a click.
        if (behaviour === 'autohide' && comesBack) hoverTimer.current = setTimeout(expand, 350);
      }}
      onMouseLeave={() => hoverTimer.current && clearTimeout(hoverTimer.current)}
    >
      <div className="tl-readout">
        <span className="tl-readout-dot" />
        {describePlayhead(vault, playhead)}
      </div>
      <div className="tl-strip-bar">
        <div className="tl-strip-fill" style={{ width: `${Math.min(100, (playhead / cols) * 100)}%` }} />
      </div>
      <ChapterStep />
      <span className="faint">Timeline</span>
      <kbd>Ctrl J</kbd>
    </div>
  );
}
