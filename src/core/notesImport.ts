// Importing a pile of Markdown notes (a folder, an Obsidian vault) as entities. Two steps so nothing is written before the
// writer has seen the report: `planNotesImport` reads the files and says what would happen, `applyNotesImport` does it.
// Pure: the files are passed in as text.

import { findEntity, findScene, formatLink, parseLinks, parseTags } from './links';
import { splitFrontmatter } from './markdown';
import { TYPE_PRESETS } from './presets';
import { newId, slugify, isLink, type Entity, type EntityType, type Id, type Props, type ScalarValue, type Vault } from './types';

export interface NoteFile {
  /** Path inside the imported folder, with "/" between parts: "Characters/Norman.md". */
  path: string;
  text: string;
}

export interface PlannedNote {
  path: string;
  name: string;
  /** The type's name, from the first-level folder; null for a note at the top. */
  folder: string | null;
  aliases: string[];
  props: Props;
  /** The note without frontmatter, with `[[Folder/Note]]` links shortened to `[[Note]]` and tags kept as #tags. */
  body: string;
  /** Targets of the links in the body. */
  links: string[];
  /** The id of the existing entity this note will update, when its name is taken. */
  updates: Id | null;
}

export interface Skipped {
  path: string;
  reason: string;
}

export interface ImportPlan {
  notes: PlannedNote[];
  skipped: Skipped[];
  /** Names of entity types that do not exist yet and would be created. */
  newTypes: string[];
  /** Link targets that match no note, entity or scene. */
  unresolved: string[];
  /** How many links in the notes lead somewhere. */
  resolvedLinks: number;
}

/** Folders that hold an app's own data, not notes. */
const IGNORED_FOLDERS = new Set(['.obsidian', '.git', '.trash', 'node_modules', '.living-writing-backup']);

const NOTE_TYPE = 'Note';

/** "Characters" → "Character", "Cities" → "City", "Classes" → "Class". Names that do not end in s are left alone. */
function singular(folder: string): string {
  const f = folder.trim();
  if (/ies$/i.test(f) && f.length > 3) return f.slice(0, -3) + 'y';
  if (/(ss|us)$/i.test(f)) return f;
  if (/(sse|xe|che|she|ze)s$/i.test(f)) return f.slice(0, -2);
  if (/s$/i.test(f) && f.length > 1) return f.slice(0, -1);
  return f;
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '');

function asScalar(v: unknown): ScalarValue | null {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v === null || v === undefined) return null;
  if (isLink(v)) return v;
  return JSON.stringify(v);
}

function toProps(data: Record<string, unknown>): { props: Props; aliases: string[]; tags: string[] } {
  const props: Props = {};
  let aliases: string[] = [];
  let tags: string[] = [];
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).map((x) => (typeof x === 'string' ? x : x == null ? '' : String(x))).map((s) => s.trim()).filter(Boolean);
  for (const [key, value] of Object.entries(data)) {
    const k = key.toLowerCase();
    if (k === 'aliases' || k === 'alias') aliases = aliases.concat(strings(value));
    else if (k === 'tags' || k === 'tag') tags = tags.concat(strings(value).flatMap((t) => t.split(/[\s,]+/)));
    else if (Array.isArray(value)) {
      const items = value.map(asScalar).filter((x): x is ScalarValue => x !== null);
      if (items.length > 0) props[key] = items;
    } else {
      const scalar = asScalar(value);
      if (scalar !== null && scalar !== '') props[key] = scalar;
    }
  }
  return { props, aliases, tags };
}

/** The last part of a link target: `Characters/Norman` → `Norman`. */
const leaf = (target: string) => target.slice(target.lastIndexOf('/') + 1).trim();

function shortenLinks(body: string): string {
  const links = parseLinks(body).filter((l) => l.target.includes('/'));
  let out = body;
  for (const l of links.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, l.start) + formatLink({ target: leaf(l.target), heading: l.heading, alias: l.alias, embed: l.embed, timeRaw: l.timeRaw }) + out.slice(l.end);
  }
  return out;
}

