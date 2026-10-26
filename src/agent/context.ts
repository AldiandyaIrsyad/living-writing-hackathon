// What the story agent is shown about a scene, and the two read-only tools it can use to look further.
// Everything is read as the story stood when the scene begins (the Resolver at the scene's own moment), so a flashback
// is checked against its own past and not against the latest state. Pure data in, text out.

import { findAuthorNotesOutsideCode, findEntity, findScene, parseLinks } from '../core/links';
import { momentConcrete, parseConcrete, type ParsedConcrete } from '../core/concrete';
import { buildGraph } from '../core/graph';
import { TYPE_PRESETS } from '../core/presets';
import { formatValue, Resolver } from '../core/resolve';
import type { Id, Vault } from '../core/types';
import { slugify } from '../core/types';

export const SYSTEM_PROMPT = `You are the continuity assistant inside a writing tool. The writer writes the story; you keep the story wiki true to it, so they never have to re-read earlier chapters. You never write or suggest prose or plot.

You are given the scene, the roster of known entities, and the wiki page, properties and current state of every entity linked in the scene, as they stood when the scene begins. Use the tools get_entity and search_wiki to look up anything else. Never guess about an entity you have not looked at.

Finish with ONE JSON object and nothing else:
{
  "newEntities": [{"name": "...", "type": "...", "aliases": []}],
  "pages": [{"entity": "...", "edits": [{"add": "lasting fact", "under": "Heading"}, {"replace": "exact line on the page", "with": "corrected line"}, {"remove": "exact line on the page"}], "certainty": "stated|implied|claimed", "message": "short reason"}],
  "properties": [{"entity": "...", "property": "status", "value": "dead"}],
  "states": [{"entity": "...", "state": "..."}],
  "contradictions": [{"entity": "...", "claim": "...", "sceneQuote": "...", "wikiQuote": "..."}],
  "timeSkip": "...",
  "concrete": "...",
  "timeLabel": "...",
  "title": "...",
  "unlinkedNames": [{"name": "...", "reason": "..."}]
}

Rules:
- newEntities: only for names listed under "Links with no page yet". A link can name any kind of thing (a person, a place, an object, a group, a creature, an idea): pick "type" from the listed entity types by what the scene says the thing is (an object is an Item, not a Person). Then describe it with "pages" edits like any other entity.
- pages keep each wiki page true and tidy. Pages hold LASTING facts: identity, appearance, history, relationships, abilities, lasting injuries, death. "add" a new fact as one short line. When the page has headings (## Appearance, ## History), or its type lists page sections (a new page starts with them), every "add" names the one it belongs to in "under". When the scene makes a line on the page untrue or out of date, "replace" that line (copy it exactly) or "remove" it; never add a second line that contradicts it. Never repeat what the page already says.
- certainty: "stated" = the narrator or a clear action establishes it. "implied" = clearly inferable. "claimed" = something a character says that may be a lie, rumour, belief, dream or hypothetical.
- properties: only properties the entity already has (listed under Properties), when the scene changes them for good (status alive -> dead, a new owner). A value naming another entity is written as [[Name]].
- states is a SHORT-LIVED snapshot for each character present: where they are, their condition and mood, who they are with, what they have just learned. One short sentence each, replacing the previous state. Hunger, mood and position belong here, never in pages. A character who dies in the scene gets the state "Dead" and how.
- contradictions: check each thing the scene says about an entity you were shown (looks, belongings, injuries and what they still allow, where they are) against its page, properties and state: someone who "walks with a cane" running unaided is a conflict. Report one only when the scene plainly conflicts with what you were shown. "sceneQuote" is copied verbatim from the scene and "wikiQuote" verbatim from what you were shown. A change the scene itself narrates (she loses the hand in this scene) is an update, not a contradiction. If the scene's time is unknown, report none. When in doubt, report nothing.
- timeSkip / concrete: only when the scene says how much time passed ("three days later") or a note or the scene gives a date outright.
- timeLabel: when the scene happens, as a date the timeline can order: "Late Autumn, 2026", "Early Winter, Year 3", "October 2026", "2026-10-25". Work it out from the scene, the writer's notes and the latest dated scene before it plus any time the scene says has passed (three weeks after late autumn is early winter). Never a time of day or an event ("morning", "the night of the fire"), and never a year nobody gave: when no year can be known, omit it.
- title: only when you are told the scene has no title; otherwise leave it out.
- unlinkedNames: named people, places or things in the scene that have no page and are not linked. Skip throwaway mentions.
- [Writer's note: ...] in the scene text is the writer's comment, left where it applies; it is not story text. Chapter notes are the same, for the whole chapter. When a note says something about the story ("this is not true", "she is lying", "this is a dream", "Tam is the courier from chapter 2"), it outranks the scene: follow it. A note about a passage ("this section is a dream") covers only that passage, the one it closes or opens; the rest of the scene still counts. Ignore notes about the writing itself (pacing, wording, "fix later"), and never record an idea a note only wonders about ("maybe Nora dies?") as a fact.
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

/** The scene as the agent reads it: author notes are the writer's margin and never reach the model as prose. */
export function sceneText(prose: string): string {
  let out = prose;
  for (const n of findAuthorNotesOutsideCode(prose).reverse()) out = out.slice(0, n.start) + out.slice(n.end);
  return out.trim();
}

/**
 * The scene for the model, with the writer's author notes (`%% this is not true %%`) marked as notes where they stand,
 * so a note about a passage ("this section is a dream") is read against that passage and never as story. An "agent:"
 * at the start, for a note meant only for it, is dropped.
 */
export function sceneWithNotes(prose: string): string {
  let out = prose;
  for (const n of findAuthorNotesOutsideCode(prose).reverse()) {
    const text = n.text.replace(/^agent\s*:\s*/i, '').trim();
    out = out.slice(0, n.start) + (text ? `[Writer's note: ${text}]` : '') + out.slice(n.end);
  }
  return out.trim();
}

