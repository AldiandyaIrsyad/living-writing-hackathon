// The story agent's answer, read and turned into edits. This is where a model's output stops being trusted: every
// name is looked up, every quote is checked against the text it claims to come from, and anything that does not hold
// up is dropped rather than written. The result is one vault; the caller commits it as a single step.

import { findEntity } from '../core/links';
import { Resolver } from '../core/resolve';
import type { Id, Vault } from '../core/types';
import { slugify } from '../core/types';
import { addChange, addEntity, addEntityType, commitRevision, sortedTypes } from '../store/actions';
import { sceneText, unresolvedLinks } from './context';

export type Certainty = 'stated' | 'implied' | 'claimed';

export interface Contradiction {
  entity: string;
  claim: string;
  sceneQuote: string;
  wikiQuote: string;
}

export interface AgentOutput {
  newEntities: { name: string; type: string; page: string[]; aliases: string[] }[];
  wiki: { entity: string; lines: string[]; certainty: Certainty; message?: string }[];
  states: { entity: string; state: string }[];
  contradictions: Contradiction[];
  timeSkip?: string;
  concrete?: string;
  unlinkedNames: { name: string; reason: string }[];
}

/** What a run did, for the panel. Only `created`, `pages` and `states` were written to the vault. */
export interface AgentReport {
  created: string[];
  pages: { entity: string; lines: string[] }[];
  states: { entity: string; state: string }[];
  /** Facts a character only claimed: offered to the writer, never written. */
  claimed: { entity: string; lines: string[] }[];
  /** Things the agent was told but left alone, in words. */
  skipped: string[];
  contradictions: Contradiction[];
  timeSkip?: string;
  concrete?: string;
  unlinkedNames: { name: string; reason: string }[];
}

const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const rec = (x: unknown): Record<string, unknown> => (typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {});
const strings = (x: unknown): string[] => list(x).map(str).filter(Boolean);

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
    newEntities: list(raw.newEntities).map(rec).map((e) => ({ name: str(e.name), type: str(e.type), page: strings(e.page), aliases: strings(e.aliases) })).filter((e) => e.name),
    wiki: list(raw.wiki).map(rec).map((w) => ({ entity: str(w.entity), lines: strings(w.lines), certainty: certainty(w.certainty), message: str(w.message) || undefined })).filter((w) => w.entity && w.lines.length),
    states: list(raw.states).map(rec).map((s) => ({ entity: str(s.entity), state: str(s.state) })).filter((s) => s.entity && s.state),
    contradictions: list(raw.contradictions).map(rec).map((c) => ({ entity: str(c.entity), claim: str(c.claim), sceneQuote: str(c.sceneQuote), wikiQuote: str(c.wikiQuote) })).filter((c) => c.entity && c.claim && c.sceneQuote && c.wikiQuote),
    timeSkip: str(raw.timeSkip) || undefined,
    concrete: str(raw.concrete) || undefined,
    unlinkedNames: list(raw.unlinkedNames).map(rec).map((n) => ({ name: str(n.name), reason: str(n.reason) })).filter((n) => n.name),
  };
}

/** Lower-case letters and digits only, so a quote still matches after the model changes quotes, dashes or spacing. */
const squash = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const appearsIn = (haystack: string, needle: string): boolean => squash(needle) !== '' && squash(haystack).includes(squash(needle));

const STATE_LIMIT = 240;

/** Removes what the agent wrote for a scene, keeping everything the writer wrote. */
function dropAgentChanges(vault: Vault, sceneId: Id): { vault: Vault; entityIds: Set<Id> } {
  const changes = { ...vault.changes };
  const entityIds = new Set<Id>();
  for (const c of Object.values(vault.changes)) {
    if (c.agent === undefined || c.sceneId !== sceneId) continue;
    delete changes[c.id];
    entityIds.add(c.entityId);
  }
  return { vault: entityIds.size ? { ...vault, changes } : vault, entityIds };
}

/** Undoes the agent's output for one scene, and removes pages it created that nothing else has touched since. */
export function revertAgentOutput(vault: Vault, sceneId: Id): Vault {
  const dropped = dropAgentChanges(vault, sceneId);
  const entities = { ...dropped.vault.entities };
  const stillChanged = new Set(Object.values(dropped.vault.changes).map((c) => c.entityId));
  for (const id of dropped.entityIds) {
    const e = entities[id];
    if (e && e.note.trim() === '' && !stillChanged.has(id)) delete entities[id];
  }
  return { ...dropped.vault, entities };
}

const bullet = (line: string): string => `- ${line.replace(/^[-*•]\s*/, '')}`;

/** The page with the new lines added at the end, leaving out lines it already says. */
function withLines(note: string, lines: string[]): { note: string; added: string[] } {
  const added = lines.filter((l) => !appearsIn(note, l));
  if (!added.length) return { note, added };
  const body = note.trimEnd();
  const sep = body === '' ? '' : body.split('\n').pop()!.startsWith('- ') ? '\n' : '\n\n';
  return { note: `${body}${sep}${added.map(bullet).join('\n')}\n`, added };
}

