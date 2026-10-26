// Curated entity-type presets for the Type gallery. Pure data and pure helpers: no React, no store.
// Presets are suggestions only. Installing one copies its name, colour, icon and suggested
// default properties into a normal entity type that the author can then edit freely.

import { emptyVault, newId, type EntityType, type Id, type Props, type Vault } from './types';

export type PresetCategory = 'People' | 'World' | 'Story';

export interface TypePreset {
  key: string;
  name: string;
  color: string;
  /** A short generic word, shown as the type's icon. */
  icon: string;
  description: string;
  /** Suggested (never required) default properties. */
  defaultProps: Props;
  /** Entities of this type are groups others can be affiliated with. */
  group?: boolean;
  /** Boilerplate note copied into each new entity of the type. */
  template?: string;
  parentLabel?: string;
  childrenLabel?: string;
  category: PresetCategory;
}

/** Gallery sections, in display order. */
export const PRESET_CATEGORIES: PresetCategory[] = ['People', 'World', 'Story'];

export const TYPE_PRESETS: TypePreset[] = [
  {
    key: 'person',
    name: 'Person',
    color: '#7c3aed',
    icon: 'user',
    description: 'People who act, speak and change in your story.',
    defaultProps: { status: 'alive' },
    template: '## Appearance\n\n## Personality\n\n## Background\n',
    parentLabel: 'Parents',
    childrenLabel: 'Children',
    category: 'People',
  },
  {
    key: 'organization',
    name: 'Organization',
    color: '#be185d',
    icon: 'flag',
    description: 'Groups with shared goals: houses, guilds, orders, crews.',
    defaultProps: {},
    group: true,
    template: '## Purpose\n\n## Structure\n\n## History\n',
    parentLabel: 'Part of',
    childrenLabel: 'Divisions',
    category: 'People',
  },
  {
    key: 'culture',
    name: 'Culture',
    color: '#0f766e',
    icon: 'users',
    description: 'Peoples and their customs, languages, beliefs and history.',
    defaultProps: {},
    category: 'People',
  },
  {
    key: 'place',
    name: 'Place',
    color: '#2563eb',
    icon: 'map',
    description: 'Cities, realms, buildings and landmarks where scenes happen.',
    defaultProps: { state: '' },
    template: '## Description\n\n## History\n',
    parentLabel: 'Located in',
    childrenLabel: 'Contains',
    category: 'World',
  },
  {
    key: 'item',
    name: 'Item',
    color: '#b45309',
    icon: 'box',
    description: 'Objects, artefacts and tools that matter to the plot.',
    defaultProps: { owner: '' },
    category: 'World',
  },
  {
    key: 'creature',
    name: 'Creature',
    color: '#4d7c0f',
    icon: 'paw',
    description: 'Animals, monsters, plants and other living things of your world.',
    defaultProps: { habitat: '', rarity: '' },
    template: '## Appearance\n\n## Habitat\n\n## Behaviour\n',
    parentLabel: 'Belongs to',
    childrenLabel: 'Includes',
    category: 'World',
  },
  {
    key: 'magic-system',
    name: 'Magic / System',
    color: '#0891b2',
    icon: 'spark',
    description: 'Rules of magic, technology or any system that constrains your world.',
    defaultProps: { rules: '' },
    category: 'World',
  },
  {
    key: 'lore',
    name: 'Lore',
    color: '#78716c',
    icon: 'scroll',
    description: 'Histories, legends, prophecies and background that readers may learn.',
    defaultProps: {},
    category: 'Story',
  },
  {
    key: 'event',
    name: 'Event',
    color: '#dc2626',
    icon: 'bolt',
    description: 'Wars, battles, festivals and other moments the story revolves around.',
    defaultProps: {},
    category: 'Story',
  },
  {
    key: 'concept',
    name: 'Concept',
    color: '#64748b',
    icon: 'bulb',
    description: 'Themes, ideas and motifs you want to track across the manuscript.',
    defaultProps: {},
    category: 'Story',
  },
  {
    key: 'template',
    name: 'Template',
    color: '#6b7280',
    icon: 'circle',
    description: 'Text to insert into scenes (a battle skeleton, a letter). Placeholders: {{title}}, {{story}}, {{chapter}}, {{cast}}, {{date}}.',
    defaultProps: {},
    category: 'Story',
  },
  {
    key: 'inbox',
    name: 'Inbox',
    color: '#6b7280',
    icon: 'circle',
    description: 'Where quick captures land (Ctrl+Shift+Space). Triage by editing the page.',
    defaultProps: {},
    category: 'Story',
  },
  {
    key: 'query',
    name: 'Query',
    color: '#0e7490',
    icon: 'circle',
    description: 'A saved smart list, such as "where type=Character status=alive at latest". Its page shows the matches at the playhead.',
    defaultProps: {},
    category: 'Story',
  },
];

function normaliseName(name: string): string {
  return name.trim().toLowerCase();
}

function findInstalled(vault: Vault, preset: TypePreset): EntityType | undefined {
  const wanted = normaliseName(preset.name);
  return Object.values(vault.entityTypes).find((t) => normaliseName(t.name) === wanted);
}

/** True when a type with the preset's name (case-insensitive) already exists in the vault. */
export function presetInstalled(vault: Vault, preset: TypePreset): boolean {
  return findInstalled(vault, preset) !== undefined;
}

/**
 * Adds the preset as a new entity type. Same shape as `addEntityType` in the store actions.
 * If a type with that name already exists, the vault is returned unchanged with its id.
 */
export function installPreset(vault: Vault, preset: TypePreset): { vault: Vault; id: Id } {
  const existing = findInstalled(vault, preset);
  if (existing) return { vault, id: existing.id };

  const t: EntityType = {
    id: newId('type'),
    name: preset.name,
    color: preset.color,
    icon: preset.icon,
    defaultProps: { ...preset.defaultProps },
  };
  // Only ever store the flag when it is true.
  if (preset.group) t.group = true;
  t.description = preset.description;
  if (preset.template !== undefined) t.template = preset.template;
  if (preset.parentLabel !== undefined) t.parentLabel = preset.parentLabel;
  if (preset.childrenLabel !== undefined) t.childrenLabel = preset.childrenLabel;
  return { vault: { ...vault, entityTypes: { ...vault.entityTypes, [t.id]: t } }, id: t.id };
}

/** The types a brand-new vault starts with; the rest of the gallery is one click away. */
export const STARTER_TYPES = ['person', 'place', 'creature', 'organization'];

/** An empty vault that already has the starter types. Used for a new project (the demo and imports bring their own). */
export function starterVault(): Vault {
  let vault: Vault = emptyVault();
  for (const key of STARTER_TYPES) {
    const preset = TYPE_PRESETS.find((p) => p.key === key);
    if (preset) vault = installPreset(vault, preset).vault;
  }
  return vault;
}
