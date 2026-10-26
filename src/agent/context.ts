// What the story agent is shown about a scene, and the two read-only tools it can use to look further.
// Everything is read as the story stood when the scene begins (the Resolver at the scene's own moment), so a flashback
// is checked against its own past and not against the latest state. Pure data in, text out.

import { findAuthorNotesOutsideCode, findEntity, findScene, parseLinks } from '../core/links';
import { formatValue, Resolver } from '../core/resolve';
import type { Id, Vault } from '../core/types';
import { slugify } from '../core/types';

export const SYSTEM_PROMPT = `You are the continuity assistant inside a writing tool. The writer submits one scene at a time. You keep their story wiki and character states current so they never have to re-read earlier chapters.

You are given the scene, the roster of known entities, and the wiki page plus current state of every entity linked in the scene, as they stood when the scene begins. Use the tools get_entity and search_wiki to look up anything else. Never guess about an entity you have not looked at.

Finish with ONE JSON object and nothing else:
{
  "newEntities": [{"name": "...", "type": "...", "page": ["lasting fact", "..."], "aliases": []}],
  "wiki": [{"entity": "...", "lines": ["lasting fact"], "certainty": "stated|implied|claimed", "message": "short reason"}],
  "states": [{"entity": "...", "state": "..."}],
  "contradictions": [{"entity": "...", "claim": "...", "sceneQuote": "...", "wikiQuote": "..."}],
  "timeSkip": "...",
  "concrete": "...",
  "unlinkedNames": [{"name": "...", "reason": "..."}]
}

Rules:
- newEntities: only for names listed under "Links with no page yet". "type" must be one of the listed entity types. "page" holds the lasting facts the scene establishes about it.
- wiki is for LASTING facts: identity, appearance, history, relationships, abilities, lasting injuries, death. Add only facts not already on the page, one short line each. Never rewrite the page. "stated" = the narrator or a clear action establishes it. "implied" = clearly inferable. "claimed" = something a character says that may be a lie, rumour, belief, dream or hypothetical.
- states is a SHORT-LIVED snapshot for each character present: where they are, their condition and mood, who they are with, what they have just learned. One short sentence each, replacing the previous state. Hunger, mood and position belong here, never in wiki.
- contradictions: only when the scene plainly conflicts with the page or state shown. "sceneQuote" is copied verbatim from the scene and "wikiQuote" verbatim from the page or state shown. A change the scene itself narrates (she loses the hand in this scene) is an update, not a contradiction. If the scene's time is unknown, report none. When in doubt, report nothing.
- timeSkip / concrete: only when the scene says how much time passed ("three days later") or gives a date. Otherwise omit.
- unlinkedNames: named people, places or things in the scene that have no page and are not linked. Skip throwaway mentions.
- Write in the language of the scene. Invent nothing. If the scene establishes nothing new, return empty arrays.`;

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_entity',
      description: 'Look up one entity by name or alias: its wiki page, properties and current state as of the start of this scene.',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_wiki',
      description: 'Find entities whose name, aliases or wiki page mention the text, as of the start of this scene.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  },
] as const;

/** The scene as the agent reads it: author notes are the writer's private margin and never reach the model. */
export function sceneText(prose: string): string {
  let out = prose;
  for (const n of findAuthorNotesOutsideCode(prose).reverse()) out = out.slice(0, n.start) + out.slice(n.end);
  return out.trim();
}

/** Link targets in the scene that name no entity and no scene, once each, as the writer spelled them. */
export function unresolvedLinks(vault: Vault, prose: string): string[] {
  const seen = new Map<string, string>();
  for (const l of parseLinks(prose)) {
    if (l.embed) continue;
    const slug = slugify(l.target);
    if (slug && !seen.has(slug) && !findEntity(vault, l.target) && !findScene(vault, l.target)) seen.set(slug, l.target);
  }
  return [...seen.values()];
}

const PAGE_LIMIT = 1800;

