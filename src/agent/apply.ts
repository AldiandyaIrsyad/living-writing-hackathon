// The story agent's answer, read and turned into edits. This is where a model's output stops being trusted: every
// name is looked up, every quote is checked against the text it claims to come from, and anything that does not hold
// up is dropped rather than written. The result is one vault; the caller commits it as a single step.

import { compareConcretes, momentConcrete, parseConcrete } from '../core/concrete';
import { findEntity, linkFirstMention, parseLinks, retargetLinks, unlinkFirst } from '../core/links';
import { installPreset } from '../core/presets';
import { Resolver, valueEquals } from '../core/resolve';
import type { Id, PropValue, StateChange, Vault } from '../core/types';
import { slugify } from '../core/types';
import { addChange, addEntity, addEntityType, commitRevision, setMomentLabel, sortedTypes, updateChange } from '../store/actions';
import { datedNeighbours, GALLERY_TYPES, isUntitled, laterPageLines, sceneText, unresolvedLinks, type SceneTitles } from './context';
import { agentLines, applyEdits, findLine, inverseEdits, isAgentLine, pageLines, squash, type PageEdit } from './page';

export type Certainty = 'stated' | 'implied' | 'claimed';

export interface Contradiction {
  entity: string;
  claim: string;
  sceneQuote: string;
  wikiQuote: string;
}

export interface AgentOutput {
  newEntities: { name: string; type: string; aliases: string[] }[];
  pages: { entity: string; edits: PageEdit[]; certainty: Certainty; message?: string }[];
  properties: { entity: string; property: string; value: string }[];
  states: { entity: string; state: string }[];
  contradictions: Contradiction[];
  timeSkip?: string;
  concrete?: string;
  timeLabel?: string;
  /** A title for a scene that has none yet (asked for only then). */
  title?: string;
  unlinkedNames: { name: string; reason: string }[];
}

/** How the agent may write. */
export interface AgentOptions {
  /** The model that wrote it, recorded on every change it makes. */
  model: string;
  /**
   * May the agent overwrite what the writer wrote: rewrite or remove their lines on a page, or change a property value
   * they set? Off: those changes are only offered. What the agent wrote itself it may always change.
   */
  allowOverwrite: boolean;
  /** Names the writer did not link get linked (their first mention in the scene) and a page, like a link would. */
  linkNames?: boolean;
  /** An untitled scene's title: written ("set"), or only offered (otherwise). */
  sceneTitles?: SceneTitles;
}

/** What a run did, for the panel. `created`, `pages`, `properties`, `states` and a set time label were written. */
export interface AgentReport {
  created: { id: Id; name: string; type: string }[];
  pages: { entity: string; edits: PageEdit[] }[];
  /** Edits to the writer's own lines, offered and not made (overwriting is off, or the writer revised the page here). */
  suggestions: { entityId: Id; entity: string; edit: PageEdit }[];
  properties: { entity: string; property: string; value: string }[];
  /** Property changes over a value the writer set, offered and not made (overwriting is off). */
  propertySuggestions: { entityId: Id; entity: string; property: string; value: string }[];
  states: { entity: string; state: string }[];
  /** Facts a character only claimed: offered to the writer, never written. */
  claimed: { entity: string; edits: PageEdit[] }[];
  /** Things the agent was told but left alone, in words. */
  skipped: string[];
  contradictions: Contradiction[];
  timeSkip?: string;
  concrete?: string;
  timeLabel?: string;
  /** The time label was written (the scene's moment had none); otherwise `timeLabel` is only a suggestion. */
  timeLabelSet?: boolean;
  /** A title for the untitled scene; `titleSet` when it was given, else it is only offered. */
  title?: string;
  titleSet?: boolean;
  unlinkedNames: { name: string; reason: string }[];
  /**
   * Links with no page whose name is a letter or two off a page that exists ([[Mria]], with Mira in the wiki): no page
   * was made. The writer fixes the link, or says it is someone new and gets the page the agent held back.
   */
  nearMisses?: { link: string; entityId: Id; name: string; type: string; aliases: string[]; edits: PageEdit[] }[];
  /** Pages an earlier read of this scene made for a link that is gone (a typo, retyped): removed, as nothing else used them. */
  removed?: string[];
  /** Links the agent put in the prose for names the writer had not linked ("Link and file them"), as written. */
  linked?: string[];
}

