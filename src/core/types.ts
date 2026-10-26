// Core data model for Living Writing. Pure data — no React, no DOM.

export type Id = string;

/** A reference to another entity inside a property value. `target` is the link text (name/slug/alias). */
export interface LinkValue {
  kind: 'link';
  target: string;
}

export type ScalarValue = string | number | boolean | LinkValue;
export type PropValue = ScalarValue | ScalarValue[];
export type Props = Record<string, PropValue>;

/**
 * Fields this version does not know, kept as they were read so that a record written by a newer version survives a
 * round trip through this one. Never read by the app; absent on a record with no such fields.
 */
export interface Carries {
  extra?: Record<string, unknown>;
}

export interface EntityType extends Carries {
  id: Id;
  name: string;
  color: string;
  icon: string;
  /** Template only: copied into new entities of this type. */
  defaultProps: Props;
  /** Entities of this type are groups others can be affiliated with (factions, guilds…). */
  group?: boolean;
  /** One line about what the type is for, shown in the wiki. */
  description?: string;
  /**
   * Boilerplate: markdown copied into the note of every new entity of this type. It is only a start: on the entity
   * everything in it can be edited or deleted.
   */
  template?: string;
  /** How this type words the parent / children relation, e.g. a place is "Located in" and "Contains". */
  parentLabel?: string;
  childrenLabel?: string;
}

export interface Entity extends Carries {
  id: Id;
  typeId: Id;
  /** Display name, e.g. "Norman". Links resolve by slugified name or alias. */
  name: string;
  aliases: string[];
  /** Markdown note, Obsidian-style syntax. */
  note: string;
  /** Optional portrait / cover image (data URL or external URL). */
  image?: string;
  /** Base properties — state before any scene changes it. */
  props: Props;
}

/** A point in relative time. Every scene sits at exactly one moment (or a moment can be a standalone milestone). */
export interface Moment extends Carries {
  id: Id;
  /** Legacy / display label (also used as fallback for concrete). */
  label?: string;
  /** Guaranteed date/time anchor (e.g. "2026-10-25", "Autumn, 2026"). Acts as an absolute ordering constraint when parseable. */
  concrete?: string;
  /** Standalone event bookmark(s) pinned directly to this moment on the timeline (even before any scene is written for it). */
  labels?: string[];
  /** Relative narrative time-skip note leading into this moment (e.g. "3 days later", "10 years later"). */
  timeSkip?: string;
  timelineId: string;
}

/** Ordering constraint between moments: `before` happens strictly before `after`. */
export interface Constraint extends Carries {
  id: Id;
  before: Id;
  after: Id;
  timelineId: string;
  /**
   * "During" placement: `after` starts `offset` columns after `before` starts, instead of after
   * `before` ends. When offset < the span of `before`, the two overlap in time.
   */
  offset?: number;
  /** Optional relative time-skip / gap note on this ordering rule (e.g. "Three days later", "Years later"). */
  gap?: string;
}

export interface Story extends Carries {
  id: Id;
  name: string;
  color: string;
  /** Sidebar / lane order. */
  order: number;
}

/** A group of consecutive chapters within a story (optional). */
export interface Arc extends Carries {
  id: Id;
  storyId: Id;
  title: string;
  order: number;
}

export interface Chapter extends Carries {
  id: Id;
  storyId: Id;
  title: string;
  order: number;
  /** Arc this chapter belongs to, if any. */
  arcId?: Id;
  /** Milestone / event labels bookmarked on this chapter (e.g. "The Death of Hero Nora"). */
  labels?: string[];
  /** The writer's notes on the whole chapter ("set in late autumn, 2026"); the story agent reads them with each of its scenes. */
  note?: string;
}

/** How far along a scene is. Absent means the writer has not said. */
export type SceneStatus = 'idea' | 'draft' | 'revised' | 'done';

export interface Scene extends Carries {
  id: Id;
  storyId: Id;
  chapterId: Id | null;
  title: string;
  /** Markdown prose. */
  prose: string;
  /** Short 1-2 line beat / synopsis summary (does not count toward manuscript prose or word counts). */
  synopsis?: string;
  momentId: Id;
  /** Telling order within the story (reading order), independent of chronology. */
  order: number;
  /** Entities added to this scene's cast by hand (in addition to [[linked]] ones). */
  cast?: Id[];
  /** Relative length on the timeline, in columns (default 1). Not real time — just "this takes a while". */
  span?: number;
  status?: SceneStatus;
  /** Milestone / event labels bookmarked on this scene (e.g. "The Death of Hero Nora"). */
  labels?: string[];
  /** True when the writer intentionally keeps this scene in the Unplaced / "Someday" tray until ready to place it on the timeline. */
  someday?: boolean;
}