/** Reads the files and reports what importing them would do. Nothing is changed. */
export function planNotesImport(vault: Vault, files: readonly NoteFile[]): ImportPlan {
  const skipped: Skipped[] = [];
  const notes: PlannedNote[] = [];
  const seen = new Map<string, string>(); // slug of a name → the path that claimed it

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = file.path.split('/').filter(Boolean);
    if (parts.some((p, i) => i < parts.length - 1 && IGNORED_FOLDERS.has(p))) continue;
    if (!/\.md$/i.test(file.path)) {
      if (!parts.some((p) => p.startsWith('.'))) skipped.push({ path: file.path, reason: 'not a Markdown file' });
      continue;
    }
    const name = baseName(file.path).trim();
    if (slugify(name) === '') {
      skipped.push({ path: file.path, reason: 'the file name has no letters or digits to link by' });
      continue;
    }
    const claimed = seen.get(slugify(name));
    if (claimed !== undefined) {
      skipped.push({ path: file.path, reason: `same name as ${claimed} (names are compared without regard to case)` });
      continue;
    }
    seen.set(slugify(name), file.path);

    const text = file.text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const { data, body } = splitFrontmatter(text);
    const { props, aliases, tags } = toProps(data ?? {});
    let note = shortenLinks(body.replace(/^\n+/, ''));
    const have = new Set(parseTags(note));
    const extra = tags.map((t) => t.replace(/^#/, '')).filter((t) => t !== '' && !have.has(t.toLowerCase()));
    if (extra.length > 0) note = `${note.replace(/\s+$/, '')}${note.trim() === '' ? '' : '\n\n'}${extra.map((t) => `#${t}`).join(' ')}\n`;

    const existing = findEntity(vault, name);
    notes.push({
      path: file.path,
      name,
      folder: parts.length >= 2 ? parts[0] : null,
      aliases,
      props,
      body: note,
      links: parseLinks(note).map((l) => l.target),
      updates: existing ? existing.id : null,
    });
  }

  const known = new Set<string>();
  for (const n of notes) {
    known.add(slugify(n.name));
    for (const a of n.aliases) known.add(slugify(a));
  }
  const unresolved = new Set<string>();
  let resolved = 0;
  for (const n of notes) {
    for (const target of n.links) {
      if (known.has(slugify(target)) || findEntity(vault, target) || findScene(vault, target)) resolved++;
      else unresolved.add(target);
    }
  }

  const typeNames = new Set(Object.values(vault.entityTypes).map((t) => t.name.trim().toLowerCase()));
  const newTypes = new Set<string>();
  for (const n of notes) {
    const wanted = n.folder === null ? NOTE_TYPE : singular(n.folder);
    if (!typeNames.has(wanted.toLowerCase())) newTypes.add(wanted);
  }
  return { notes, skipped, newTypes: [...newTypes].sort(), unresolved: [...unresolved].sort((a, b) => a.localeCompare(b)), resolvedLinks: resolved };
}

export interface ApplyOptions {
  /** Add an empty page for every link that leads nowhere. */
  createStubs: boolean;
}

/**
 * Applies a plan. A note whose name is already an entity updates it (its page is replaced, aliases are added to, and
 * properties are set from the note); every other note becomes a new entity. Entity types that are missing are created,
 * from the preset of that name when there is one.
 */
export function applyNotesImport(vault: Vault, plan: ImportPlan, options: ApplyOptions): Vault {
  const entityTypes: Record<Id, EntityType> = { ...vault.entityTypes };
  const entities: Record<Id, Entity> = { ...vault.entities };

  const typeFor = (name: string): Id => {
    const have = Object.values(entityTypes).find((t) => t.name.trim().toLowerCase() === name.toLowerCase());
    if (have) return have.id;
    const preset = TYPE_PRESETS.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const t: EntityType = {
      id: newId('type'),
      name: preset?.name ?? name,
      color: preset?.color ?? '#6b7280',
      icon: preset?.icon ?? 'circle',
      defaultProps: { ...(preset?.defaultProps ?? {}) },
    };
    if (preset?.group) t.group = true;
    if (preset?.template !== undefined) t.template = preset.template;
    entityTypes[t.id] = t;
    return t.id;
  };

  for (const n of plan.notes) {
    const typeName = n.folder === null ? NOTE_TYPE : singular(n.folder);
    const existing = n.updates !== null ? entities[n.updates] : undefined;
    if (existing) {
      const aliases = [...existing.aliases];
      for (const a of n.aliases) if (!aliases.some((x) => slugify(x) === slugify(a))) aliases.push(a);
      entities[existing.id] = { ...existing, aliases, note: n.body, props: { ...existing.props, ...n.props } };
    } else {
      const e: Entity = { id: newId('ent'), typeId: typeFor(typeName), name: n.name, aliases: n.aliases, note: n.body, props: n.props };
      entities[e.id] = e;
    }
  }
  if (options.createStubs) {
    for (const target of plan.unresolved) {
      const e: Entity = { id: newId('ent'), typeId: typeFor(NOTE_TYPE), name: leaf(target), aliases: [], note: '', props: {} };
      if (slugify(e.name) !== '') entities[e.id] = e;
    }
  }
  return { ...vault, entityTypes, entities };
}