const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : typeof x === 'number' || typeof x === 'boolean' ? String(x) : '');
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const rec = (x: unknown): Record<string, unknown> => (typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {});
const strings = (x: unknown): string[] => list(x).map(str).filter(Boolean);

function readEdit(x: unknown): PageEdit | null {
  const e = rec(x);
  if (str(e.add)) return { kind: 'add', text: str(e.add), ...(str(e.under) ? { under: str(e.under) } : {}) };
  if (str(e.replace) && str(e.with)) return { kind: 'replace', old: str(e.replace), text: str(e.with) };
  if (str(e.remove)) return { kind: 'remove', old: str(e.remove) };
  return null;
}

/** Reads the model's reply. It arrives from the network, so anything missing or misshapen is dropped, not guessed. */
export function parseAgentOutput(reply: string): AgentOutput {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The model did not answer with JSON.');
  let raw: Record<string, unknown>;
  try {
    raw = rec(JSON.parse(reply.slice(start, end + 1)));
  } catch {
    throw new Error('The model’s JSON could not be read.');
  }
  const certainty = (x: unknown): Certainty => (x === 'implied' || x === 'claimed' ? x : 'stated');
  return {
    newEntities: list(raw.newEntities).map(rec).map((e) => ({ name: str(e.name), type: str(e.type), aliases: strings(e.aliases) })).filter((e) => e.name),
    pages: list(raw.pages)
      .map(rec)
      .map((p) => ({ entity: str(p.entity), edits: list(p.edits).map(readEdit).filter((e): e is PageEdit => e !== null), certainty: certainty(p.certainty), message: str(p.message) || undefined }))
      .filter((p) => p.entity && p.edits.length),
    properties: list(raw.properties).map(rec).map((p) => ({ entity: str(p.entity), property: str(p.property), value: str(p.value) })).filter((p) => p.entity && p.property && p.value),
    states: list(raw.states).map(rec).map((s) => ({ entity: str(s.entity), state: str(s.state) })).filter((s) => s.entity && s.state),
    contradictions: list(raw.contradictions).map(rec).map((c) => ({ entity: str(c.entity), claim: str(c.claim), sceneQuote: str(c.sceneQuote), wikiQuote: str(c.wikiQuote) })).filter((c) => c.entity && c.claim && c.sceneQuote && c.wikiQuote),
    timeSkip: str(raw.timeSkip) || undefined,
    concrete: str(raw.concrete) || undefined,
    timeLabel: str(raw.timeLabel) || undefined,
    title: str(raw.title) || undefined,
    unlinkedNames: list(raw.unlinkedNames).map(rec).map((n) => ({ name: str(n.name), reason: str(n.reason) })).filter((n) => n.name),
  };
}

const appearsIn = (haystack: string, needle: string): boolean => squash(needle) !== '' && squash(haystack).includes(squash(needle));

const STATE_LIMIT = 240;

/**
 * Each page revises the whole page, so an edit made after one scene is carried into every later version of the page.
 * With `direction` 'earlier' it goes into the versions before the scene instead, back to the base page ("from the
 * beginning"), which the writer asks for when the scene tells something that was true all along.
 */
function carry(v: Vault, entityId: Id, fromChangeId: Id, edits: PageEdit[], direction: 'later' | 'earlier'): Vault {
  const history = new Resolver(v).pageHistory(entityId);
  const at = history.findIndex((h) => h.change?.id === fromChangeId);
  for (const other of direction === 'later' ? history.slice(at + 1) : history.slice(0, at)) {
    if (other.change === null) {
      const next = applyEdits(other.note, edits);
      if (next.applied.length) v = { ...v, entities: { ...v.entities, [entityId]: { ...v.entities[entityId], note: next.note } } };
      continue;
    }
    if (other.change.note === undefined) continue; // a rename only: it keeps the page before it
    const next = applyEdits(other.change.note, edits);
    // Whoever wrote that version still did: the carried edit does not change that.
    if (next.applied.length) v = { ...v, changes: { ...v.changes, [other.change.id]: { ...other.change, note: next.note } } };
  }
  return v;
}

