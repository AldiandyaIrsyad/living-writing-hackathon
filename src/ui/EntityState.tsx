// Compact display of an entity's resolved state — used in hover cards, embeds and side panels.

import { atLabel } from '../core/anchor';
import type { ResolvedEntity } from '../core/resolve';
import { formatValue } from '../core/resolve';
import type { Vault } from '../core/types';

export function PropLines({ vault, state, limit, hide }: { vault: Vault; state: ResolvedEntity; limit?: number; hide?: string[] }) {
  const entries = Object.entries(state.props).filter(([k]) => !hide?.includes(k));
  const shown = limit ? entries.slice(0, limit) : entries;
  return (
    <div>
      {!state.exists && (
        <div className="prop-line">
          <span className="badge badge-warn" data-testid="not-existing">
            does not exist at this point
          </span>
        </div>
      )}
      {shown.map(([k, p]) => (
        <div className="prop-line" key={k} data-testid="prop-line" data-prop={k}>
          <span className="k">{k}</span>: <span className="v">{formatValue(p.value)}</span>
          {p.ambiguous && (
            <span
              className="badge badge-warn"
              title={`Order unknown — could also be: ${p.ambiguous.map((a) => `${formatValue(a.value)} (${vault.scenes[a.sceneId]?.title})`).join(', ')}`}
            >
              ambiguous
            </span>
          )}
          {p.sceneId ? <span className="src">{vault.scenes[p.sceneId]?.title}</span> : p.at !== undefined ? <span className="src">{atLabel(p.at)}</span> : null}
        </div>
      ))}
      {limit && entries.length > limit && <div className="faint small">+{entries.length - limit} more</div>}
      {!entries.length && <div className="faint small">No properties.</div>}
    </div>
  );
}
