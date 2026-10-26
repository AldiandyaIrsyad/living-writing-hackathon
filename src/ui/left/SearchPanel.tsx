// Search tool: live full-text search over entities and scenes, with highlighted snippets.

import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Entity, Scene, Vault } from '../../core/types';
import { useStore, useVault } from '../../store/store';
import { fullTextSearch, splitMatches, type SearchHit } from '../search';
import { PanelHeader } from './PanelHeader';

const RESULT_LIMIT = 50;

/** Colour dot and label for a hit: the entity's type, or the scene's story. */
function describeHit(vault: Vault, hit: SearchHit): { color: string; label: string } {
  if (hit.kind === 'entity') {
    const e: Entity | undefined = vault.entities[hit.id];
    const type = e ? vault.entityTypes[e.typeId] : undefined;
    return { color: type?.color ?? 'var(--fg-faint)', label: type?.name ?? 'Entity' };
  }
  const s: Scene | undefined = vault.scenes[hit.id];
  const story = s ? vault.stories[s.storyId] : undefined;
  return { color: story?.color ?? 'var(--fg-faint)', label: story?.name ?? 'Scene' };
}

export function SearchPanel() {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const [query, setQuery] = useState('');
  // The results follow the typing a beat later, so keystrokes stay responsive on large vaults.
  const deferred = useDeferredValue(query);
  const needle = deferred.trim();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const hits = useMemo(() => fullTextSearch(vault, needle, RESULT_LIMIT), [vault, needle]);

  const open = (hit: SearchHit) => {
    navigate(hit.kind === 'entity' ? { kind: 'entity', id: hit.id } : { kind: 'scene', id: hit.id });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setQuery('');
    } else if (e.key === 'Enter' && hits.length > 0) {
      open(hits[0]);
    }
  };

  return (
    <>
      <PanelHeader title="Search" />
      <div className="lp-body">
        <div className="lp-search">
          <input
            ref={inputRef}
            className="lp-input"
            type="text"
            data-testid="side-search"
            placeholder="Names, notes, scenes…"
            aria-label="Search the vault"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {query !== '' && (
            <button type="button" className="lp-clear" aria-label="Clear search" onClick={() => setQuery('')}>
              ×
            </button>
          )}
        </div>

        {needle !== '' && (
          <div className="lp-subhead" data-testid="side-search-count">
            {hits.length === RESULT_LIMIT ? `First ${RESULT_LIMIT} results` : `${hits.length} ${hits.length === 1 ? 'result' : 'results'}`}
          </div>
        )}

        <div className="lp-list">
          {needle === '' && <div className="lp-empty">Search entity names, aliases, notes, scene titles and prose.</div>}
          {needle !== '' && hits.length === 0 && <div className="lp-empty">No matches for “{needle}”.</div>}
          {hits.map((hit) => {
            const info = describeHit(vault, hit);
            const parts = splitMatches(hit.snippet, needle);
            return (
              <button
                key={`${hit.kind}:${hit.id}`}
                type="button"
                data-testid="side-search-result"
                data-kind={hit.kind}
                className="lp-result"
                onClick={() => open(hit)}
              >
                <span className="lp-result-head">
                  <span className="lp-dot" style={{ background: info.color }} aria-hidden="true" />
                  <span className="lp-row-name">{hit.title || (hit.kind === 'scene' ? 'Untitled scene' : 'Untitled')}</span>
                  <span className="lp-row-type">{info.label}</span>
                </span>
                <span className="lp-result-snippet">
                  {parts.map((p, i) =>
                    p.match ? (
                      <span key={i} className="lp-mark">
                        {p.text}
                      </span>
                    ) : (
                      <span key={i}>{p.text}</span>
                    ),
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <div className="lp-foot">
          <button
            type="button"
            className="lp-link"
            data-testid="side-search-open"
            disabled={needle === ''}
            onClick={() => navigate({ kind: 'search', query: needle })}
          >
            Open full search…
          </button>
        </div>
      </div>
    </>
  );
}
