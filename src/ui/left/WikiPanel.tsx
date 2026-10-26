// Wiki tool: every entity of the world, as a tree (an entity sits under its parent). Narrow it to one type with the
// dropdown, or with that type's button on the activity bar; filter by text; open or create entities.

import { useEffect, useMemo, useState } from 'react';
import { TYPE_PRESETS, installPreset } from '../../core/presets';
import { baseRelations } from '../../core/relations';
import type { Id } from '../../core/types';
import { addEntity } from '../../store/actions';
import { useStore, useVault } from '../../store/store';
import { PanelHeader } from './PanelHeader';
import { ROW_LIMIT, matchesQuery, sortTypes } from './panelData';
import { TypeMenu, type TypeFilter } from './TypeMenu';
import { ancestorsToOpen, wikiRows } from './wikiTree';

export function WikiPanel() {
  const vault = useVault();
  const { entities, entityTypes, stories } = vault;
  const view = useStore((s) => s.view);
  const navigate = useStore((s) => s.navigate);
  const wikiType = useStore((s) => s.wikiType);
  const setWikiType = useStore((s) => s.setWikiType);

  const [filter, setFilter] = useState('');
  const [unfolded, setUnfolded] = useState<Set<Id>>(() => new Set());

  const types = useMemo(() => sortTypes(entityTypes), [entityTypes]);
  const sortedEntities = useMemo(() => Object.values(entities).sort((a, b) => a.name.localeCompare(b.name)), [entities]);
  const typeCounts = useMemo(() => {
    const m = new Map<Id, number>();
    for (const e of Object.values(entities)) m.set(e.typeId, (m.get(e.typeId) ?? 0) + 1);
    return m;
  }, [entities]);
  const relations = useMemo(() => baseRelations(vault), [vault]);

  // A remembered type may no longer exist (another vault, or the type was deleted).
  const activeFilter: TypeFilter = wikiType !== 'all' && entityTypes[wikiType] === undefined ? 'all' : wikiType;

  const q = filter.trim();
  const matched = useMemo(
    () => sortedEntities.filter((e) => (activeFilter === 'all' || e.typeId === activeFilter) && matchesQuery(e, q)),
    [sortedEntities, activeFilter, q],
  );
  const rows = useMemo(() => wikiRows(matched, relations.parents, unfolded, q !== ''), [matched, relations, unfolded, q]);
  const shown = rows.slice(0, ROW_LIMIT);
  const totalEntities = sortedEntities.length;
  const storyCount = Object.keys(stories).length;
  const activeType = activeFilter === 'all' ? undefined : entityTypes[activeFilter];
  const addLabel = activeType?.name ?? types[0]?.name ?? 'Person';
  const activeEntityId = view.kind === 'entity' ? view.id : null;

  // The entity being read stays findable: its ancestors unfold when it becomes the open one.
  useEffect(() => {
    if (activeEntityId === null) return;
    const open = ancestorsToOpen(activeEntityId, relations.parents);
    if (open.length === 0) return;
    setUnfolded((prev) => (open.every((id) => prev.has(id)) ? prev : new Set([...prev, ...open])));
    // Only when another entity opens: unfolding on every edit would undo a fold the author just made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEntityId]);

  const toggle = (id: Id) =>
    setUnfolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const newEntity = () => {
    const st = useStore.getState();
    let v = st.vault;
    const filterId = activeFilter !== 'all' && v.entityTypes[activeFilter] ? activeFilter : undefined;
    let typeId: Id | undefined = filterId ?? sortTypes(v.entityTypes)[0]?.id;
    if (typeId === undefined) {
      // A vault without any types: install the Person preset, then create the entity in it.
      const person = TYPE_PRESETS.find((p) => p.key === 'person');
      if (!person) return;
      const installed = installPreset(v, person);
      v = installed.vault;
      typeId = installed.id;
      st.toast('info', `Added type “${person.name}”`);
    }
    const typeName = v.entityTypes[typeId].name;
    const taken = new Set(Object.values(v.entities).map((e) => e.name));
    let name = `New ${typeName}`;
    for (let i = 2; taken.has(name); i++) name = `New ${typeName} ${i}`;
    const r = addEntity(v, { name, typeId });
    st.commit(r.vault);
    st.navigate({ kind: 'entity', id: r.id });
  };

  return (
    <>
      <PanelHeader title="Wiki">
        <button type="button" className="lp-add" data-testid="new-entity" title={`New ${addLabel}`} aria-label={`New ${addLabel}`} onClick={newEntity}>
          +
        </button>
      </PanelHeader>
      <div className="lp-body">
        <div className="lp-subhead">
          {activeType?.description ? activeType.description : `1 world · ${storyCount} ${storyCount === 1 ? 'story' : 'stories'}`}
        </div>

        <TypeMenu
          types={types}
          counts={typeCounts}
          total={totalEntities}
          value={activeFilter}
          onChange={setWikiType}
          onManage={() => navigate({ kind: 'types' })}
        />

        <div className="lp-search">
          <input
            className="lp-input"
            data-testid="world-filter"
            placeholder={activeType ? `Filter ${activeType.name.toLowerCase()}…` : 'Filter the wiki…'}
            aria-label="Filter the wiki"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setFilter('');
            }}
          />
          {filter !== '' && (
            <button type="button" className="lp-clear" aria-label="Clear filter" onClick={() => setFilter('')}>
              ×
            </button>
          )}
        </div>

        <div className="lp-list">
          {shown.map(({ entity: e, depth, hasChildren, open, key }) => {
            const type = entityTypes[e.typeId];
            const on = activeEntityId === e.id;
            return (
              <div key={key} className={`lp-row lp-split${on ? ' on' : ''}`} style={{ paddingLeft: `${6 + depth * 14}px` }}>
                {hasChildren ? (
                  <button
                    type="button"
                    className="lp-twisty"
                    data-testid="wiki-fold"
                    aria-expanded={open}
                    aria-label={`${open ? 'Collapse' : 'Expand'} ${e.name}`}
                    title={open ? 'Collapse' : 'Expand'}
                    onClick={() => toggle(e.id)}
                  >
                    {open ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className="lp-twisty-gap" aria-hidden="true" />
                )}
                <button
                  type="button"
                  className="lp-row-main"
                  data-testid="side-entity"
                  data-name={e.name}
                  aria-current={on ? 'true' : undefined}
                  onClick={() => navigate({ kind: 'entity', id: e.id })}
                >
                  <span className="lp-dot" style={{ background: type?.color ?? 'var(--fg-faint)' }} aria-hidden="true" />
                  <span className="lp-row-name">{e.name}</span>
                  {activeFilter === 'all' && <span className="lp-row-type">{type?.name ?? ''}</span>}
                </button>
                {view.kind === 'scene' && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    style={{ padding: '0 6px', fontSize: 11 }}
                    data-testid="wiki-float-btn"
                    title={`Open ${e.name} in floating window attached to current scene`}
                    aria-label={`Open ${e.name} in floating window`}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      useStore.getState().openFloatingEntity(e.id, view.id);
                    }}
                  >
                    ⧉
                  </button>
                )}
              </div>
            );
          })}
          {rows.length > ROW_LIMIT && <div className="lp-more">+{rows.length - ROW_LIMIT} more — refine the filter</div>}
          {totalEntities === 0 && <div className="lp-empty">No entities yet. Use + to create the first one.</div>}
          {totalEntities > 0 && matched.length === 0 && <div className="lp-empty">Nothing matches this filter.</div>}
        </div>
      </div>
    </>
  );
}
