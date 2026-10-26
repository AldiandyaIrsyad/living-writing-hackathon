// The 44px icon strip on the left edge. Each tool button selects its panel; clicking the open one collapses it.
// The bottom of the strip is the wiki: its own button for everything, then one button per entity type while there
// are few of them (with many types the Wiki button's panel is where you pick one), and a + for a new type.

import { useMemo } from 'react';
import { sortedTypes } from '../../store/actions';
import { type LeftView, useStore, useVault } from '../../store/store';
import { ActIcon, TypeIcon, type IconName } from './icons';
import { countAuthorNotes } from './panelData';

interface Tool {
  view: LeftView;
  label: string;
  testid: string;
  icon: IconName;
}

const TOOLS: Tool[] = [
  { view: 'stories', label: 'Stories', testid: 'act-stories', icon: 'book' },
  { view: 'search', label: 'Search', testid: 'act-search', icon: 'search' },
  { view: 'notes', label: 'Author notes', testid: 'act-notes', icon: 'pencil' },
  { view: 'tags', label: 'Tags', testid: 'act-tags', icon: 'hash' },
];

/** Up to this many types get a button of their own; more than that and the strip only shows the Wiki button. */
export const MAX_TYPE_BUTTONS = 5;

export function ActivityBar() {
  const vault = useVault();
  const leftView = useStore((s) => s.leftView);
  const leftOpen = useStore((s) => s.leftOpen);
  const wikiType = useStore((s) => s.wikiType);
  const setLeftView = useStore((s) => s.setLeftView);
  const openWiki = useStore((s) => s.openWiki);
  const navigate = useStore((s) => s.navigate);
  const noteCount = useMemo(() => countAuthorNotes(vault), [vault]);
  const types = useMemo(() => sortedTypes(vault), [vault]);
  const wikiShown = leftOpen && leftView === 'wiki';
  // A remembered type may be gone (another vault, or it was deleted): then the panel shows everything.
  const shownType = wikiType !== 'all' && vault.entityTypes[wikiType] === undefined ? 'all' : wikiType;

  return (
    <div className="act-bar" role="toolbar" aria-orientation="vertical" aria-label="Side tools">
      {TOOLS.map((t) => {
        const pressed = leftOpen && leftView === t.view;
        const badge = t.view === 'notes' && noteCount > 0 ? (noteCount > 99 ? '99+' : String(noteCount)) : null;
        return (
          <button
            key={t.view}
            type="button"
            className="act-btn"
            data-testid={t.testid}
            aria-label={t.label}
            aria-pressed={pressed}
            title={t.view === 'notes' && noteCount > 0 ? `${t.label} (${noteCount})` : t.label}
            onClick={() => setLeftView(t.view)}
          >
            <ActIcon name={t.icon} />
            {badge !== null && (
              <span className="act-badge" data-testid="act-notes-count">
                {badge}
              </span>
            )}
          </button>
        );
      })}

      <div className="act-spacer" />

      <div className="act-group" role="group" aria-label="Wiki">
        <button
          type="button"
          className="act-btn"
          data-testid="act-wiki"
          aria-label="Wiki"
          aria-pressed={wikiShown && shownType === 'all'}
          title={types.length > MAX_TYPE_BUTTONS ? 'Wiki: every type' : 'Wiki: everything'}
          onClick={() => openWiki('all')}
        >
          <ActIcon name="library" />
        </button>
        {types.length <= MAX_TYPE_BUTTONS &&
          types.map((t) => (
            <button
              key={t.id}
              type="button"
              className="act-btn act-type"
              data-testid="act-type"
              data-type={t.name}
              aria-label={t.name}
              aria-pressed={wikiShown && shownType === t.id}
              title={t.description ? `${t.name}: ${t.description}` : t.name}
              onClick={() => openWiki(t.id)}
            >
              <TypeIcon icon={t.icon} name={t.name} color={t.color} />
            </button>
          ))}
        <button type="button" className="act-btn" data-testid="act-type-new" aria-label="New entity type" title="New entity type" onClick={() => navigate({ kind: 'types' })}>
          <ActIcon name="plus" />
        </button>
      </div>
    </div>
  );
}
