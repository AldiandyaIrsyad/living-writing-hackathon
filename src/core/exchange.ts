// Export / import of a whole vault: as JSON, and as a zip of human-readable markdown files.
// Pure TS: no React or DOM. Identity always comes from frontmatter ids, never from file names.
import type JSZip from 'jszip';
import { Document, parse, stringify } from 'yaml';
import { GENERATOR } from './appInfo';
import { currentVersion, runMigrations, type Migrations } from './migrate';
import { isStatus } from './status';
import { isLink } from './types';
import type {
  Arc,
  Chapter,
  ChangeOp,
  Constraint,
  Entity,
  EntityType,
  Id,
  Moment,
  Props,
  PropValue,
  ReviewItem,
  ScalarValue,
  Scene,
  Story,
  StateChange,
  Vault,
} from './types';

/**
 * Steps that upgrade an export from format n to n+1, applied to the parsed document before it is validated (see
 * migrate.ts). Empty while version 1 is the only format. For the markdown-files format the document is the index file;
 * a change that has to rewrite entity or scene files needs a files-level step added alongside when it comes up.
 */
const MIGRATIONS: Migrations<Rec> = {
  // 1 → 2: the review list. Older files have none; an older app that opened a newer file would have silently dropped it.
  1: (doc) => {
    const vault = doc.vault;
    if (typeof vault === 'object' && vault !== null && !Array.isArray(vault)) return { ...doc, vault: { reviewItems: {}, ...vault } };
    return { reviewItems: [], ...doc };
  },
  // 2 → 3: scene status. An optional field, so nothing to change; the bump makes an older app refuse the file instead of dropping the statuses.
  2: (doc) => doc,
};

export const FORMAT_VERSION = currentVersion(MIGRATIONS);

const FORMAT_NAME = 'living-writing';

export const INDEX_FILE = 'living-writing.yaml';
const CHANGE_OPS: readonly ChangeOp[] = ['set', 'remove', 'add', 'removeItem', 'create', 'retire', 'note', 'revise'];

type Rec = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Validation helpers. Everything read from disk or from JSON goes through these.
// ---------------------------------------------------------------------------

