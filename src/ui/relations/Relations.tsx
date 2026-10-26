// Relations on the entity page: parents, children and siblings, with a place to add each. Setting a child sets the
// parent (one stored link, seen from both pages); siblings that share a parent are listed without a link to remove.
// Every edit lands "from the start" or after a scene, like affiliations; see core/relations.ts.

import { useState } from 'react';
import { addParent, addSibling, relationsAt, removeParent, removeSibling, wouldLoop } from '../../core/relations';
import type { Entity, Id, Scene, TimePoint, Vault } from '../../core/types';
import { getResolver, useStore, useVault } from '../../store/store';
import { commitAffiliation, WhenSelect, whereOf } from '../affiliations/Affiliations';
import '../affiliations/affiliations.css';
import '../relations/relations.css';

interface ChipProps {
  vault: Vault;
  id: Id;
  kind: 'parent' | 'child' | 'sibling';
  tp: TimePoint;
  /** Absent when there is no link to remove (a sibling through a shared parent). */
  onRemove?: () => void;
  removeLabel: string;
}

function Chip({ vault, id, kind, tp, onRemove, removeLabel }: ChipProps) {
  const navigate = useStore((s) => s.navigate);
  const other = vault.entities[id];
  const type = vault.entityTypes[other.typeId];
  return (
    <span className="aff-chip-wrap">
      <button
        type="button"
        className="aff-chip"
        data-testid="relation-chip"
        data-kind={kind}
        data-name={other.name}
        title={onRemove ? `Open ${other.name}` : `Open ${other.name} (shares a parent)`}
        onClick={() => navigate({ kind: 'entity', id, at: tp })}
      >
        <span className="aff-dot" style={{ background: type?.color }} aria-hidden />
        {other.name}
      </button>
      {onRemove && (
        <button type="button" className="aff-x" aria-label={removeLabel} title={removeLabel} onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  );
}

function AddSelect({ label, testId, options, onPick }: { label: string; testId: string; options: Entity[]; onPick: (id: Id) => void }) {
  const vault = useVault();
  return (
    <select
      className="select small rel-add"
      aria-label={label}
      data-testid={testId}
      value=""
      disabled={options.length === 0}
      onChange={(e) => e.target.value && onPick(e.target.value)}
    >
      <option value="">{options.length === 0 ? 'Nothing to add' : label}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name} · {vault.entityTypes[o.typeId]?.name ?? ''}
        </option>
      ))}
    </select>
  );
}

/** Entity page panel: the parents, children and siblings of the entity at a point in time. */
export function RelationsPanel({ entity, tp, sceneOptions }: { entity: Entity; tp: TimePoint; sceneOptions: Scene[] }) {
  const vault = useVault();
  const [when, setWhen] = useState('base');
  const type = vault.entityTypes[entity.typeId];
  const rel = relationsAt(getResolver(vault), tp);
  const parents = rel.parents(entity.id);
  const children = rel.children(entity.id);
  const siblings = rel.siblings(entity.id);
  const viaParent = new Set(parents.flatMap((p) => rel.children(p)));

  const others = Object.values(vault.entities)
    .filter((e) => e.id !== entity.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  const parentOptions = others.filter((e) => !parents.includes(e.id) && !wouldLoop(rel, entity.id, e.id));
  const childOptions = others.filter((e) => !children.includes(e.id) && !wouldLoop(rel, e.id, entity.id));
  const siblingOptions = others.filter((e) => !siblings.includes(e.id));

  const apply = (fn: (v: Vault, where: ReturnType<typeof whereOf>) => Vault) => commitAffiliation((v) => fn(v, whereOf(when)));
  const parentLabel = type?.parentLabel || 'Parents';
  const childrenLabel = type?.childrenLabel || 'Children';

  return (
    <section className="panel" data-testid="relations-panel">
      <div className="panel-head">Relations</div>
      <div className="panel-body stack">
        <div className="rel-group">
          <div className="rel-label small">{parentLabel}</div>
          <div className="aff-chips">
            {parents.map((id) => (
              <Chip
                key={id}
                vault={vault}
                id={id}
                kind="parent"
                tp={tp}
                removeLabel={`Remove ${vault.entities[id].name} as a parent`}
                onRemove={() => apply((v, where) => removeParent(v, entity.id, id, where))}
              />
            ))}
            {parents.length === 0 && <span className="faint small">None</span>}
          </div>
          <AddSelect label={`Add to ${parentLabel.toLowerCase()}…`} testId="rel-add-parent" options={parentOptions} onPick={(id) => apply((v, where) => addParent(v, entity.id, id, where))} />
        </div>

        <div className="rel-group">
          <div className="rel-label small">{childrenLabel}</div>
          <div className="aff-chips">
            {children.map((id) => (
              <Chip
                key={id}
                vault={vault}
                id={id}
                kind="child"
                tp={tp}
                removeLabel={`Remove ${vault.entities[id].name} from ${childrenLabel.toLowerCase()}`}
                onRemove={() => apply((v, where) => removeParent(v, id, entity.id, where))}
              />
            ))}
            {children.length === 0 && <span className="faint small">None</span>}
          </div>
          <AddSelect label={`Add to ${childrenLabel.toLowerCase()}…`} testId="rel-add-child" options={childOptions} onPick={(id) => apply((v, where) => addParent(v, id, entity.id, where))} />
        </div>

        <div className="rel-group">
          <div className="rel-label small">Siblings</div>
          <div className="aff-chips">
            {siblings.map((id) => (
              <Chip
                key={id}
                vault={vault}
                id={id}
                kind="sibling"
                tp={tp}
                removeLabel={`Remove ${vault.entities[id].name} as a sibling`}
                onRemove={viaParent.has(id) ? undefined : () => apply((v, where) => removeSibling(v, entity.id, id, where))}
              />
            ))}
            {siblings.length === 0 && <span className="faint small">None</span>}
          </div>
          <AddSelect label="Add a sibling…" testId="rel-add-sibling" options={siblingOptions} onPick={(id) => apply((v, where) => addSibling(v, entity.id, id, where))} />
        </div>

        <div className="rel-when row small">
          <span className="faint">Changes apply</span>
          <WhenSelect scenes={sceneOptions} value={when} onChange={setWhen} testId="rel-when" />
        </div>
      </div>
    </section>
  );
}
