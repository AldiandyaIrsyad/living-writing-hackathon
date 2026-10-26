// Scene templates: reusable text kept as entities of the "Template" type, so they sync, export and rename like any other
// page. Inserting one expands a few placeholders from the scene it goes into.

import { formatLink } from '../core/links';
import { installPreset, TYPE_PRESETS } from '../core/presets';
import { newId, type Entity, type Id, type Vault } from '../core/types';
import { sceneCast } from './cast';
import { dayKey } from './stats';

export const PLACEHOLDERS = ['title', 'story', 'chapter', 'cast', 'date'] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

const isPlaceholder = (s: string): s is Placeholder => (PLACEHOLDERS as readonly string[]).includes(s);

/**
 * Fills `{{title}}`, `{{story}}`, `{{chapter}}`, `{{cast}}` and `{{date}}` (spaces inside the braces and any case are
 * fine). A placeholder with no value becomes empty. Braces that are not one of those names stay as typed, so does
 * everything in a value (it is never expanded again), and a backslash in front, `\{{title}}`, keeps one literally.
 */
export function expandTemplate(text: string, values: Partial<Record<Placeholder, string>>): string {
  return text.replace(/(\\?)\{\{\s*([A-Za-z]+)\s*\}\}/g, (all, escape: string, name: string) => {
    const key = name.toLowerCase();
    if (!isPlaceholder(key)) return all;
    if (escape) return all.slice(1);
    return values[key] ?? '';
  });
}

/** What each placeholder stands for in one scene. `{{cast}}` is a list of links to everyone in the scene's cast. */
export function templateValues(vault: Vault, sceneId: Id, now: Date): Partial<Record<Placeholder, string>> {
  const scene = vault.scenes[sceneId];
  if (!scene) return { date: dayKey(now) };
  return {
    title: scene.title,
    story: vault.stories[scene.storyId]?.name ?? '',
    chapter: scene.chapterId === null ? '' : (vault.chapters[scene.chapterId]?.title ?? ''),
    cast: sceneCast(vault, scene)
      .map((m) => formatLink({ target: vault.entities[m.entityId].name }))
      .join(', '),
    date: dayKey(now),
  };
}

const presetOf = () => TYPE_PRESETS.find((p) => p.key === 'template')!;

/** The writer's templates, by name. */
export function templatesOf(vault: Vault): Entity[] {
  const wanted = presetOf().name.toLowerCase();
  const typeIds = new Set(Object.values(vault.entityTypes).filter((t) => t.name.trim().toLowerCase() === wanted).map((t) => t.id));
  return Object.values(vault.entities)
    .filter((e) => typeIds.has(e.typeId))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Keeps a scene's text as a template named `name` (the Template type is added on first use). A taken name gets a number. */
export function saveAsTemplate(vault: Vault, name: string, body: string): { vault: Vault; id: Id } {
  const installed = installPreset(vault, presetOf());
  const taken = new Set(templatesOf(installed.vault).map((e) => e.name.toLowerCase()));
  let unique = name.trim() || 'Template';
  for (let n = 2; taken.has(unique.toLowerCase()); n++) unique = `${name.trim() || 'Template'} ${n}`;
  const e: Entity = { id: newId('ent'), typeId: installed.id, name: unique, aliases: [], note: body, props: {} };
  return { vault: { ...installed.vault, entities: { ...installed.vault.entities, [e.id]: e } }, id: e.id };
}
