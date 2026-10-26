import { describe, expect, it } from 'vitest';
import { addEntity } from '../store/actions';
import { PRESET_CATEGORIES, STARTER_TYPES, TYPE_PRESETS, installPreset, presetInstalled, starterVault, type TypePreset } from './presets';
import { emptyVault, type Vault } from './types';

function preset(key: string): TypePreset {
  const p = TYPE_PRESETS.find((x) => x.key === key);
  if (!p) throw new Error(`no preset ${key}`);
  return p;
}

describe('type presets', () => {
  it('have unique keys and unique names (case-insensitive)', () => {
    const keys = TYPE_PRESETS.map((p) => p.key);
    const names = TYPE_PRESETS.map((p) => p.name.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('use known categories, hex colours and one-sentence descriptions', () => {
    for (const p of TYPE_PRESETS) {
      expect(PRESET_CATEGORIES).toContain(p.category);
      expect(p.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.icon).toMatch(/^[a-z]+$/);
      expect(p.description.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('installPreset', () => {
  it('adds a type with the preset name, colour, icon and suggested props', () => {
    const before = emptyVault();
    const { vault, id } = installPreset(before, preset('place'));
    const t = vault.entityTypes[id];
    expect(t).toBeDefined();
    expect(t.name).toBe('Place');
    expect(t.color).toBe(preset('place').color);
    expect(t.icon).toBe(preset('place').icon);
    expect(t.defaultProps).toEqual({ state: '' });
    expect(Object.keys(vault.entityTypes)).toHaveLength(1);
  });

  it('does not mutate the input vault or share the defaultProps object', () => {
    const before = emptyVault();
    const { vault, id } = installPreset(before, preset('person'));
    expect(before.entityTypes).toEqual({});
    vault.entityTypes[id].defaultProps.status = 'dead';
    expect(preset('person').defaultProps).toEqual({ status: 'alive' });
  });

  it('stores the group flag only for group presets', () => {
    const faction = installPreset(emptyVault(), preset('organization'));
    expect(faction.vault.entityTypes[faction.id].group).toBe(true);

    const culture = installPreset(emptyVault(), preset('culture'));
    expect('group' in culture.vault.entityTypes[culture.id]).toBe(false);
  });

  it('is a no-op when the type is already installed, returning the existing id', () => {
    const first = installPreset(emptyVault(), preset('item'));
    const second = installPreset(first.vault, preset('item'));
    expect(second.id).toBe(first.id);
    expect(second.vault).toBe(first.vault);
    expect(Object.keys(second.vault.entityTypes)).toHaveLength(1);
  });
});

describe('presetInstalled', () => {
  it('is false in an empty vault', () => {
    expect(presetInstalled(emptyVault(), preset('lore'))).toBe(false);
  });

  it('matches an existing type by name, ignoring case and surrounding spaces', () => {
    const v: Vault = emptyVault();
    v.entityTypes.t1 = { id: 't1', name: '  pERSON ', color: '#000000', icon: 'user', defaultProps: {} };
    expect(presetInstalled(v, preset('person'))).toBe(true);
    expect(presetInstalled(v, preset('place'))).toBe(false);
  });

  it('becomes true after installing the preset', () => {
    const { vault } = installPreset(emptyVault(), preset('event'));
    expect(presetInstalled(vault, preset('event'))).toBe(true);
  });
});

describe('starterVault', () => {
  it('starts a new project with Person, Place, Creature and Organization, each with a description', () => {
    const types = Object.values(starterVault().entityTypes);
    expect(types.map((t) => t.name).sort()).toEqual(['Creature', 'Organization', 'Person', 'Place']);
    expect(types.every((t) => (t.description ?? '') !== '')).toBe(true);
    expect(STARTER_TYPES).toHaveLength(4);
  });
});

describe('type boilerplate', () => {
  it('starts a new entity with the boilerplate note and fields of its type, as plain editable data', () => {
    const base = installPreset(emptyVault(), preset('place'));
    const { vault, id } = addEntity(base.vault, { name: 'Ashford', typeId: base.id });
    expect(vault.entities[id].note).toBe('## Description\n\n## History\n');
    expect(vault.entities[id].props).toEqual({ state: '' });
    // An explicit note wins over the boilerplate.
    const written = addEntity(base.vault, { name: 'Oak', typeId: base.id, note: 'Just a tree.' });
    expect(written.vault.entities[written.id].note).toBe('Just a tree.');
  });
});