/**
 * Link targets in the scene that name no entity and no other scene, once each, as the writer spelled them. A scene
 * never links itself, so [[the Hollow Cairn]] in the scene titled "The Hollow Cairn" names a place that needs a page.
 */
export function unresolvedLinks(vault: Vault, sceneId: Id): string[] {
  const seen = new Map<string, string>();
  for (const l of parseLinks(vault.scenes[sceneId].prose)) {
    if (l.embed) continue;
    const slug = slugify(l.target);
    if (slug && !seen.has(slug) && !findEntity(vault, l.target) && (findScene(vault, l.target)?.id ?? sceneId) === sceneId) seen.set(slug, l.target);
  }
  return [...seen.values()];
}

/**
 * The nearest scenes before and after this one in story time that carry a date the timeline can order ("Late Autumn,
 * 2026"). The agent dates a scene from the one before, and a date it proposes must fall between the two.
 */
export function datedNeighbours(vault: Vault, sceneId: Id): { before?: DatedScene; after?: DatedScene } {
  const graph = buildGraph(vault);
  const own = vault.scenes[sceneId].momentId;
  const at = graph.topoIndex(own);
  let before: (DatedScene & { i: number }) | undefined;
  let after: (DatedScene & { i: number }) | undefined;
  for (const s of Object.values(vault.scenes)) {
    if (s.momentId === own || s.someday) continue;
    const text = momentConcrete(vault.moments[s.momentId]);
    const parsed = text ? parseConcrete(text) : null;
    if (!parsed) continue;
    const i = graph.topoIndex(s.momentId);
    if (i < at && (!before || i > before.i)) before = { title: s.title, parsed, i };
    if (i > at && (!after || i < after.i)) after = { title: s.title, parsed, i };
  }
  return { before, after };
}
export interface DatedScene {
  title: string;
  parsed: ParsedConcrete;
}

/** What the agent does about a scene that still has no title of its own. */
export type SceneTitles = 'leave' | 'suggest' | 'set';

/** The titles a new scene gets before the writer names it: a scene with one of these has no title yet. */
const PLACEHOLDER_TITLES = new Set(['', 'untitled-scene', 'new-scene', 'opening-scene']);
export const isUntitled = (title: string): boolean => PLACEHOLDER_TITLES.has(slugify(title));

/** Gallery types the agent may file a new page under; one is installed the first time it is used. */
export const GALLERY_TYPES = TYPE_PRESETS.filter((p) => !['template', 'inbox', 'query'].includes(p.key));

const PAGE_LIMIT = 1800;

/** An entity as of the start of a scene: its name, page, properties and current state. */
export function describeEntity(vault: Vault, r: Resolver, entityId: Id, sceneId: Id): string {
  const e = vault.entities[entityId];
  const at = r.entityBefore(entityId, { sceneId });
  const type = vault.entityTypes[e.typeId]?.name ?? '';
  const props = Object.entries(at.props).filter(([k]) => k !== 'state').map(([k, p]) => `- ${k}: ${formatValue(p.value)}`);
  const state = (at.props.state && formatValue(at.props.state.value)) || '(none recorded)';
  const aliases = e.aliases.length ? ` (also: ${e.aliases.join(', ')})` : '';
  const page = at.note.length > PAGE_LIMIT ? `${at.note.slice(0, PAGE_LIMIT)}…` : at.note;
  return [`### ${at.name} [${type}]${aliases}`, `Current state: ${state}`, props.length ? `Properties:\n${props.join('\n')}` : '', `Page:\n${page.trim() || '(empty)'}`].filter(Boolean).join('\n');
}

/**
 * Entities the scene names without linking them: by name, alias, or a capitalised word of a longer name ("Edric" for
 * Edric Hale), as a whole word with its capitals (so the alias "Pike" is not the fish "pike"). The model is shown their
 * pages too, instead of having to look each one up, or missing what the scene says about them.
 */