function fail(where: string, message: string): never {
  throw new Error(`Invalid ${where}: ${message}`);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function asRecord(v: unknown, where: string): Rec {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(where, 'expected an object');
  return v as Rec;
}

function str(r: Rec, key: string, where: string): string {
  const v = r[key];
  if (typeof v !== 'string') fail(where, `"${key}" must be a string`);
  return v;
}

function num(r: Rec, key: string, where: string): number {
  const v = r[key];
  if (typeof v !== 'number') fail(where, `"${key}" must be a number`);
  return v;
}

function strList(r: Rec, key: string, where: string): string[] {
  const v = r[key];
  if (!Array.isArray(v) || !v.every((x: unknown) => typeof x === 'string')) {
    fail(where, `"${key}" must be a list of strings`);
  }
  return v as string[];
}

function isScalar(v: unknown): v is ScalarValue {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return true;
  return isLink(v) && typeof v.target === 'string';
}

function isPropValue(v: unknown): v is PropValue {
  return Array.isArray(v) ? v.every((x: unknown) => isScalar(x)) : isScalar(v);
}

function isChangeOp(s: string): s is ChangeOp {
  return (CHANGE_OPS as readonly string[]).includes(s);
}

function propsOf(r: Rec, key: string, where: string): Props {
  const v = asRecord(r[key], `${where}.${key}`);
  for (const [name, value] of Object.entries(v)) {
    if (!isPropValue(value)) fail(where, `property "${name}" is not a valid value`);
  }
  return v as Props;
}

/**
 * Fields of a record that `known` does not list, plus anything an earlier round trip already kept under "extra".
 * Undefined when there are none.
 */
function extrasOf(r: Rec, known: readonly string[], where: string): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = r.extra === undefined ? {} : { ...asRecord(r.extra, `${where}.extra`) };
  for (const [key, value] of Object.entries(r)) if (key !== 'extra' && !known.includes(key)) out[key] = value;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** A checker that also keeps the fields it does not know. */
function carrying<T extends { id: string; extra?: Record<string, unknown> }>(check: (v: unknown, where: string) => T, known: readonly string[]): (v: unknown, where: string) => T {
  return (v, where) => {
    const item = check(v, where);
    const extra = extrasOf(asRecord(v, where), known, where);
    if (extra) item.extra = extra;
    return item;
  };
}

/** Frontmatter for a markdown file: the known fields, then the kept unknown ones (which never override a known one). */
function withExtra(known: Rec, extra: Record<string, unknown> | undefined): Rec {
  if (!extra) return known;
  const out: Rec = { ...known };
  for (const [key, value] of Object.entries(extra)) if (!(key in out)) out[key] = value;
  return out;
}

function checkEntityType(v: unknown, where: string): EntityType {
  const r = asRecord(v, where);
  const type: EntityType = {
    id: str(r, 'id', where),
    name: str(r, 'name', where),
    color: str(r, 'color', where),
    icon: str(r, 'icon', where),
    defaultProps: propsOf(r, 'defaultProps', where),
  };
  if (r.group !== undefined) {
    if (typeof r.group !== 'boolean') fail(where, 'group must be true or false');
    type.group = r.group;
  }
  for (const key of ['description', 'template', 'parentLabel', 'childrenLabel'] as const) {
    if (r[key] !== undefined) {
      if (typeof r[key] !== 'string') fail(where, `${key} must be text`);
      type[key] = r[key];
    }
  }
  return type;
}

function checkEntity(v: unknown, where: string): Entity {
  const r = asRecord(v, where);
  const entity: Entity = {
    id: str(r, 'id', where),
    typeId: str(r, 'typeId', where),
    name: str(r, 'name', where),
    aliases: strList(r, 'aliases', where),
    note: str(r, 'note', where),
    props: propsOf(r, 'props', where),
  };
  if (r.image !== undefined) entity.image = str(r, 'image', where);
  return entity;
}

function checkMoment(v: unknown, where: string): Moment {
  const r = asRecord(v, where);
  const moment: Moment = { id: str(r, 'id', where), timelineId: str(r, 'timelineId', where) };
  if (r.label !== undefined) moment.label = str(r, 'label', where);
  if (r.concrete !== undefined) moment.concrete = str(r, 'concrete', where);
  if (r.labels !== undefined) moment.labels = strList(r, 'labels', where);
  if (r.timeSkip !== undefined) moment.timeSkip = str(r, 'timeSkip', where);
  return moment;
}

function checkConstraint(v: unknown, where: string): Constraint {
  const r = asRecord(v, where);
  const constraint: Constraint = {
    id: str(r, 'id', where),
    before: str(r, 'before', where),
    after: str(r, 'after', where),
    timelineId: str(r, 'timelineId', where),
  };
  // Absent means an end-to-start ordering; the key is only present for a "during" placement.
  if (r.offset !== undefined) {
    const offset = num(r, 'offset', where);
    if (offset < 0) fail(where, '"offset" must not be negative');
    constraint.offset = offset;
  }
  if (r.gap !== undefined) constraint.gap = str(r, 'gap', where);
  return constraint;
}

function checkStory(v: unknown, where: string): Story {
  const r = asRecord(v, where);
  return {
    id: str(r, 'id', where),
    name: str(r, 'name', where),
    color: str(r, 'color', where),
    order: num(r, 'order', where),
  };
}

function checkArc(v: unknown, where: string): Arc {
  const r = asRecord(v, where);
  return {
    id: str(r, 'id', where),
    storyId: str(r, 'storyId', where),
    title: str(r, 'title', where),
    order: num(r, 'order', where),
  };
}

function checkReviewItem(v: unknown, where: string): ReviewItem {
  const r = asRecord(v, where);
  const status = str(r, 'status', where);
  if (status !== 'open' && status !== 'done' && status !== 'dismissed') fail(where, `"status" must be open, done or dismissed (found "${status}")`);
  return { id: str(r, 'id', where), sceneId: str(r, 'sceneId', where), cause: str(r, 'cause', where), status, created: num(r, 'created', where) };
}

function checkChapter(v: unknown, where: string): Chapter {
  const r = asRecord(v, where);
  const chapter: Chapter = {
    id: str(r, 'id', where),
    storyId: str(r, 'storyId', where),
    title: str(r, 'title', where),
    order: num(r, 'order', where),
  };
  // Absent means "no arc"; the key is only present when the chapter has one.
  if (r.arcId !== undefined) chapter.arcId = str(r, 'arcId', where);
  if (r.labels !== undefined) chapter.labels = strList(r, 'labels', where);
  if (r.note !== undefined) chapter.note = str(r, 'note', where);
  return chapter;
}

function checkScene(v: unknown, where: string): Scene {
  const r = asRecord(v, where);
  const scene: Scene = {
    id: str(r, 'id', where),
    storyId: str(r, 'storyId', where),
    chapterId: r.chapterId === null ? null : str(r, 'chapterId', where),
    title: str(r, 'title', where),
    prose: str(r, 'prose', where),
    momentId: str(r, 'momentId', where),
    order: num(r, 'order', where),
  };
  // Absent means "nothing added by hand"; the key is only present when the scene has a cast list.
  if (r.cast !== undefined) scene.cast = strList(r, 'cast', where);
  if (r.labels !== undefined) scene.labels = strList(r, 'labels', where);
  if (r.synopsis !== undefined) scene.synopsis = str(r, 'synopsis', where);
  if (r.someday !== undefined) {
    if (typeof r.someday !== 'boolean') fail(where, '"someday" must be true or false');
    if (r.someday) scene.someday = true;
  }
  if (r.status !== undefined) {
    const status = str(r, 'status', where);
    if (!isStatus(status)) fail(where, `"status" must be idea, draft, revised or done (found "${status}")`);
    scene.status = status;
  }
  // Absent means one column; the key is only present when the clip is stretched.
  if (r.span !== undefined) {
    const span = num(r, 'span', where);
    if (!Number.isInteger(span) || span < 1) fail(where, '"span" must be a whole number, 1 or more');
    scene.span = span;
  }
  return scene;
}

function checkChange(v: unknown, where: string): StateChange {
  const r = asRecord(v, where);
  const op = str(r, 'op', where);
  if (!isChangeOp(op)) fail(where, `unknown op "${op}"`);
  const change: StateChange = {
    id: str(r, 'id', where),
    entityId: str(r, 'entityId', where),
    op,
    order: num(r, 'order', where),
  };
  // A change belongs to a scene, or sits on the timeline at a column; not both, and never neither.
  if (r.sceneId !== undefined) change.sceneId = str(r, 'sceneId', where);
  if (r.at !== undefined) {
    const at = num(r, 'at', where);
    if (!Number.isInteger(at) || at < 0) fail(where, '"at" must be a whole column number, 0 or more');
    change.at = at;
  }
  if (change.sceneId === undefined && change.at === undefined) fail(where, 'needs a "sceneId" or an "at" column');
  if (r.property !== undefined) change.property = str(r, 'property', where);
  const value = r.value;
  if (value !== undefined) {
    if (!isPropValue(value)) fail(where, '"value" is not a valid value');
    change.value = value;
  }
  if (r.message !== undefined) change.message = str(r, 'message', where);
  if (r.note !== undefined) change.note = str(r, 'note', where);
  if (r.rename !== undefined) change.rename = str(r, 'rename', where);
  if (r.agent !== undefined) change.agent = str(r, 'agent', where);
  return change;
}

const readEntityType = carrying(checkEntityType, ['id', 'name', 'color', 'icon', 'defaultProps', 'group', 'description', 'template', 'parentLabel', 'childrenLabel']);
const readEntity = carrying(checkEntity, ['id', 'typeId', 'name', 'aliases', 'note', 'props', 'image']);
const readMoment = carrying(checkMoment, ['id', 'timelineId', 'label', 'concrete', 'labels', 'timeSkip']);
const readConstraint = carrying(checkConstraint, ['id', 'before', 'after', 'timelineId', 'offset', 'gap']);
const readStory = carrying(checkStory, ['id', 'name', 'color', 'order']);
const readArc = carrying(checkArc, ['id', 'storyId', 'title', 'order']);
const readChapter = carrying(checkChapter, ['id', 'storyId', 'title', 'order', 'arcId', 'labels', 'note']);
const readScene = carrying(checkScene, ['id', 'storyId', 'chapterId', 'title', 'prose', 'synopsis', 'momentId', 'order', 'cast', 'span', 'status', 'labels', 'someday']);
const readChange = carrying(checkChange, ['id', 'sceneId', 'at', 'entityId', 'op', 'property', 'value', 'order', 'message', 'note', 'rename', 'agent']);
const readReviewItem = carrying(checkReviewItem, ['id', 'sceneId', 'cause', 'status', 'created']);

/** Validates a `{ id: record }` map; every record's own id must match its key. */
function parseCollection<T extends { id: string }>(
  raw: unknown,
  name: string,
  check: (v: unknown, where: string) => T,
): Record<Id, T> {
  if (raw === undefined) return {};
  const map = asRecord(raw, name);
  const out: Record<Id, T> = {};
  for (const [key, value] of Object.entries(map)) {
    const where = `${name}.${key}`;
    const item = check(value, where);
    if (item.id !== key) fail(where, `key does not match id "${item.id}"`);
    out[key] = item;
  }
  return out;
}

/** Turns a YAML list of records (each with an `id`) into a `{ id: record }` map, rejecting duplicates. */
function keyById(list: unknown, name: string): Rec {
  if (list === undefined) return {};
  if (!Array.isArray(list)) fail(name, 'expected a list');
  const out: Rec = {};
  for (const item of list) {
    const r = asRecord(item, name);
    const id = str(r, 'id', name);
    if (Object.hasOwn(out, id)) fail(name, `duplicate id "${id}"`);
    out[id] = r;
  }
  return out;
}

function addUnique<T extends { id: string }>(target: Record<Id, T>, item: T, where: string): void {
  if (Object.hasOwn(target, item.id)) fail(where, `duplicate id "${item.id}"`);
  target[item.id] = item;
}

/** Checks the envelope and returns the document upgraded to the current format. The caller's document is not changed. */
export function checkEnvelope(doc: Rec, migrations: Migrations<Rec> = MIGRATIONS): Rec {
  if (doc.format !== FORMAT_NAME) fail('file', `not a Living Writing export (expected "format: ${FORMAT_NAME}")`);
  const version = doc.version;
  if (typeof version !== 'number') fail('file', '"version" must be a number');
  try {
    return { ...runMigrations<Rec>(doc, version, migrations, (v) => structuredClone(v)).value, version: currentVersion(migrations) };
  } catch (e) {
    return fail('file', errorMessage(e));
  }
}

function vaultFromRecord(raw: Rec): Vault {
  return {
    entityTypes: parseCollection(raw.entityTypes, 'entityTypes', readEntityType),
    entities: parseCollection(raw.entities, 'entities', readEntity),
    moments: parseCollection(raw.moments, 'moments', readMoment),
    constraints: parseCollection(raw.constraints, 'constraints', readConstraint),
    stories: parseCollection(raw.stories, 'stories', readStory),
    arcs: parseCollection(raw.arcs, 'arcs', readArc),
    chapters: parseCollection(raw.chapters, 'chapters', readChapter),
    scenes: parseCollection(raw.scenes, 'scenes', readScene),
    changes: parseCollection(raw.changes, 'changes', readChange),
    reviewItems: parseCollection(raw.reviewItems, 'reviewItems', readReviewItem),
  };
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

export function exportJSON(vault: Vault): string {
  return JSON.stringify({ format: FORMAT_NAME, version: FORMAT_VERSION, generator: GENERATOR, vault }, null, 2);
}

export function importJSON(text: string): Vault {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid import: not valid JSON (${errorMessage(e)})`, { cause: e });
  }
  const doc = checkEnvelope(asRecord(parsed, 'import'));
  if (doc.vault === undefined) fail('import', 'missing "vault"');
  return vaultFromRecord(asRecord(doc.vault, 'vault'));
}

// ---------------------------------------------------------------------------
// Markdown zip
// ---------------------------------------------------------------------------

/** Makes a string safe as a file or folder name on Windows, macOS and Linux. */
function safeName(name: string): string {
  const cleaned = name
    .replace(/[/\\:*?"<>|]/g, '-')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned === '' ? 'untitled' : cleaned;
}

/** Picks an unused `dir/base.md` path; collisions get ` (2)`, ` (3)`, ... Case-insensitive, since Windows is. */
function claimPath(used: Set<string>, dir: string, base: string): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} (${n})`;
    const path = `${dir}/${name}.md`;
    const key = path.toLowerCase();
    if (!used.has(key)) {
      used.add(key);
      return path;
    }
  }
}

/** `---` frontmatter block, then the body verbatim. Keeps lines unwrapped so output is stable. */
function frontmatterFile(frontmatter: Rec, body: string): string {
  return `---\n${stringify(frontmatter, { lineWidth: 0 })}---\n${body}`;
}

/** Splits a markdown file at the first `---` line after the opening one. The body is taken verbatim. */
function splitFrontmatter(text: string, where: string): { data: Rec; body: string } {
  if (!text.startsWith('---\n')) fail(where, 'file must start with YAML frontmatter ("---")');
  const close = text.indexOf('\n---\n', 3);
  if (close < 0) fail(where, 'frontmatter is not closed by a "---" line');
  const data = asRecord(parseYaml(text.slice(4, close + 1), where) ?? {}, where);
  return { data, body: text.slice(close + 5) };
}

function parseYaml(text: string, where: string): unknown {
  try {
    return parse(text);
  } catch (e) {
    return fail(where, `bad YAML (${errorMessage(e)})`);
  }
}

function changeFrontmatter(c: StateChange): Rec {
  const out: Rec = { id: c.id, entity: c.entityId, op: c.op };
  if (c.property !== undefined) out.property = c.property;
  if (c.value !== undefined) out.value = c.value;
  out.order = c.order;
  if (c.message !== undefined) out.message = c.message;
  if (c.rename !== undefined) out.rename = c.rename;
  if (c.note !== undefined) out.note = c.note;
  if (c.agent !== undefined) out.agent = c.agent;
  return withExtra(out, c.extra);
}

/**
 * The text of each entity's and scene's file, remembered by the object it came from. The vault is immutable and shares
 * every object an edit did not touch, so a flush only re-serialises what changed. A scene's text also depends on its
 * changes, so those are remembered with it and compared one by one.
 */
const entityTexts = new WeakMap<Entity, string>();
const sceneTexts = new WeakMap<Scene, { changes: StateChange[]; text: string }>();

/**
 * The vault as files: path (always "/"-separated, relative to the vault root) → text. Pure.
 * The markdown zip and the folder sync both write exactly this layout.
 */
export function vaultToFiles(vault: Vault): Map<string, string> {
  const files = new Map<string, string>();
  const used = new Set<string>();

  for (const entity of Object.values(vault.entities)) {
    const type = vault.entityTypes[entity.typeId] as EntityType | undefined;
    const path = claimPath(used, `Entities/${safeName(type?.name ?? 'Unknown type')}`, safeName(entity.name));
    let text = entityTexts.get(entity);
    if (text === undefined) {
      const fm: Rec = { id: entity.id, name: entity.name, type: entity.typeId, aliases: entity.aliases, props: entity.props };
      if (entity.image !== undefined) fm.image = entity.image;
      text = frontmatterFile(withExtra(fm, entity.extra), entity.note);
      entityTexts.set(entity, text);
    }
    files.set(path, text);
  }

  // Changes live in their scene's frontmatter. Timeline-anchored changes, and ones whose scene is missing, go to the index file.
  const changesByScene = new Map<Id, StateChange[]>();
  const orphanChanges: StateChange[] = [];
  for (const change of Object.values(vault.changes)) {
    if (change.at !== undefined || change.sceneId === undefined || !Object.hasOwn(vault.scenes, change.sceneId)) {
      orphanChanges.push(change);
      continue;
    }
    const list = changesByScene.get(change.sceneId);
    if (list) list.push(change);
    else changesByScene.set(change.sceneId, [change]);
  }

  for (const scene of Object.values(vault.scenes)) {
    const story = vault.stories[scene.storyId] as Story | undefined;
    const dir = `Stories/${safeName(story?.name ?? 'Unknown story')}`;
    const path = claimPath(used, dir, `${String(scene.order).padStart(2, '0')} ${safeName(scene.title)}`);
    const changes = [...(changesByScene.get(scene.id) ?? [])].sort((a, b) => a.order - b.order);
    const remembered = sceneTexts.get(scene);
    if (remembered && remembered.changes.length === changes.length && remembered.changes.every((c, i) => c === changes[i])) {
      files.set(path, remembered.text);
      continue;
    }
    const frontmatter: Rec = {
      id: scene.id,
      title: scene.title,
      story: scene.storyId,
      chapter: scene.chapterId,
      order: scene.order,
      moment: scene.momentId,
    };
    if (scene.cast !== undefined) frontmatter.cast = scene.cast;
    if (scene.span !== undefined) frontmatter.span = scene.span;
    if (scene.status !== undefined) frontmatter.status = scene.status;
    if (scene.labels !== undefined) frontmatter.labels = scene.labels;
    if (scene.synopsis !== undefined) frontmatter.synopsis = scene.synopsis;
    if (scene.someday !== undefined) frontmatter.someday = scene.someday;
    frontmatter.changes = changes.map(changeFrontmatter);
    const text = frontmatterFile(withExtra(frontmatter, scene.extra), scene.prose);
    sceneTexts.set(scene, { changes, text });
    files.set(path, text);
  }

  const index: Rec = {
    format: FORMAT_NAME,
    version: FORMAT_VERSION,
    entityTypes: Object.values(vault.entityTypes),
    moments: Object.values(vault.moments),
    constraints: Object.values(vault.constraints),
    stories: Object.values(vault.stories),
    arcs: Object.values(vault.arcs),
    chapters: Object.values(vault.chapters),
  };
  if (orphanChanges.length > 0) index.orphanChanges = orphanChanges;
  if (Object.keys(vault.reviewItems).length > 0) index.reviewItems = Object.values(vault.reviewItems);

  const doc = new Document(index);
  doc.commentBefore = ' Living Writing vault. Entities are in Entities/, scenes in Stories/.';
  files.set(INDEX_FILE, doc.toString({ lineWidth: 0 }));

  return files;
}

/**
 * Reads a vault from its files: the inverse of vaultToFiles. Files outside the index,
 * Entities/ and Stories/ (as .md) are ignored. Identity comes from frontmatter ids only.
 */
/** The unknown frontmatter keys of a file, as fields of the record being built (they are told apart by `extrasOf`). */
function fileExtras(fm: Rec, known: readonly string[], where: string): Rec {
  const extra = extrasOf(fm, known, where);
  return extra ? { extra } : {};
}

export function filesToVault(files: ReadonlyMap<string, string>): Vault {
  const indexText = files.get(INDEX_FILE);
  if (indexText === undefined) fail('vault', `missing ${INDEX_FILE}`);
  const index = checkEnvelope(asRecord(parseYaml(indexText, INDEX_FILE), INDEX_FILE));

  const vault: Vault = {
    entityTypes: parseCollection(keyById(index.entityTypes, 'entityTypes'), 'entityTypes', readEntityType),
    entities: {},
    moments: parseCollection(keyById(index.moments, 'moments'), 'moments', readMoment),
    constraints: parseCollection(keyById(index.constraints, 'constraints'), 'constraints', readConstraint),
    stories: parseCollection(keyById(index.stories, 'stories'), 'stories', readStory),
    arcs: parseCollection(keyById(index.arcs, 'arcs'), 'arcs', readArc),
    chapters: parseCollection(keyById(index.chapters, 'chapters'), 'chapters', readChapter),
    scenes: {},
    changes: parseCollection(keyById(index.orphanChanges, 'orphanChanges'), 'orphanChanges', readChange),
    reviewItems: parseCollection(keyById(index.reviewItems, 'reviewItems'), 'reviewItems', readReviewItem),
  };

  for (const [name, text] of files) {
    if (name.startsWith('Entities/') && name.endsWith('.md')) {
      const { data: fm, body } = splitFrontmatter(text, name);
      const entity = readEntity(
        {
          id: fm.id,
          name: fm.name,
          typeId: fm.type,
          aliases: fm.aliases ?? [],
          note: body,
          props: fm.props ?? {},
          ...(fm.image !== undefined ? { image: fm.image } : {}),
          ...fileExtras(fm, ['id', 'name', 'type', 'aliases', 'props', 'image'], name),
        },
        name,
      );
      addUnique(vault.entities, entity, name);
    } else if (name.startsWith('Stories/') && name.endsWith('.md')) {
      const { data: fm, body } = splitFrontmatter(text, name);
      const scene = readScene(
        {
          id: fm.id,
          storyId: fm.story,
          chapterId: fm.chapter ?? null,
          title: fm.title ?? '',
          prose: body,
          momentId: fm.moment,
          order: fm.order,
          cast: fm.cast,
          span: fm.span,
          status: fm.status,
          labels: fm.labels,
          synopsis: fm.synopsis,
          someday: fm.someday,
          ...fileExtras(fm, ['id', 'title', 'story', 'chapter', 'order', 'moment', 'cast', 'span', 'status', 'labels', 'synopsis', 'someday', 'changes'], name),
        },
        name,
      );
      addUnique(vault.scenes, scene, name);

      const changes = fm.changes ?? [];
      if (!Array.isArray(changes)) fail(name, '"changes" must be a list');
      for (const item of changes as unknown[]) {
        const c = asRecord(item, name);
        const change = readChange(
          {
            id: c.id,
            sceneId: scene.id,
            entityId: c.entity,
            op: c.op,
            property: c.property,
            value: c.value,
            order: c.order,
            message: c.message,
            note: c.note,
            rename: c.rename,
            agent: c.agent,
            ...fileExtras(c, ['id', 'entity', 'op', 'property', 'value', 'order', 'message', 'note', 'rename', 'agent'], name),
          },
          name,
        );
        addUnique(vault.changes, change, name);
      }
    }
  }

  return vault;
}

export async function exportMarkdownZip(vault: Vault): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip'); // only needed when exporting or importing a zip
  const zip = new JSZip();
  for (const [path, text] of vaultToFiles(vault)) zip.file(path, text);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function importMarkdownZip(data: Uint8Array | ArrayBuffer): Promise<Vault> {
  const { default: JSZip } = await import('jszip');
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (e) {
    throw new Error(`Invalid archive: not a zip file (${errorMessage(e)})`, { cause: e });
  }
  const files = new Map<string, string>();
  for (const entry of Object.values(zip.files)) {
    if (!entry.dir) files.set(entry.name, await entry.async('string'));
  }
  return filesToVault(files);
}
