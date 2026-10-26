// The page of a saved query shows who matches it now: the smart list updates as the playhead moves (or is fixed by an
// `at latest` / `at Scene title` clause in the query).

import { useMemo } from 'react';
import { answerStateQuery, parseStateQuery } from '../../core/stateQuery';
import { isQueryPage, queryTextOf } from '../../store/savedQueries';
import { getResolver, useStore, useVault } from '../../store/store';

export function QueryResults({ entityId }: { entityId: string }) {
  const vault = useVault();
  const playhead = useStore((s) => s.playhead);
  const navigate = useStore((s) => s.navigate);
  const note = vault.entities[entityId]?.note ?? '';
  const answer = useMemo((): { error: string } | { ids: string[]; fixed: boolean } => {
    const text = queryTextOf(note);
    if (text === null) return { error: 'This page has no query. Add a line such as “where type=Character status=alive”.' };
    const parsed = parseStateQuery(text);
    if (!parsed.ok) return { error: parsed.error };
    const result = answerStateQuery(vault, getResolver(vault), parsed.query, playhead);
    return result.ok ? { ids: result.ids, fixed: parsed.query.when.kind !== 'playhead' } : { error: result.error };
  }, [vault, note, playhead]);

  if (!isQueryPage(vault, entityId)) return null;
  return (
    <section className="panel" data-testid="query-results">
      <div className="panel-head">
        Matches
        {'ids' in answer && (
          <span className="faint small" data-testid="query-count">
            {' '}
            {answer.ids.length} {answer.fixed ? '' : 'at the playhead'}
          </span>
        )}
      </div>
      <div className="panel-body">
        {'error' in answer ? (
          <div className="faint small" data-testid="query-error">
            {answer.error}
          </div>
        ) : answer.ids.length === 0 ? (
          <div className="faint small">Nobody matches.</div>
        ) : (
          <ul className="query-list">
            {answer.ids.map((id) => (
              <li key={id}>
                <button type="button" className="btn btn-sm btn-ghost" data-testid="query-match" onClick={() => navigate({ kind: 'entity', id })}>
                  {vault.entities[id].name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