/** An entity as of the start of a scene: its name, page, properties and current state. */
export function describeEntity(vault: Vault, r: Resolver, entityId: Id, sceneId: Id): string {
  const e = vault.entities[entityId];
  const at = r.entityBefore(entityId, { sceneId });
  const type = vault.entityTypes[e.typeId]?.name ?? '';
  const props = Object.entries(at.props).filter(([k]) => k !== 'state').map(([k, p]) => `- ${k}: ${formatValue(p.value)}`);
  const state = at.props.state ? formatValue(at.props.state.value) : '(none recorded)';
  const aliases = e.aliases.length ? ` (also: ${e.aliases.join(', ')})` : '';
  const page = at.note.length > PAGE_LIMIT ? `${at.note.slice(0, PAGE_LIMIT)}…` : at.note;
  return [`### ${at.name} [${type}]${aliases}`, `Current state: ${state}`, props.length ? `Properties:\n${props.join('\n')}` : '', `Page:\n${page.trim() || '(empty)'}`].filter(Boolean).join('\n');
}

/** The user message: the scene, who exists, and what the wiki says about everyone linked in it. */
export function buildContext(vault: Vault, sceneId: Id): string {
  const scene = vault.scenes[sceneId];
  const r = new Resolver(vault);
  const moment = vault.moments[scene.momentId];
  const time = scene.someday ? 'unknown (the writer has not placed this scene on the timeline)' : [moment?.concrete ?? moment?.label, moment?.timeSkip].filter(Boolean).join(', ') || 'no date given';

  const linked = new Set<Id>();
  for (const l of parseLinks(scene.prose)) {
    const e = findEntity(vault, l.target);
    if (e) linked.add(e.id);
  }
  const roster = Object.values(vault.entities).map((e) => `- ${e.name} [${vault.entityTypes[e.typeId]?.name ?? ''}]${e.aliases.length ? ` also: ${e.aliases.join(', ')}` : ''}`);
  const types = Object.values(vault.entityTypes).map((t) => t.name);
  const missing = unresolvedLinks(vault, scene.prose);

  return [
    `Scene: ${scene.title || 'Untitled'}`,
    `Time: ${time}`,
    `Entity types: ${types.join(', ')}`,
    `Roster:\n${roster.join('\n') || '(none yet)'}`,
    `Links with no page yet: ${missing.length ? missing.join(', ') : '(none)'}`,
    `Linked entities as they stand entering this scene:\n${[...linked].map((id) => describeEntity(vault, r, id, sceneId)).join('\n\n') || '(none)'}`,
    `Scene text:\n"""\n${sceneText(scene.prose)}\n"""`,
  ].join('\n\n');
}

/** Runs one tool call from the model against the vault; the answer is plain text the model reads. */
export function runTool(vault: Vault, sceneId: Id, name: string, args: unknown): string {
  const input = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
  const r = new Resolver(vault);
  if (name === 'get_entity') {
    const e = typeof input.name === 'string' ? findEntity(vault, input.name) : undefined;
    return e ? describeEntity(vault, r, e.id, sceneId) : 'No entity with that name or alias.';
  }
  if (name === 'search_wiki') {
    const q = typeof input.query === 'string' ? input.query.trim().toLowerCase() : '';
    if (!q) return 'Give some text to search for.';
    const hits: string[] = [];
    for (const e of Object.values(vault.entities)) {
      const at = r.entityBefore(e.id, { sceneId });
      const haystack = [at.name, ...e.aliases, at.note].join('\n');
      const i = haystack.toLowerCase().indexOf(q);
      if (i < 0) continue;
      hits.push(`- ${at.name}: …${haystack.slice(Math.max(0, i - 80), i + q.length + 120).replace(/\s+/g, ' ')}…`);
      if (hits.length === 6) break;
    }
    return hits.join('\n') || 'Nothing in the wiki mentions that.';
  }
  return `Unknown tool ${name}.`;
}
