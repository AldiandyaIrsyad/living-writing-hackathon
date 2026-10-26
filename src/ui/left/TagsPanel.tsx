// Tags tool: every #tag used in notes or prose, with how many entities and scenes use it.

import { useMemo } from 'react';
import { useStore, useVault } from '../../store/store';
import { allTags } from '../search';
import { PanelHeader } from './PanelHeader';

export function TagsPanel() {
  const vault = useVault();
  const view = useStore((s) => s.view);
  const navigate = useStore((s) => s.navigate);
  const tags = useMemo(() => allTags(vault), [vault]);
  const activeTag = view.kind === 'tag' ? view.tag : null;

  return (
    <>
      <PanelHeader title="Tags">
        <span className="lp-count">{tags.length}</span>
      </PanelHeader>
      <div className="lp-body">
        <div className="lp-list">
          {tags.length === 0 && <div className="lp-empty">No #tags yet.</div>}
          {tags.map((t) => {
            const on = activeTag === t.tag;
            return (
              <button
                key={t.tag}
                type="button"
                data-testid="side-tag"
                data-tag={t.tag}
                className={`lp-row lp-tag-row${on ? ' on' : ''}`}
                aria-current={on ? 'true' : undefined}
                onClick={() => navigate({ kind: 'tag', tag: t.tag })}
              >
                <span className="lp-tag-name">#{t.tag}</span>
                <span className="lp-row-count">{t.count}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
