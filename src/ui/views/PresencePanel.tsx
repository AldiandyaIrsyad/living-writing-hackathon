// A place's page lists who is there at the selected time (from their `location`), and who may be.

import { useMemo } from 'react';
import { presenceAt } from '../../core/presence';
import type { TimePoint } from '../../core/types';
import { getResolver, useStore, useVault } from '../../store/store';

export function PresencePanel({ entityId, tp }: { entityId: string; tp: TimePoint }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const presence = useMemo(() => presenceAt(vault, getResolver(vault), entityId, tp), [vault, entityId, tp]);
  if (presence.here.length === 0 && presence.maybe.length === 0) return null;
  const contested = new Set(presence.contested);
  const name = (id: string) => vault.entities[id].name;
  const link = (id: string, note?: string) => (
    <li key={id}>
      <button type="button" className="btn btn-sm btn-ghost" data-testid="presence-entry" onClick={() => navigate({ kind: 'entity', id })}>
        {name(id)}
      </button>
      {note && <span className="faint small"> {note}</span>}
    </li>
  );
  return (
    <section className="panel" data-testid="presence-panel">
      <div className="panel-head">Here at this time</div>
      <div className="panel-body">
        <ul className="query-list">
          {presence.here.map((id) => link(id, contested.has(id) ? '(or elsewhere: two moves, no known order)' : undefined))}
          {presence.maybe.map((id) => link(id, '(maybe: a move with no known order)'))}
        </ul>
      </div>
    </section>
  );
}
