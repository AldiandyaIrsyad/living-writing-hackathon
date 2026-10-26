// Entity type manager: a gallery of suggested presets, create/rename/recolour and delete entity
// types, edit their default properties, mark group types, and jump to the entities that use them.

import { useMemo, useState, type FormEvent } from 'react';
import { findEntity } from '../../core/links';
import { PRESET_CATEGORIES, TYPE_PRESETS, installPreset, presetInstalled, type TypePreset } from '../../core/presets';
import type { Entity, EntityType, Id, Vault } from '../../core/types';
import { addEntity, addEntityType, deleteEntityType, sortedTypes, updateEntityType } from '../../store/actions';
import { update, useStore, useVault } from '../../store/store';
import { TYPE_ICON_NAMES, TypeIcon } from '../left/icons';
import { PropsEditor } from '../props';
import './views.css';

export function TypesView() {
  const vault = useVault();
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const types = sortedTypes(vault);
  const counts = useMemo(() => countByType(Object.values(vault.entities)), [vault.entities]);
  const selected = selectedId !== null ? vault.entityTypes[selectedId] : undefined;

  return (
    <div className="view view-narrow">
      <header className="view-header">
        <h1 className="view-title">Entity types</h1>
      </header>

      <TypeGallery onAdded={setSelectedId} />

      <section className="panel">
        <div className="panel-head">Types</div>
        <ul className="list type-list">
          {types.map((t) => {
            const count = counts.get(t.id) ?? 0;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  className={`list-item list-button${t.id === selectedId ? ' selected' : ''}`}
                  aria-pressed={t.id === selectedId}
                  onClick={() => setSelectedId(t.id)}
                >
                  <span className="dot" style={{ background: t.color }} />
                  <TypeIcon icon={t.icon} name={t.name} color={t.color} />
                  <span className="grow">{t.name}</span>
                  {count > 0 ? (
                    <span className="badge">{count}</span>
                  ) : (
                    <span className="badge type-unused" title="No entities use this type yet">
                      unused
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {types.length === 0 && <li className="muted small type-empty">No types yet.</li>}
        </ul>
      </section>

      <CreateTypeForm onCreated={setSelectedId} />

      {selected && <TypeEditor key={selected.id} typeId={selected.id} onDeleted={() => setSelectedId(null)} />}
    </div>
  );
}

function TypeGallery({ onAdded }: { onAdded: (id: Id) => void }) {
  const vault = useVault();

  const add = (preset: TypePreset) => {
    const store = useStore.getState();
    if (presetInstalled(store.vault, preset)) return;
    const result = installPreset(store.vault, preset);
    store.commit(result.vault);
    store.toast('info', `Added type “${preset.name}”`);
    onAdded(result.id);
  };

  return (
    <section className="panel type-gallery" aria-labelledby="type-gallery-title">
      <div className="panel-head" id="type-gallery-title">
        Type gallery
      </div>
      <div className="panel-body stack">
        <p className="muted small gallery-caption">
          Presets are starting points. Suggested fields are optional — fill in only what you use.
        </p>
        {PRESET_CATEGORIES.map((category) => (
          <div key={category} className="preset-group">
            <h3 className="section-title">{category}</h3>
            <ul className="preset-grid">
              {TYPE_PRESETS.filter((p) => p.category === category).map((preset) => {
                const installed = presetInstalled(vault, preset);
                const fields = Object.keys(preset.defaultProps);
                return (
                  <li key={preset.key} className="preset-card" data-testid="preset-card" data-preset={preset.key}>
                    <span className="preset-strip" style={{ background: preset.color }} aria-hidden="true" />
                    <div className="preset-meta">
                      <TypeIcon icon={preset.icon} name={preset.name} color={preset.color} />
                      {preset.group && <span className="badge">Group</span>}
                    </div>
                    <div className="preset-name">{preset.name}</div>
                    <p className="preset-desc">{preset.description}</p>
                    {fields.length > 0 && (
                      <div className="chip-row preset-fields" aria-label="Suggested fields">
                        {fields.map((f) => (
                          <span key={f} className="chip">
                            {f}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="preset-foot">
                      {installed ? (
                        <button type="button" className="btn btn-sm preset-added" data-testid="preset-add" disabled>
                          Added ✓
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          data-testid="preset-add"
                          onClick={() => add(preset)}
                        >
                          Add
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function CreateTypeForm({ onCreated }: { onCreated: (id: Id) => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#64748b');
  const [icon, setIcon] = useState('');
  const [description, setDescription] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const store = useStore.getState();
    if (typeNameTaken(store.vault, trimmed)) {
      store.toast('error', `A type named “${trimmed}” already exists`);
      return;
    }
    const created = addEntityType(store.vault, { name: trimmed, color, icon, ...(description.trim() ? { description: description.trim() } : {}) });
    store.commit(created.vault);
    onCreated(created.id);
    setName('');
    setIcon('');
    setDescription('');
  };

  return (
    <section className="panel create-type">
      <div className="panel-head">New type</div>
      <form className="panel-body row wrap" onSubmit={submit}>
        <input
          className="input grow"
          data-testid="new-type-name"
          aria-label="Type name"
          placeholder="Name, e.g. Spell"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="color"
          className="color-input"
          aria-label="Type colour"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <input
          className="input"
          style={{ flexBasis: '100%' }}
          data-testid="new-type-description"
          aria-label="Type description"
          placeholder="What is this type for? (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <IconPicker value={icon} name={name} color={color} onChange={setIcon} />
        <button type="submit" className="btn btn-primary" data-testid="create-type" disabled={!name.trim()}>
          Create type
        </button>
      </form>
    </section>
  );
}

function TypeEditor({ typeId, onDeleted }: { typeId: Id; onDeleted: () => void }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const type = vault.entityTypes[typeId];
  const entities = Object.values(vault.entities)
    .filter((e) => e.typeId === typeId)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!type) return null;

  const patch = (fields: Partial<Omit<EntityType, 'id'>>, coalesceKey?: string) =>
    update((v) => updateEntityType(v, typeId, fields), coalesceKey);

  const rename = (name: string) => {
    if (typeNameTaken(useStore.getState().vault, name, typeId)) {
      useStore.getState().toast('error', `A type named “${name}” already exists`);
      return;
    }
    patch({ name });
  };

  const setGroup = (on: boolean) => update((v) => withGroupFlag(v, typeId, on));

  const remove = () => {
    const store = useStore.getState();
    const next = deleteEntityType(store.vault, typeId);
    if (!next) {
      store.toast('error', `Type is still used by ${entities.length} entities`);
      return;
    }
    store.commit(next);
    onDeleted();
  };

  const createEntity = () => {
    const store = useStore.getState();
    const base = `New ${type.name}`;
    let name = base;
    let n = 1;
    while (findEntity(store.vault, name)) {
      n += 1;
      name = `${base} ${n}`;
    }
    const created = addEntity(store.vault, { name, typeId });
    store.commit(created.vault);
    store.navigate({ kind: 'entity', id: created.id });
  };

  return (
    <section className="panel type-editor">
      <div className="panel-head">
        <span className="grow">Edit type</span>
        <button type="button" className="btn btn-sm btn-danger" data-testid="type-delete" onClick={remove}>
          Delete type
        </button>
      </div>
      <div className="panel-body stack">
        <div className="row wrap">
          <div className="field grow">
            <span className="field-caption">Name</span>
            <InlineText className="input" label="Type name" value={type.name} onCommit={rename} />
          </div>
          <div className="field">
            <span className="field-caption">Colour</span>
            <input
              type="color"
              className="color-input"
              aria-label="Type colour"
              value={type.color}
              onChange={(e) => patch({ color: e.target.value }, `type-color:${typeId}`)}
            />
          </div>
        </div>

        <div className="field">
          <span className="field-caption">Icon</span>
          <IconPicker value={type.icon} name={type.name} color={type.color} onChange={(icon) => patch({ icon })} />
        </div>

        <div className="field">
          <span className="field-caption">Description</span>
          <InlineText
            className="input"
            label="Type description"
            value={type.description ?? ''}
            allowEmpty
            onCommit={(description) => patch({ description })}
          />
        </div>

        <div className="row wrap">
          <div className="field grow">
            <span className="field-caption">Parent relation is called</span>
            <InlineText className="input" label="Parent label" value={type.parentLabel ?? ''} allowEmpty onCommit={(parentLabel) => patch({ parentLabel })} />
          </div>
          <div className="field grow">
            <span className="field-caption">Children relation is called</span>
            <InlineText className="input" label="Children label" value={type.childrenLabel ?? ''} allowEmpty onCommit={(childrenLabel) => patch({ childrenLabel })} />
          </div>
        </div>
        <p className="muted small">For example a place is “Located in” and “Contains”. Empty means Parents and Children.</p>

        <label className="check-row">
          <input
            type="checkbox"
            data-testid="type-group-toggle"
            checked={type.group === true}
            onChange={(e) => setGroup(e.target.checked)}
          />
          <span>Group type (others can be affiliated with it)</span>
        </label>

        <div className="section-title">Boilerplate</div>
        <p className="muted small">
          What a new entity of this type starts with. Only a start: on the entity you can edit or delete any of it, and nothing here is required.
        </p>
        <InlineArea label="Boilerplate note" placeholder="## Appearance" value={type.template ?? ''} onCommit={(template) => patch({ template })} />

        <div className="section-title">Starting fields</div>
        <p className="muted small">Copied into every new entity of this type.</p>
        <PropsEditor
          props={type.defaultProps}
          onChange={(defaultProps) => patch({ defaultProps })}
          testId="type-default-props"
        />

        <div className="section-title">Entities ({entities.length})</div>
        {entities.length > 0 ? (
          <ul className="list type-entities">
            {entities.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className="list-item list-button"
                  onClick={() => navigate({ kind: 'entity', id: e.id })}
                >
                  {e.name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No entities of this type yet. It is unused, so you can delete it safely.</p>
        )}

        <div className="row wrap">
          <button type="button" className="btn btn-primary" onClick={createEntity}>
            New entity of this type
          </button>
        </div>
      </div>
    </section>
  );
}

/** Text input with a local draft. Commits on blur or Enter; empty or unchanged text is ignored. */
function InlineText({
  value,
  label,
  className,
  allowEmpty = false,
  onCommit,
}: {
  value: string;
  label: string;
  className: string;
  allowEmpty?: boolean;
  onCommit: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className={className}
      aria-label={label}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null) {
          const next = draft.trim();
          if ((next !== '' || allowEmpty) && next !== value) onCommit(next);
        }
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}

/** Sets or clears the group flag. Clearing removes the key, so `false` is never stored. */
function withGroupFlag(v: Vault, id: Id, on: boolean): Vault {
  const t = v.entityTypes[id];
  if (!t || on === (t.group === true)) return v;
  if (on) return updateEntityType(v, id, { group: true });
  const next: EntityType = { ...t };
  delete next.group;
  return { ...v, entityTypes: { ...v.entityTypes, [id]: next } };
}

function countByType(entities: Entity[]): Map<Id, number> {
  const counts = new Map<Id, number>();
  for (const e of entities) counts.set(e.typeId, (counts.get(e.typeId) ?? 0) + 1);
  return counts;
}

function typeNameTaken(vault: Vault, name: string, exceptId?: Id): boolean {
  const wanted = name.toLowerCase();
  return sortedTypes(vault).some((t) => t.id !== exceptId && t.name.toLowerCase() === wanted);
}

/** Choose a type's icon from the drawings we have; the first letter of its name stands in when none is chosen. */
function IconPicker({ value, name, color, onChange }: { value: string; name: string; color: string; onChange: (icon: string) => void }) {
  return (
    <div className="icon-picker" role="group" aria-label="Type icon">
      <button type="button" className="icon-choice" aria-pressed={value === ''} title="First letter of the name" data-testid="icon-choice" data-icon="" onClick={() => onChange('')}>
        <TypeIcon icon="" name={name || 'A'} color={color} />
      </button>
      {TYPE_ICON_NAMES.map((icon) => (
        <button key={icon} type="button" className="icon-choice" aria-pressed={value === icon} title={icon} data-testid="icon-choice" data-icon={icon} onClick={() => onChange(icon)}>
          <TypeIcon icon={icon} name={name} color={color} />
        </button>
      ))}
    </div>
  );
}

/** Multi-line text with a local draft. Commits on blur; unchanged text is ignored. */
function InlineArea({ value, label, placeholder, onCommit }: { value: string; label: string; placeholder?: string; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <textarea
      className="input type-template"
      aria-label={label}
      placeholder={placeholder}
      rows={5}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== value) onCommit(draft);
        setDraft(null);
      }}
    />
  );
}