export function namedEntities(vault: Vault, sceneId: Id): Id[] {
  const text = sceneText(vault.scenes[sceneId].prose);
  const out: Id[] = [];
  for (const e of Object.values(vault.entities)) {
    const parts = e.name.split(/\s+/).filter((w) => /^\p{Lu}/u.test(w) && !TITLES.has(w.toLowerCase()));
    const names = [e.name, ...e.aliases, ...(parts.length > 1 ? parts : [])].map((n) => n.trim()).filter((n) => n.length >= 3);
    if (names.some((n) => new RegExp(`(?<![\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(text))) out.push(e.id);
  }
  return out;
}

/** Words in a name that say what someone is, not who: "Captain" alone names no one. */
const TITLES = new Set(['the', 'captain', 'lord', 'lady', 'sir', 'dame', 'king', 'queen', 'prince', 'princess', 'old', 'young', 'saint', 'master', 'mistress', 'doctor', 'father', 'mother', 'brother', 'sister']);

/** The user message: the scene, who exists, and what the wiki says about everyone linked in it. */
export function buildContext(vault: Vault, sceneId: Id, opts: { linkNames?: boolean; sceneTitles?: SceneTitles } = {}): string {
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
  // A new page starts from its type's template, so the model needs the template's headings to file facts under them.
  const sections = (template?: string) => {
    const hs = [...(template ?? '').matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1].trim());
    return hs.length ? ` (page sections: ${hs.join(', ')})` : '';
  };
  const types = Object.values(vault.entityTypes).map((t) => `- ${t.name}${sections(t.template)}${t.description ? `: ${t.description}` : ''}`);
  const installed = new Set(Object.values(vault.entityTypes).map((t) => slugify(t.name)));
  const more = GALLERY_TYPES.filter((p) => !installed.has(slugify(p.name))).map((p) => `- ${p.name}${sections(p.template)}: ${p.description}`);
  const missing = unresolvedLinks(vault, sceneId);
  const named = namedEntities(vault, sceneId).filter((id) => !linked.has(id));
  const { before } = scene.someday ? {} : datedNeighbours(vault, sceneId);
  const chapter = scene.chapterId ? vault.chapters[scene.chapterId] : undefined;

  return [
    `Scene: ${scene.title || 'Untitled'}`,
    opts.sceneTitles && opts.sceneTitles !== 'leave' && isUntitled(scene.title)
      ? 'This scene has no title yet: give one in "title", two to six words naming what happens in it, in the scene’s language.'
      : '',
    `Time: ${time}`,
    before ? `Latest dated scene before this one: "${before.title}", ${before.parsed.raw}` : '',
    chapter?.note ? `Chapter notes from the writer (they hold for every scene in "${chapter.title}"):\n${chapter.note}` : '',
    `Entity types:\n${types.join('\n')}`,
    more.length ? `Types the writer has not used yet (pick one only when no type above fits):\n${more.join('\n')}` : '',
    `Roster:\n${roster.join('\n') || '(none yet)'}`,
    `Links with no page yet: ${missing.length ? missing.join(', ') : '(none)'}`,
    opts.linkNames
      ? 'The writer does not link names by hand: treat every named person, place, group or thing in the scene text that has no page and is worth one as if it were listed above. Name it as the scene writes it but without a title or honorific ("Orrin Pike" for "Captain Orrin Pike"), and give the other ways the scene calls it as aliases ("Captain Pike", "Orrin"). A name that is a page on the roster under another form ("Pike" for Orrin Pike) is that page, not a new one. Only proper names: not common nouns ("the mill", "the tavern"). Skip throwaway mentions.'
      : '',
    `Linked entities as they stand entering this scene:\n${[...linked].map((id) => describeEntity(vault, r, id, sceneId)).join('\n\n') || '(none)'}`,
    named.length ? `Named in the scene without a link, as they stand entering it:\n${named.map((id) => describeEntity(vault, r, id, sceneId)).join('\n\n')}` : '',
    `Scene text:\n"""\n${sceneWithNotes(scene.prose)}\n"""`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Runs one tool call from the model against the vault; the answer is plain text the model reads. */
export function runTool(vault: Vault, sceneId: Id, name: string, args: unknown): string {
  const input = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
  const r = new Resolver(vault);
  if (name === 'get_entity') {
    const asked = typeof input.name === 'string' ? input.name.trim() : '';
    const e = asked ? findEntity(vault, asked) : undefined;
    if (e) return describeEntity(vault, r, e.id, sceneId);
    // "Orin Pike" or "Pike" for the page "Captain Orrin Pike": pages that share a word of the name, so the model does
    // not go on guessing spellings.
    const words = new Set(slugify(asked).split('-').filter((w) => w.length >= 3));
    const near = Object.values(vault.entities).filter((x) => [x.name, ...x.aliases].some((n) => slugify(n).split('-').some((w) => words.has(w))));
    if (!near.length) return 'No entity with that name or alias.';
    return `No entity is called exactly that. Pages with a name in common:\n\n${near.slice(0, 3).map((x) => describeEntity(vault, r, x.id, sceneId)).join('\n\n')}`;
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