const carryForward = (v: Vault, entityId: Id, fromChangeId: Id, edits: PageEdit[]): Vault => carry(v, entityId, fromChangeId, edits, 'later');

/** The agent's revision of a page at a scene, if it made one. */
const revisionAt = (v: Vault, entityId: Id, sceneId: Id) => Object.values(v.changes).find((c) => c.op === 'revise' && c.entityId === entityId && c.sceneId === sceneId && c.note !== undefined);

/**
 * The versions before a scene that an edit made there would change, when the page has any earlier revision at all
 * (a page that starts at this scene has nothing before it to ask about).
 */
export function earlierVersionsLacking(vault: Vault, sceneId: Id, entityId: Id, edits: PageEdit[]): number {
  const here = revisionAt(vault, entityId, sceneId);
  if (!here) return 0;
  const history = new Resolver(vault).pageHistory(entityId);
  const before = history.slice(0, history.findIndex((h) => h.change?.id === here.id));
  if (!before.some((h) => h.change !== null)) return 0;
  return before.filter((h) => applyEdits(h.note, edits).applied.length > 0).length;
}

/** The edit that puts a page back as it was before the edit. */
const undoOf = (e: PageEdit): PageEdit => (e.kind === 'add' ? { kind: 'remove', old: e.text } : e.kind === 'remove' ? { kind: 'add', text: e.old } : { kind: 'replace', old: e.text, text: e.old });

/**
 * "Update from the beginning": the edits the scene made to a page go into every version before it too. The revision
 * remembers which ones did, so taking back the scene's output takes them out of the earlier versions again.
 */
export function updateFromBeginning(vault: Vault, sceneId: Id, entityId: Id, edits: PageEdit[]): Vault {
  const here = revisionAt(vault, entityId, sceneId);
  if (!here) return vault;
  const history = new Resolver(vault).pageHistory(entityId);
  const before = history.slice(0, history.findIndex((h) => h.change?.id === here.id));
  const changing = edits.filter((e) => before.some((h) => applyEdits(h.note, [e]).applied.length > 0));
  const v = carry(vault, entityId, here.id, changing, 'earlier');
  return { ...v, changes: { ...v.changes, [here.id]: { ...here, backfilled: [...(here.backfilled ?? []), ...changing] } } };
}

/** Takes back what the agent wrote for a scene, including the page edits it carried into later versions. */
function undoAgentChanges(vault: Vault, sceneId: Id): { vault: Vault; entityIds: Set<Id> } {
  let v = vault;
  const mine = Object.values(vault.changes).filter((c) => c.agent !== undefined && c.sceneId === sceneId);
  for (const c of mine) {
    if (c.op === 'revise' && c.note !== undefined) {
      const before = new Resolver(v).entityBefore(c.entityId, { sceneId }).note;
      v = carryForward(v, c.entityId, c.id, inverseEdits(before, c.note));
      if (c.backfilled?.length) v = carry(v, c.entityId, c.id, c.backfilled.map(undoOf), 'earlier');
    }
  }
  if (!mine.length) return { vault, entityIds: new Set() };
  const changes = { ...v.changes };
  for (const c of mine) delete changes[c.id];
  return { vault: { ...v, changes }, entityIds: new Set(mine.map((c) => c.entityId)) };
}

/** Of these pages, the ones nothing has written to: still their type's template, with no change left on them. */
function blankPages(v: Vault, ids: Iterable<Id>): Id[] {
  const changed = new Set(Object.values(v.changes).map((c) => c.entityId));
  return [...ids].filter((id) => {
    const e = v.entities[id];
    return e && !changed.has(id) && e.note.trim() === (v.entityTypes[e.typeId]?.template ?? '').trim();
  });
}

const without = (v: Vault, ids: Id[]): Vault => {
  if (!ids.length) return v;
  const entities = { ...v.entities };
  for (const id of ids) delete entities[id];
  return { ...v, entities };
};

