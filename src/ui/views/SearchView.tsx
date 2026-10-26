// Full-text search over entity names and notes, and scene titles and prose. The query lives in the route.

import { useMemo } from 'react';
import { useStore, useVault } from '../../store/store';
import { fullTextSearch, splitMatches } from '../search';
import './views.css';

const RESULT_LIMIT = 100;

export function SearchView({ query }: { query: string }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const hits = useMemo(() => fullTextSearch(vault, query, RESULT_LIMIT), [vault, query]);
  const blank = query.trim() === '';

  let summary = 'Type to search across everything you have written.';
  if (!blank) {
    if (hits.length === RESULT_LIMIT) summary = `Showing the first ${RESULT_LIMIT} matches`;
    else if (hits.length === 0) summary = `No matches for “${query.trim()}”`;
    else summary = `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`;
  }

  return (
    <div className="view view-narrow">
      <header className="view-header">
        <h1 className="view-title">Search</h1>
      </header>
      <input
        className="input search-input"
        type="search"
        autoFocus
        aria-label="Search text"
        placeholder="Search names, notes, scene titles and prose"
        value={query}
        onChange={(e) => navigate({ kind: 'search', query: e.target.value })}
      />
      <p className="muted small search-summary">{summary}</p>
      <ul className="list search-results">
        {hits.map((hit) => (
          <li key={`${hit.kind}:${hit.id}`}>
            <button
              type="button"
              className="search-result"
              onClick={() => navigate(hit.kind === 'entity' ? { kind: 'entity', id: hit.id } : { kind: 'scene', id: hit.id })}
            >
              <span className="search-head">
                <span className="badge">{hit.kind === 'entity' ? 'Entity' : 'Scene'}</span>
                <span className="search-title">{hit.title || 'Untitled'}</span>
              </span>
              <span className="search-snippet">
                {splitMatches(hit.snippet, query).map((p, i) =>
                  p.match ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>,
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
