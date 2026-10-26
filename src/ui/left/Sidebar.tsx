// Left side: the activity bar (tools) and, when open, the panel of the selected tool.

import type { ReactNode } from 'react';
import { type LeftView, useStore } from '../../store/store';
import { ActivityBar } from './ActivityBar';
import { NotesPanel } from './NotesPanel';
import { SearchPanel } from './SearchPanel';
import { StoriesPanel } from './StoriesPanel';
import { TagsPanel } from './TagsPanel';
import { WikiPanel } from './WikiPanel';
import './left.css';

const PANEL_NAMES: Record<LeftView, string> = {
  stories: 'Stories',
  wiki: 'Wiki',
  search: 'Search',
  notes: 'Author notes',
  tags: 'Tags',
};

function renderPanel(view: LeftView): ReactNode {
  switch (view) {
    case 'stories':
      return <StoriesPanel />;
    case 'wiki':
      return <WikiPanel />;
    case 'search':
      return <SearchPanel />;
    case 'notes':
      return <NotesPanel />;
    case 'tags':
      return <TagsPanel />;
  }
}

export function Sidebar() {
  const leftOpen = useStore((s) => s.leftOpen);
  const leftView = useStore((s) => s.leftView);

  return (
    <div className="sidebar-shell">
      <ActivityBar />
      {leftOpen && (
        // Keyed by tool so each panel mounts fresh (and plays its short entrance).
        <nav key={leftView} className="sidebar left-panel" data-testid="sidebar" aria-label={PANEL_NAMES[leftView]}>
          {renderPanel(leftView)}
        </nav>
      )}
    </div>
  );
}
