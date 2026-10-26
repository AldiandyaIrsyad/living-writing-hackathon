// The story agent's answer, read and turned into edits. This is where a model's output stops being trusted: every
// name is looked up, every quote is checked against the text it claims to come from, and anything that does not hold
// up is dropped rather than written. The result is one vault; the caller commits it as a single step.

import { findEntity } from '../core/links';
import { Resolver, valueEquals } from '../core/resolve';
import type { Id, PropValue, StateChange, Vault } from '../core/types';
import { slugify } from '../core/types';
import { addChange, addEntity, addEntityType, commitRevision, setMomentLabel, sortedTypes, updateChange } from '../store/actions';
import { sceneText, unresolvedLinks } from './context';
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
  unlinkedNames: { name: string; reason: string }[];
}

/** How the agent may write. */
export interface AgentOptions {
  /** The model that wrote it, recorded on every change it makes. */
  model: string;
  /** May the agent rewrite or remove lines the writer wrote? Off: those edits are only offered. Its own lines it may always rewrite. */
  allowOverwrite: boolean;
}

/** What a run did, for the panel. `created`, `pages`, `properties`, `states` and a set time label were written. */
export interface AgentReport {
  created: { id: Id; name: string; type: string }[];
  pages: { entity: string; edits: PageEdit[] }[];
  /** Edits to the writer's own lines, offered and not made (overwriting is off, or the writer revised the page here). */
  suggestions: { entityId: Id; entity: string; edit: PageEdit }[];
  properties: { entity: string; property: string; value: string }[];
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
  unlinkedNames: { name: string; reason: string }[];
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
    unlinkedNames: list(raw.unlinkedNames).map(rec).map((n) => ({ name: str(n.name), reason: str(n.reason) })).filter((n) => n.name),
  };
}

const appearsIn = (haystack: string, needle: string): boolean => squash(needle) !== '' && squash(haystack).includes(squash(needle));

const STATE_LIMIT = 240;

/** Each page revises the whole page, so an edit made after one scene is carried into every later version of the page. */
function carryForward(v: Vault, entityId: Id, fromChangeId: Id, edits: PageEdit[]): Vault {
  const history = new Resolver(v).pageHistory(entityId);
  const at = history.findIndex((h) => h.change?.id === fromChangeId);
  for (const later of history.slice(at + 1)) {
    if (later.change?.note === undefined) continue; // a rename only: it keeps the page before it
    const next = applyEdits(later.change.note, edits);
    // Whoever wrote the later version still did: the carried edit does not change that.
    if (next.applied.length) v = { ...v, changes: { ...v.changes, [later.change.id]: { ...later.change, note: next.note } } };
  }
  return v;
}

/** Takes back what the agent wrote for a scene, including the page edits it carried into later versions. */
function undoAgentChanges(vault: Vault, sceneId: Id): { vault: Vault; entityIds: Set<Id> } {
  let v = vault;
  const mine = Object.values(vault.changes).filter((c) => c.agent !== undefined && c.sceneId === sceneId);
  for (const c of mine) {
    if (c.op === 'revise' && c.note !== undefined) {
      const before = new Resolver(v).entityBefore(c.entityId, { sceneId }).note;
      v = carryForward(v, c.entityId, c.id, inverseEdits(before, c.note));
    }
  }
  if (!mine.length) return { vault, entityIds: new Set() };
  const changes = { ...v.changes };
  for (const c of mine) delete changes[c.id];
  return { vault: { ...v, changes }, entityIds: new Set(mine.map((c) => c.entityId)) };
}

/** Undoes the agent's output for one scene, and removes pages it created that nothing else has touched since. */
export function revertAgentOutput(vault: Vault, sceneId: Id): Vault {
  const undone = undoAgentChanges(vault, sceneId);
  const entities = { ...undone.vault.entities };
  const stillChanged = new Set(Object.values(undone.vault.changes).map((c) => c.entityId));
  for (const id of undone.entityIds) {
    const e = entities[id];
    const untouched = e && e.note.trim() === (undone.vault.entityTypes[e.typeId]?.template ?? '').trim();
    if (untouched && !stillChanged.has(id)) delete entities[id];
  }
  return { ...undone.vault, entities };
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
  const known = Object.values(vault.entityTypes).find((t) => slugify(t.name) === slugify(name)) ?? sortedTypes(vault)[0];
  if (known) return { vault, id: known.id };
  const r = addEntityType(vault, { name: 'Note' });
  return { vault: r.vault, id: r.id };
}

/** A property value as the model wrote it: "[[Name]]" is a link, anything else is text. */
function propValue(raw: string): PropValue {
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
  const report: AgentReport = { created: [], pages: [], suggestions: [], properties: [], states: [], claimed: [], skipped: [], contradictions: [], unlinkedNames: [...out.unlinkedNames] };
  let v = undoAgentChanges(vault, sceneId).vault;

  // 1. A [[link]] with no page is the writer asking for one. Only those become entities; other names are suggestions.
  const wanted = new Map(unresolvedLinks(v, scene.prose).map((t) => [slugify(t), t]));
  for (const n of out.newEntities) {
    if (findEntity(v, n.name)) continue;
    const target = wanted.get(slugify(n.name));
    if (!target) {
      report.unlinkedNames.push({ name: n.name, reason: 'Not linked in the scene, so no page was made.' });
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
    if (valueEquals(at.props[p.property]?.value, value)) continue;
    const writers = Object.values(v.changes).some((c: StateChange) => c.sceneId === sceneId && c.entityId === e.id && c.property === p.property);
    if (writers) {
      report.skipped.push(`You already set ${e.name}’s ${p.property} in this scene, so it was left alone.`);
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
      const shown = `${at.note}\n${Object.values(at.props).map((p) => String(p.value)).join('\n')}`;
      if (appearsIn(text, c.sceneQuote) && appearsIn(shown, c.wikiQuote)) report.contradictions.push(c);
    }
    const moment = v.moments[scene.momentId];
    if (out.timeSkip && out.timeSkip !== moment?.timeSkip) report.timeSkip = out.timeSkip;
    if (out.concrete && out.concrete !== moment?.concrete) report.concrete = out.concrete;
    // A label is display only, never used for ordering: the agent fills an empty one, and only suggests over the writer's.
    if (out.timeLabel && moment) {
      const shownLabel = moment.concrete ?? moment.label;
      if (!shownLabel) {
        v = setMomentLabel(v, moment.id, out.timeLabel);
        report.timeLabel = out.timeLabel;
        report.timeLabelSet = true;
      } else if (squash(shownLabel) !== squash(out.timeLabel)) report.timeLabel = out.timeLabel;
    }
  }

  return { vault: v, report };
}