export type ChangeOp =
  | 'set' // property = value
  | 'remove' // delete property
  | 'add' // append value to list property
  | 'removeItem' // remove value from list property
  | 'create' // entity starts existing at this scene
  | 'retire' // entity stops existing after this scene
  | 'note' // a commit with only a message — no structured property
  | 'revise'; // a new version of the entity's page (note and/or name) from this scene on

export interface StateChange extends Carries {
  id: Id;
  /**
   * Scene-anchored change: it belongs to this scene, takes effect after it, and moves in time when the scene does.
   * Absent on a timeline-anchored change (see `at`).
   */
  sceneId?: Id;
  /**
   * Timeline-anchored change: it takes effect from this column on (a playhead at x >= `at` sees it). It belongs to no
   * scene, so moving or deleting scenes never carries it along; only gaps opened or closed on the timeline shift it.
   */
  at?: number;
  entityId: Id;
  op: ChangeOp;
  /** Required for set/remove/add/removeItem. */
  property?: string;
  value?: PropValue;
  /** Order within the scene. */
  order: number;
  /** Commit message, e.g. "Falls defending the inn". */
  message?: string;
  /** op 'revise': the entity's whole page (markdown note) from this scene on. Absent = unchanged. */
  note?: string;
  /** op 'revise': the entity's display name from this scene on (e.g. Strider → Aragorn). Absent = unchanged. */
  rename?: string;
  /** Written by the story agent rather than the writer: the model that wrote it. The writer's own changes never carry it. */
  agent?: string;
}

/** Where an edit sits in time: after a scene (it moves with the scene), or at a timeline column (it stays put). */
export type Anchor = { sceneId: Id } | { at: number };

/** A scene the writer meant to look at again, and why. Marking one done is always the writer's own act. */
export type ReviewStatus = 'open' | 'done' | 'dismissed';

export interface ReviewItem extends Carries {
  id: Id;
  sceneId: Id;
  /** What made the scene worth a second look: "Delete a commit: Norman status: dead → alive". */
  cause: string;
  status: ReviewStatus;
  /** Epoch ms. */
  created: number;
}

export interface Vault {
  entityTypes: Record<Id, EntityType>;
  entities: Record<Id, Entity>;
  moments: Record<Id, Moment>;
  constraints: Record<Id, Constraint>;
  stories: Record<Id, Story>;
  arcs: Record<Id, Arc>;
  chapters: Record<Id, Chapter>;
  scenes: Record<Id, Scene>;
  changes: Record<Id, StateChange>;
  reviewItems: Record<Id, ReviewItem>;
}

export const COLLECTIONS = [
  'entityTypes',
  'entities',
  'moments',
  'constraints',
  'stories',
  'arcs',
  'chapters',
  'scenes',
  'changes',
  'reviewItems',
] as const satisfies readonly (keyof Vault)[];

export type CollectionName = (typeof COLLECTIONS)[number];

export function emptyVault(): Vault {
  return {
    entityTypes: {},
    entities: {},
    moments: {},
    constraints: {},
    stories: {},
    arcs: {},
    chapters: {},
    scenes: {},
    changes: {},
    reviewItems: {},
  };
}

/**
 * Where in time we are looking.
 * - latest: after every change.
 * - moment: everything strictly before `momentId`; if `includeSceneId` is set, that scene's
 *   own changes are applied on top ("just after this scene").
 * - position: the timeline playhead. `x` is in timeline columns; every scene whose column
 *   ends at or before x (column + span <= x) has happened.
 */
export type TimePoint =
  | { kind: 'latest' }
  | { kind: 'moment'; momentId: Id; includeSceneId?: Id }
  | { kind: 'position'; x: number };

export const LATEST: TimePoint = { kind: 'latest' };

let counter = 0;
export function newId(prefix = 'id'): Id {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${counter.toString(36)}`;
}

/** Normalise a name/link target for matching: lower-case, trimmed, spaces → dashes. */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}\-_]/gu, '');
}

export function isLink(v: unknown): v is LinkValue {
  return typeof v === 'object' && v !== null && (v as LinkValue).kind === 'link';
}
