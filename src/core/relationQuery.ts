// Relation queries for the command palette: "children of Ashford", "under Asia #city", "siblings Mira".
// The words read like what you want: children / parents / siblings of something, everything under it (all
// descendants) or above it (all ancestors). "of" is optional, and #tags narrow the answer. Pure.

import { normalizeTag, parseTags } from './links';
import type { Relations } from './relations';
import type { Id, Vault } from './types';

export type RelationKind = 'children' | 'parents' | 'siblings' | 'descendants' | 'ancestors';

const KEYWORDS: Record<string, RelationKind> = {
  children: 'children',
  child: 'children',
  kids: 'children',
  parents: 'parents',
  parent: 'parents',
  siblings: 'siblings',
  sibling: 'siblings',
  under: 'descendants',
  descendants: 'descendants',
  above: 'ancestors',
  ancestors: 'ancestors',
};

/** How each kind is titled, e.g. "Children of Ashford". */
export const RELATION_TITLE: Record<RelationKind, string> = {
  children: 'Children of',
  parents: 'Parents of',
  siblings: 'Siblings of',
  descendants: 'Everything under',
  ancestors: 'Everything above',
};

export interface RelationQuery {
  kind: RelationKind;
  /** What the author typed for the entity, e.g. "ash"; matched loosely against names. Empty while still typing it. */
  subject: string;
  /** `#tag` filters: the answer keeps entities tagged with all of them (or a sub-tag). */
  tags: string[];
}

/** Reads a palette query as a relation query, or null when it does not start with one of the words. */
export function parseRelationQuery(raw: string): RelationQuery | null {
  const m = /^\s*(\p{L}+)(?:\s+(.*))?$/su.exec(raw);
  if (!m) return null;
  const kind = KEYWORDS[m[1].toLowerCase()];
  if (kind === undefined) return null;
  let rest = m[2] ?? '';
  const tags: string[] = [];
  rest = rest.replace(/(^|\s)#([\p{L}\p{N}_\-/]+)/gu, (_all, lead: string, body: string) => {
    const tag = normalizeTag(body);
    if (tag !== null) tags.push(tag);
    return lead;
  });
  const subject = rest.replace(/^of\s+/i, '').replace(/\s+/g, ' ').trim();
  return { kind, subject: /^of$/i.test(subject) ? '' : subject, tags };
}

/** The entities the relation names for `subjectId`, narrowed by the query's tags, in name order. */
export function runRelationQuery(vault: Vault, rel: Relations, query: RelationQuery, subjectId: Id): Id[] {
  const ids = rel[query.kind](subjectId);
  if (query.tags.length === 0) return ids;
  return ids.filter((id) => {
    const have = parseTags(vault.entities[id].note);
    return query.tags.every((want) => have.some((t) => t === want || t.startsWith(`${want}/`)));
  });
}