/** Does any scene, page, revision or link-valued property still point at the entity? */
function linkedAnywhere(v: Vault, id: Id): boolean {
  const points = (text: string) => parseLinks(text).some((l) => findEntity(v, l.target)?.id === id);
  return (
    Object.values(v.scenes).some((s) => points(s.prose)) ||
    Object.values(v.entities).some((e) => points(e.note) || Object.values(e.props).some((p) => typeof p === 'object' && p !== null && 'target' in p && findEntity(v, p.target)?.id === id)) ||
    Object.values(v.changes).some((c) => (c.note !== undefined && points(c.note)) || (typeof c.value === 'object' && c.value !== null && 'target' in c.value && findEntity(v, c.value.target)?.id === id))
  );
}

/**
 * Undoes the agent's output for one scene: the links it added to the prose (`linked`, from its report) go back to
 * plain text, and pages it created that nothing else has touched since are removed.
 */
export function revertAgentOutput(vault: Vault, sceneId: Id, linked: string[] = []): Vault {
  const scene = vault.scenes[sceneId];
  const prose = linked.reduce(unlinkFirst, scene.prose);
  const unlinked = prose === scene.prose ? vault : { ...vault, scenes: { ...vault.scenes, [sceneId]: { ...scene, prose } } };
  const undone = undoAgentChanges(unlinked, sceneId);
  // A page made for a name the agent linked has no change on it when the read wrote nothing about it.
  const made = new Set([...undone.entityIds, ...linked.map((l) => findEntity(unlinked, parseLinks(l)[0]?.target ?? '')?.id).filter((id): id is Id => !!id)]);
  return without(undone.vault, blankPages(undone.vault, made));
}

type NearMiss = NonNullable<AgentReport['nearMisses']>[number];

/** "Fix the link": the misspelt links in the scene now point at the page that was meant. */
export function fixNearMiss(vault: Vault, sceneId: Id, miss: NearMiss): Vault {
  const scene = vault.scenes[sceneId];
  const name = vault.entities[miss.entityId]?.name ?? miss.name;
  return { ...vault, scenes: { ...vault.scenes, [sceneId]: { ...scene, prose: retargetLinks(scene.prose, miss.link, name) } } };
}

/** "It's someone new": the page the agent held back, made now, with what it would have written (as the writer's). */
export function createHeldPage(vault: Vault, sceneId: Id, miss: NearMiss): Vault {
  const type = typeFor(vault, miss.type);
  const added = addEntity(type.vault, { name: miss.link, typeId: type.id });
  const aliases = miss.aliases.filter((a) => !findEntity(added.vault, a));
  const v = { ...added.vault, entities: { ...added.vault.entities, [added.id]: { ...added.vault.entities[added.id], aliases } } };
  return miss.edits.length ? editPage(v, sceneId, added.id, miss.edits, 'writer', 'Accepted from the story agent').vault : v;
}

/** Edit distance between two slugs, for spotting a misspelt link; two swapped letters ("Mria") count as one edit. */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** The existing page a link probably meant: one letter off for short names, two for longer ones. */
function nearMiss(v: Vault, target: string): { id: Id; name: string } | undefined {
  const t = slugify(target);
  if (t.length < 3) return undefined;
  const allowed = t.length <= 5 ? 1 : 2;
  for (const e of Object.values(v.entities)) {
    if ([e.name, ...e.aliases].some((n) => distance(t, slugify(n)) <= allowed)) return { id: e.id, name: e.name };
  }
  return undefined;
}

/**
 * Edits one entity's page as it stands just after a scene, and carries the edits into the page's later versions.
 * `by` is the agent (its lines it may always rewrite; the writer's only with `allowOverwrite`, else those edits come
 * back as `blocked`) or the writer accepting a suggestion (anything goes, and the change is theirs).
 */
