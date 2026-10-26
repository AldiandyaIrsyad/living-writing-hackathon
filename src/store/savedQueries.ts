// Smart lists: a state query (core/stateQuery.ts) saved under a name as a page of the built-in "Query" type, so it syncs,
// exports, renames and searches like any other page. The page's first line that starts with "where" is the query; the
// rest of the page is the writer's own notes.

import { installPreset, TYPE_PRESETS } from '../core/presets';
import { newId, type Entity, type Id, type Vault } from '../core/types';

const preset = () => TYPE_PRESETS.find((p) => p.key === 'query')!;

const WHERE = /^\s*where\b\s*(.*)$/i;

/** The query text a page holds (what follows "where"), or null when it has none. */
export function queryTextOf(note: string): string | null {
  for (const line of note.split(/\r?\n/)) {
    const m = WHERE.exec(line);
    if (m) return m[1].trim();
  }
  return null;
}

/** True for a page of the Query type. */
export function isQueryPage(vault: Vault, entityId: Id): boolean {
  const e = vault.entities[entityId];
  return e !== undefined && vault.entityTypes[e.typeId]?.name.trim().toLowerCase() === preset().name.toLowerCase();
}

/** The writer's saved queries, by name. */
export function savedQueries(vault: Vault): Entity[] {
  return Object.values(vault.entities)
    .filter((e) => isQueryPage(vault, e.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Saves `queryText` (without the word "where") as a smart list; a taken name gets a number. */
export function saveQuery(vault: Vault, name: string, queryText: string): { vault: Vault; id: Id } {
  const installed = installPreset(vault, preset());
  const taken = new Set(savedQueries(installed.vault).map((e) => e.name.toLowerCase()));
  const base = name.trim() || 'Smart list';
  let unique = base;
  for (let n = 2; taken.has(unique.toLowerCase()); n++) unique = `${base} ${n}`;
  const e: Entity = { id: newId('ent'), typeId: installed.id, name: unique, aliases: [], note: `where ${queryText.trim()}\n`, props: {} };
  return { vault: { ...installed.vault, entities: { ...installed.vault.entities, [e.id]: e } }, id: e.id };
}
