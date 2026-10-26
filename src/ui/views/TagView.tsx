// Tag page: everything tagged #tag (or one of its sub-tags), plus the sub-tags in use.

import { useMemo } from 'react';
import { useStore, useVault } from '../../store/store';
import { allTags, itemsWithTag } from '../search';
import './views.css';

export function TagView({ tag }: { tag: string }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const name = tag.replace(/^#/, '');
  const items = useMemo(() => itemsWithTag(vault, name), [vault, name]);
  const subTags = useMemo(
    () => allTags(vault).filter((t) => t.tag.startsWith(`${name}/`)),
    [vault, name],
  );

  return (
    <div className="view view-narrow">
      <header className="view-header">
        <h1 className="view-title">#{name}</h1>
      </header>
      <p className="muted small">
        {items.length} {items.length === 1 ? 'item' : 'items'} tagged
      </p>

      {subTags.length > 0 && (
        <>
          <div className="section-title">Sub-tags</div>
          <div className="chip-row">
            {subTags.map((t) => (
              <button
                key={t.tag}
                type="button"
                className="chip chip-button"
                onClick={() => navigate({ kind: 'tag', tag: t.tag })}
              >
                #{t.tag} <span className="muted">{t.count}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="section-title">Tagged</div>
      {items.length > 0 ? (
        <ul className="list tag-items">
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`}>
              <button
                type="button"
                className="list-item list-button"
                onClick={() =>
                  navigate(item.kind === 'entity' ? { kind: 'entity', id: item.id } : { kind: 'scene', id: item.id })
                }
              >
                <span className="badge">{item.kind === 'entity' ? 'Entity' : 'Scene'}</span>
                <span className="grow">{item.title || 'Untitled'}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nothing is tagged #{name} yet.</p>
      )}
    </div>
  );
}
