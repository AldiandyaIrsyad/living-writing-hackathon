// Type dropdown for the World panel. Picks the type filter, and adds a type from the presets
// or as a custom type, all inside the same popover. Keys: arrows move, Enter picks, Esc backs out.

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { TYPE_PRESETS, installPreset, presetInstalled, type TypePreset } from '../../core/presets';
import type { EntityType, Id, Vault } from '../../core/types';
import { addEntityType } from '../../store/actions';
import { useStore, useVault } from '../../store/store';

/** A type id, or 'all' for every entity. */
export type TypeFilter = Id | 'all';

const DEFAULT_CUSTOM_COLOUR = '#64748b';

interface TypeMenuProps {
  /** Types in display order. */
  types: EntityType[];
  /** Entity count per type id. */
  counts: Map<Id, number>;
  /** Entity count across all types. */
  total: number;
  value: TypeFilter;
  onChange: (filter: TypeFilter) => void;
  onManage: () => void;
}

export function TypeMenu({ types, counts, total, value, onChange, onManage }: TypeMenuProps) {
  const vault = useVault();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'list' | 'add'>('list');
  const [customName, setCustomName] = useState('');
  const [customColour, setCustomColour] = useState(DEFAULT_CUSTOM_COLOUR);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const current = value === 'all' ? undefined : types.find((t) => t.id === value);
  const shownCount = current ? (counts.get(current.id) ?? 0) : total;

  /** Closes the popover. Pass true to return focus to the trigger. */
  const close = (restoreFocus: boolean) => {
    setOpen(false);
    setView('list');
    if (restoreFocus) triggerRef.current?.focus();
  };

  const choose = (filter: TypeFilter) => {
    onChange(filter);
    close(true);
  };

  // Move focus to the current item when the popover opens or changes view.
  useEffect(() => {
    if (!open) return;
    const pop = popRef.current;
    if (!pop) return;
    const target =
      pop.querySelector<HTMLElement>('[data-nav-item][aria-checked="true"]') ??
      pop.querySelector<HTMLElement>('[data-nav-item]:not(:disabled)');
    target?.focus();
  }, [open, view]);

  const onPopKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (view === 'add') setView('list');
      else close(true);
      return;
    }
    // Arrow keys belong to the text field while it has focus.
    if (e.target instanceof HTMLInputElement) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-nav-item]:not(:disabled)'));
    if (items.length === 0) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const last = items.length - 1;
    let next: number;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else if (e.key === 'ArrowDown') next = i < 0 || i >= last ? 0 : i + 1;
    else next = i <= 0 ? last : i - 1;
    items[next]?.focus();
  };

  const addPreset = (preset: TypePreset) => {
    const store = useStore.getState();
    if (presetInstalled(store.vault, preset)) return;
    const result = installPreset(store.vault, preset);
    store.commit(result.vault);
    store.toast('info', `Added type “${preset.name}”`);
    choose(result.id);
  };

  const createCustom = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = customName.trim();
    if (!trimmed) return;
    const store = useStore.getState();
    if (typeNameTaken(store.vault, trimmed)) {
      store.toast('error', `A type named “${trimmed}” already exists`);
      return;
    }
    const created = addEntityType(store.vault, { name: trimmed, color: customColour });
    store.commit(created.vault);
    store.toast('info', `Created type “${trimmed}”`);
    setCustomName('');
    choose(created.id);
  };

  return (
    <div
      className="lp-type"
      ref={rootRef}
      onBlur={(e) => {
        if (open && !(e.relatedTarget instanceof Node && rootRef.current?.contains(e.relatedTarget))) close(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="lp-type-trigger"
        data-testid="type-select"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {current && <span className="lp-dot" style={{ background: current.color }} aria-hidden="true" />}
        <span className="lp-type-label">{current ? current.name : 'All types'}</span>
        <span className="lp-type-count">· {shownCount}</span>
        <span className="lp-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div id={menuId} ref={popRef} className="lp-type-pop" tabIndex={-1} onKeyDown={onPopKeyDown}>
          {view === 'list' ? (
            <>
              <div role="menu" aria-label="Filter by type">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === 'all'}
                  data-nav-item
                  data-testid="type-option"
                  data-type="all"
                  className="lp-type-opt"
                  onClick={() => choose('all')}
                >
                  <span className="lp-type-name">All types</span>
                  <span className="lp-type-n">{total}</span>
                </button>
                {types.map((t) => {
                  const n = counts.get(t.id) ?? 0;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={value === t.id}
                      data-nav-item
                      data-testid="type-option"
                      data-type={t.name}
                      className="lp-type-opt"
                      onClick={() => choose(t.id)}
                    >
                      <span className="lp-dot" style={{ background: t.color }} aria-hidden="true" />
                      <span className="lp-type-name">{t.name}</span>
                      {n > 0 ? (
                        <span className="lp-type-n">{n}</span>
                      ) : (
                        <span className="lp-type-unused" title="No entities use this type yet">
                          unused
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="lp-type-div" role="separator" />
              <button
                type="button"
                role="menuitem"
                data-nav-item
                data-testid="type-add"
                className="lp-type-opt lp-type-accent"
                onClick={() => setView('add')}
              >
                + Add type
              </button>
              <button
                type="button"
                role="menuitem"
                data-nav-item
                className="lp-type-opt lp-type-faint"
                onClick={() => {
                  close(false);
                  onManage();
                }}
              >
                Manage types…
              </button>
            </>
          ) : (
            <div className="lp-type-add" role="group" aria-label="Add type">
              <div className="lp-type-head">
                <button type="button" data-nav-item className="lp-link" onClick={() => setView('list')}>
                  ← Back
                </button>
                <span className="lp-grow" />
                <span className="lp-type-section-title">Add type</span>
              </div>

              <div className="lp-type-section">Presets</div>
              <ul className="lp-type-presets">
                {TYPE_PRESETS.map((p) => {
                  const installed = presetInstalled(vault, p);
                  return (
                    <li key={p.key}>
                      <button
                        type="button"
                        data-nav-item
                        data-testid="type-preset-option"
                        data-preset={p.key}
                        disabled={installed}
                        title={p.description}
                        className="lp-type-opt lp-type-preset"
                        onClick={() => addPreset(p)}
                      >
                        <span className="lp-dot" style={{ background: p.color }} aria-hidden="true" />
                        <span className="lp-type-main">
                          <span className="lp-type-name">
                            {p.name} <span className="lp-badge">{p.icon}</span>
                          </span>
                          <span className="lp-type-desc">{p.description}</span>
                        </span>
                        {installed && (
                          <span className="lp-type-check" aria-label="Already added">
                            ✓
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>

              <form className="lp-type-custom" onSubmit={createCustom}>
                <div className="lp-type-section">Custom type…</div>
                <div className="lp-type-custom-row">
                  <input
                    className="lp-input"
                    data-testid="type-custom-name"
                    aria-label="New type name"
                    placeholder="Name, e.g. Spell"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                  />
                  <input
                    type="color"
                    className="lp-type-colour"
                    aria-label="New type colour"
                    data-testid="type-custom-colour"
                    value={customColour}
                    onChange={(e) => setCustomColour(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="lp-type-create"
                    data-testid="type-custom-create"
                    disabled={!customName.trim()}
                  >
                    Create
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function typeNameTaken(vault: Vault, name: string): boolean {
  const wanted = name.toLowerCase();
  return Object.values(vault.entityTypes).some((t) => t.name.toLowerCase() === wanted);
}