export function editPage(
  vault: Vault,
  sceneId: Id,
  entityId: Id,
  edits: PageEdit[],
  by: AgentOptions | 'writer',
  message: string,
): { vault: Vault; applied: PageEdit[]; blocked: PageEdit[] } {
  const r = new Resolver(vault);
  const here = Object.values(vault.changes).find((c) => c.op === 'revise' && c.entityId === entityId && c.sceneId === sceneId);
  // A revision the writer made after this scene is theirs: the agent only offers changes to it.
  if (by !== 'writer' && here && here.agent === undefined) return { vault, applied: [], blocked: edits };

  const before = r.entityBefore(entityId, { sceneId });
  const current = r.entityAt(entityId, r.atScene(sceneId, true));
  const lines = pageLines(current.note);
  const owned = by === 'writer' ? null : agentLines(r, entityId, current.revision);
  const allowed: PageEdit[] = [];
  const blocked: PageEdit[] = [];
  for (const e of edits) {
    const target = e.kind === 'add' ? -1 : findLine(lines, e.old);
    const writers = target >= 0 && owned !== null && !isAgentLine(owned, lines[target]);
    if (writers && by !== 'writer' && !by.allowOverwrite) blocked.push(e);
    else allowed.push(e);
  }
  const next = applyEdits(current.note, allowed);
  if (!next.applied.length) return { vault, applied: [], blocked };

  const committed = commitRevision(vault, { entityId, anchor: { sceneId }, note: next.note, message, before: { note: before.note, name: before.name } });
  if (!committed.id) return { vault: committed.vault, applied: next.applied, blocked };
  let v = committed.vault;
  const change = v.changes[committed.id];
  if (by !== 'writer' && change.agent === undefined) v = updateChange(v, change.id, { agent: by.model });
  return { vault: carryForward(v, entityId, change.id, next.applied), applied: next.applied, blocked };
}

function typeFor(vault: Vault, name: string): { vault: Vault; id: Id } {
  const exact = Object.values(vault.entityTypes).find((t) => slugify(t.name) === slugify(name));
  if (exact) return { vault, id: exact.id };
  const preset = GALLERY_TYPES.find((p) => slugify(p.name) === slugify(name));
  if (preset) return installPreset(vault, preset);
  const known = sortedTypes(vault)[0];
  if (known) return { vault, id: known.id };
  const r = addEntityType(vault, { name: 'Note' });
  return { vault: r.vault, id: r.id };
}

/** A property value as the model wrote it: "[[Name]]" is a link, anything else is text. */
export function propValue(raw: string): PropValue {
  const link = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(raw);
  return link ? { kind: 'link', target: link[1].trim() } : raw;
}

/**
 * Applies the agent's answer for one scene. Page edits are made as a revision anchored at the scene and carried into
 * later versions; properties and the short-lived `state` are set at the scene. Running the same scene again first
 * takes back the agent's earlier output for it, everywhere it reached.
 */