function typeFor(vault: Vault, name: string): { vault: Vault; id: Id } {
  const known = Object.values(vault.entityTypes).find((t) => slugify(t.name) === slugify(name)) ?? sortedTypes(vault)[0];
  if (known) return { vault, id: known.id };
  const r = addEntityType(vault, { name: 'Note' });
  return { vault: r.vault, id: r.id };
}

/**
 * Applies the agent's answer for one scene. Wiki lines go in as additions to the page, in a revision anchored at the
 * scene; short-lived state goes in as a `state` property set at the scene. The writer's own revisions are never
 * amended, and running the same scene again replaces the agent's earlier output instead of adding to it.
 */
export function applyAgentOutput(vault: Vault, sceneId: Id, out: AgentOutput, model: string): { vault: Vault; report: AgentReport } {
  const scene = vault.scenes[sceneId];
  const report: AgentReport = { created: [], pages: [], states: [], claimed: [], skipped: [], contradictions: [], unlinkedNames: [...out.unlinkedNames] };
  let v = dropAgentChanges(vault, sceneId).vault;

  // 1. A [[link]] with no page is the writer asking for one. Only those become entities; other names are suggestions.
  const wanted = new Map(unresolvedLinks(v, scene.prose).map((t) => [slugify(t), t]));
  const pending = new Map<Id, string[]>();
  const wiki = [...out.wiki];
  for (const n of out.newEntities) {
    const existing = findEntity(v, n.name);
    if (existing) {
      wiki.push({ entity: existing.name, lines: n.page, certainty: 'stated' });
      continue;
    }
    const target = wanted.get(slugify(n.name));
    if (!target) {
      report.unlinkedNames.push({ name: n.name, reason: 'Not linked in the scene, so no page was made.' });
      continue;
    }
    const type = typeFor(v, n.type);
    const added = addEntity(type.vault, { name: target, typeId: type.id, note: '' });
    const aliases = n.aliases.filter((a) => !findEntity(added.vault, a));
    v = aliases.length ? { ...added.vault, entities: { ...added.vault.entities, [added.id]: { ...added.vault.entities[added.id], aliases } } } : added.vault;
    report.created.push(target);
    wanted.delete(slugify(n.name));
    pending.set(added.id, n.page);
  }

  // 2. Lasting facts become additions to each page. Claims are only reported.
  const lines = new Map<Id, string[]>(pending);
  const messages = new Map<Id, string>();
  for (const w of wiki) {
    const e = findEntity(v, w.entity);
    if (!e) {
      report.skipped.push(`No page called “${w.entity}”, so its facts were not written.`);
    } else if (w.certainty === 'claimed') {
      report.claimed.push({ entity: e.name, lines: w.lines });
    } else {
      lines.set(e.id, [...(lines.get(e.id) ?? []), ...w.lines]);
      if (w.message) messages.set(e.id, w.message);
    }
  }
  const r = new Resolver(v);
  for (const [id, facts] of lines) {
    const e = v.entities[id];
    if (!facts.length) continue;
    if (Object.values(v.changes).some((c) => c.op === 'revise' && c.entityId === id && c.sceneId === sceneId)) {
      report.skipped.push(`You already revised ${e.name}’s page after this scene, so it was left alone.`);
      continue;
    }
    const before = r.entityBefore(id, { sceneId });
    const next = withLines(before.note, facts);
    if (!next.added.length) continue;
    const committed = commitRevision(v, { entityId: id, anchor: { sceneId }, note: next.note, message: messages.get(id) ?? `From “${scene.title || 'a scene'}”`, before: { note: before.note, name: before.name } });
    v = committed.id ? { ...committed.vault, changes: { ...committed.vault.changes, [committed.id]: { ...committed.vault.changes[committed.id], agent: model } } } : committed.vault;
    report.pages.push({ entity: e.name, lines: next.added });
  }

  // 3. The short-lived state replaces the last one; it is only written when it says something new.
  for (const s of out.states) {
    const e = findEntity(v, s.entity);
    if (!e) continue;
    const state = s.state.slice(0, STATE_LIMIT);
    const previous = r.entityBefore(e.id, { sceneId }).props.state?.value;
    if (previous === state) continue;
    v = addChange(v, { sceneId, entityId: e.id, op: 'set', property: 'state', value: state, agent: model }).vault;
    report.states.push({ entity: e.name, state });
  }

  // 4. A contradiction is only shown with evidence: the scene quote must be in the scene, the wiki quote in what the
  // agent was shown. A scene the writer has not placed in time has no "before" to contradict.
  if (!scene.someday) {
    const text = sceneText(scene.prose);
    for (const c of out.contradictions) {
      const e = findEntity(vault, c.entity);
      if (!e) continue;
      const at = r.entityBefore(e.id, { sceneId });
      const shown = `${at.note}\n${at.props.state ? String(at.props.state.value) : ''}\n${Object.values(at.props).map((p) => String(p.value)).join('\n')}`;
      if (appearsIn(text, c.sceneQuote) && appearsIn(shown, c.wikiQuote)) report.contradictions.push(c);
    }
    const moment = vault.moments[scene.momentId];
    if (out.timeSkip && out.timeSkip !== moment?.timeSkip) report.timeSkip = out.timeSkip;
    if (out.concrete && out.concrete !== moment?.concrete) report.concrete = out.concrete;
  }

  return { vault: v, report };
}