export function applyAgentOutput(vault: Vault, sceneId: Id, out: AgentOutput, opts: AgentOptions): { vault: Vault; report: AgentReport } {
  const scene = vault.scenes[sceneId];
  const report: AgentReport = { created: [], pages: [], suggestions: [], properties: [], propertySuggestions: [], states: [], claimed: [], skipped: [], contradictions: [], unlinkedNames: [...out.unlinkedNames] };
  const undone = undoAgentChanges(vault, sceneId);
  // A page the last read made for a link the writer has since retyped ([[Nora]] → [[Norah]]) goes, once nothing uses it.
  const stray = blankPages(undone.vault, undone.entityIds).filter((id) => !linkedAnywhere(undone.vault, id));
  if (stray.length) report.removed = stray.map((id) => undone.vault.entities[id].name);
  let v = without(undone.vault, stray);

  // 1. A [[link]] with no page is the writer asking for one. Only those become entities; other names are suggestions.
  // A link a letter or two off an existing page is more likely a typo than a new character: it is asked about instead.
  const wanted = new Map(unresolvedLinks(v, sceneId).map((t) => [slugify(t), t]));
  const held = new Set<string>();
  for (const n of out.newEntities) {
    if (findEntity(v, n.name)) continue;
    let target = wanted.get(slugify(n.name));
    // A name the writer did not link is linked for them where it is first mentioned, if they asked for that, unless it
    // looks like a misspelling of a page that exists.
    // A name only a note gives ("Wren is really Corwen") is linked where the scene uses one of its aliases: [[Corwen|Wren]].
    const prose = v.scenes[sceneId].prose;
    const linked =
      !target && opts.linkNames && !nearMiss(v, n.name)
        ? [n.name, ...n.aliases].reduce<string | null>((done, name) => done ?? linkFirstMention(prose, name, n.name), null)
        : null;
    if (linked) {
      v = { ...v, scenes: { ...v.scenes, [sceneId]: { ...v.scenes[sceneId], prose: linked } } };
      (report.linked ??= []).push(parseLinks(linked).find((l) => !parseLinks(prose).some((p) => p.raw === l.raw))!.raw);
      target = unresolvedLinks(v, sceneId).find((t) => slugify(t) === slugify(n.name));
    }
    if (!target) {
      report.unlinkedNames.push({ name: n.name, reason: 'Not linked in the scene, so no page was made.' });
      continue;
    }
    const near = nearMiss(v, target);
    if (near) {
      const edits = out.pages.filter((p) => p.certainty !== 'claimed' && slugify(p.entity) === slugify(n.name)).flatMap((p) => p.edits);
      (report.nearMisses ??= []).push({ link: target, entityId: near.id, name: near.name, type: n.type, aliases: n.aliases, edits });
      held.add(slugify(n.name));
      continue;
    }
    const type = typeFor(v, n.type);
    const added = addEntity(type.vault, { name: target, typeId: type.id });
    const aliases = n.aliases.filter((a) => !findEntity(added.vault, a));
    v = aliases.length ? { ...added.vault, entities: { ...added.vault.entities, [added.id]: { ...added.vault.entities[added.id], aliases } } } : added.vault;
    report.created.push({ id: added.id, name: target, type: added.vault.entityTypes[type.id].name });
    wanted.delete(slugify(n.name));
  }

  // 2. Page edits, one revision per entity. Claims are only reported.
  const byEntity = new Map<Id, { edits: PageEdit[]; message?: string }>();
  for (const p of out.pages) {
    const e = findEntity(v, p.entity);
    if (!e && held.has(slugify(p.entity))) continue;
    if (!e) report.skipped.push(`No page called “${p.entity}”, so its edits were not made.`);
    else if (p.certainty === 'claimed') report.claimed.push({ entity: e.name, edits: p.edits });
    else {
      const have = byEntity.get(e.id) ?? { edits: [] };
      byEntity.set(e.id, { edits: [...have.edits, ...p.edits], message: p.message ?? have.message });
    }
  }
  for (const [id, { edits, message }] of byEntity) {
    const name = v.entities[id].name;
    const done = editPage(v, sceneId, id, edits, opts, message ?? `From “${scene.title || 'a scene'}”`);
    v = done.vault;
    if (done.applied.length) report.pages.push({ entity: name, edits: done.applied });
    for (const edit of done.blocked) report.suggestions.push({ entityId: id, entity: name, edit });
  }

  // 3. Lasting properties (status, owner…) the entity already has. The agent does not invent new ones.
  const r = new Resolver(v);
  for (const p of out.properties) {
    const e = findEntity(v, p.entity);
    if (!e) continue;
    const at = r.entityBefore(e.id, { sceneId });
    const known = p.property in at.props || p.property in (v.entityTypes[e.typeId]?.defaultProps ?? {});
    if (!known || p.property === 'state') continue;
    const value = propValue(p.value);
    const current = at.props[p.property];
    if (valueEquals(current?.value, value)) continue;
    const setHere = Object.values(v.changes).some((c: StateChange) => c.sceneId === sceneId && c.entityId === e.id && c.property === p.property);
    if (setHere) {
      report.skipped.push(`You already set ${e.name}’s ${p.property} in this scene, so it was left alone.`);
      continue;
    }
    // The writer's value: from a commit of theirs, or a starting value they chose (not one the type's template filled in).
    const writers = current && (current.changeId ? v.changes[current.changeId]?.agent === undefined : !valueEquals(current.value, v.entityTypes[e.typeId]?.defaultProps[p.property]));
    if (writers && !opts.allowOverwrite) {
      report.propertySuggestions.push({ entityId: e.id, entity: e.name, property: p.property, value: p.value });
      continue;
    }
    v = addChange(v, { sceneId, entityId: e.id, op: 'set', property: p.property, value, agent: opts.model }).vault;
    report.properties.push({ entity: e.name, property: p.property, value: p.value });
  }

  // 4. The short-lived state replaces the last one; it is only written when it says something new.
  for (const s of out.states) {
    const e = findEntity(v, s.entity);
    if (!e) continue;
    const state = s.state.slice(0, STATE_LIMIT);
    if (r.entityBefore(e.id, { sceneId }).props.state?.value === state) continue;
    v = addChange(v, { sceneId, entityId: e.id, op: 'set', property: 'state', value: state, agent: opts.model }).vault;
    report.states.push({ entity: e.name, state });
  }

  // 5. A contradiction is only shown with evidence: the scene quote must be in the scene, the wiki quote in what the
  // agent was shown. A scene the writer has not placed in time has no "before" to contradict, and no time to label.
  if (!scene.someday) {
    const text = sceneText(scene.prose);
    for (const c of out.contradictions) {
      const e = findEntity(vault, c.entity);
      if (!e) continue;
      const at = r.entityBefore(e.id, { sceneId });
      const shown = `${at.note}\n${Object.values(at.props).map((p) => String(p.value)).join('\n')}\n${laterPageLines(r, e.id, sceneId).map((l) => l.line).join('\n')}`;
      if (appearsIn(text, c.sceneQuote) && appearsIn(shown, c.wikiQuote)) report.contradictions.push(c);
    }
    const moment = v.moments[scene.momentId];
    if (out.timeSkip && out.timeSkip !== moment?.timeSkip) report.timeSkip = out.timeSkip;
    // A date that only repeats the scene's time label adds nothing ("Late autumn, 2026" twice; "3 March 2026" beside
    // "2026-03-03").
    const label = (moment && momentConcrete(moment)) || out.timeLabel || '';
    // A date is one the timeline can order: "3 weeks" is a time skip, not a date.
    const date = out.concrete ? parseConcrete(out.concrete) : null;
    const labelDate = parseConcrete(label);
    const repeats = squash(out.concrete ?? '') === squash(label) || (!!date && !!labelDate && date.precision === labelDate.precision && compareConcretes(date, labelDate) === 0);
    if (out.concrete && date && out.concrete !== moment?.concrete && !repeats) report.concrete = out.concrete;
    // A time label is a date the timeline orders by ("Late Autumn, 2026"); "morning" orders nothing and is dropped. The
    // agent fills an empty one only where it fits between the dated scenes around it, else it only suggests, as it
    // does over the writer's.
    const parsed = out.timeLabel ? parseConcrete(out.timeLabel) : null;
    if (out.timeLabel && parsed && moment) {
      const shownLabel = momentConcrete(moment);
      const { before, after } = datedNeighbours(v, sceneId);
      const fits = (!before || compareConcretes(before.parsed, parsed) <= 0) && (!after || compareConcretes(parsed, after.parsed) <= 0);
      if (!shownLabel && fits) {
        v = setMomentLabel(v, moment.id, out.timeLabel);
        report.timeLabel = out.timeLabel;
        report.timeLabelSet = true;
      } else if (!shownLabel || squash(shownLabel) !== squash(out.timeLabel)) report.timeLabel = out.timeLabel;
    }
  }

  // 6. A title, only for a scene the writer has not named, and only with their leave; never over a title they gave.
  const title = out.title?.replace(/^["“”']+|["“”'.]+$/g, '').trim().slice(0, 80);
  if (title && opts.sceneTitles && opts.sceneTitles !== 'leave' && isUntitled(v.scenes[sceneId].title)) {
    report.title = title;
    if (opts.sceneTitles === 'set') {
      v = { ...v, scenes: { ...v.scenes, [sceneId]: { ...v.scenes[sceneId], title } } };
      report.titleSet = true;
    }
  }

  return { vault: v, report };
}
