import JSZip from 'jszip';
import pkgRaw from '../../package.json?raw';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import {
  FORMAT_VERSION,
  exportJSON,
  exportMarkdownZip,
  filesToVault,
  importJSON,
  importMarkdownZip,
  vaultToFiles,
} from './exchange';
import { addParent, addSibling, baseRelations, relationsAt } from './relations';
import { Resolver } from './resolve';
import { createDemoVault } from './seed';
import { deleteScene } from './timeline';
import { VaultBuilder } from './testkit';
import { createPerfVault } from './perfSeed';
import { emptyVault, type Chapter, type Vault } from './types';

const SMALL_PERF = { entities: 50, stories: 3, scenes: 100, changes: 200 };

async function readText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`missing ${path}`);
  return file.async('string');
}

function filePaths(zip: JSZip): string[] {
  return Object.values(zip.files)
    .filter((f) => !f.dir)
    .map((f) => f.name)
    .sort();
}

describe('JSON export/import', () => {
  it('round-trips the demo vault', () => {
    const demo = createDemoVault();
    expect(importJSON(exportJSON(demo))).toStrictEqual(demo);
  });

  it('round-trips the group flag on entity types, and omits it when absent', () => {
    const v = emptyVault();
    v.entityTypes.t_faction = { id: 't_faction', name: 'Faction', color: '#0f766e', icon: 'flag', defaultProps: {}, group: true };
    v.entityTypes.t_off = { id: 't_off', name: 'Off', color: '#000', icon: 'circle', defaultProps: {}, group: false };
    v.entityTypes.t_plain = { id: 't_plain', name: 'Plain', color: '#000', icon: 'circle', defaultProps: {} };
    const parsed = JSON.parse(exportJSON(v)) as { vault: { entityTypes: Record<string, Record<string, unknown>> } };
    expect(parsed.vault.entityTypes.t_faction.group).toBe(true);
    expect(parsed.vault.entityTypes.t_off.group).toBe(false);
    expect(Object.hasOwn(parsed.vault.entityTypes.t_plain, 'group')).toBe(false);
    expect(importJSON(exportJSON(v))).toStrictEqual(v);
  });

  it('round-trips a type description, boilerplate and relation labels through JSON and markdown', async () => {
    const v = emptyVault();
    v.entityTypes.t_place = {
      id: 't_place',
      name: 'Place',
      color: '#2563eb',
      icon: 'map',
      defaultProps: {},
      description: 'Where scenes happen.',
      template: '## Description\n\n## History\n',
      parentLabel: 'Located in',
      childrenLabel: 'Contains',
    };
    expect(importJSON(exportJSON(v))).toStrictEqual(v);
    expect(await importMarkdownZip(await exportMarkdownZip(v))).toStrictEqual(v);
  });

  it('keeps parent / sibling links, including ones set after a scene, so the relations resolve the same after import', async () => {
    const b = new VaultBuilder();
    for (const id of ['asia', 'ashford', 'harbor', 'mira']) b.entity(id, {}, id);
    b.scene('s1').scene('s2').chain('s1', 's2');
    let v = b.build();
    v = addParent(v, 'ashford', 'asia', 'base');
    v = addParent(v, 'harbor', 'ashford', { sceneId: 's2' });
    v = addSibling(v, 'mira', 'harbor', { sceneId: 's2' });
    const rel = (vault: Vault) => {
      const r = new Resolver(vault);
      return relationsAt(r, r.atScene('s2', true));
    };
    const expected = { children: rel(v).children('ashford'), siblings: rel(v).siblings('mira'), before: baseRelations(v).children('ashford') };
    expect(expected).toEqual({ children: ['harbor'], siblings: ['harbor'], before: [] });

    for (const back of [importJSON(exportJSON(v)), await importMarkdownZip(await exportMarkdownZip(v))]) {
      expect(back).toStrictEqual(v);
      expect(rel(back).children('ashford')).toEqual(expected.children);
      expect(rel(back).siblings('mira')).toEqual(expected.siblings);
    }
  });

  it('rejects a group flag that is not a boolean', () => {
    const bad = JSON.stringify({
      format: 'living-writing',
      version: 1,
      vault: { entityTypes: { t: { id: 't', name: 'T', color: '#000', icon: 'x', defaultProps: {}, group: 'yes' } } },
    });
    expect(() => importJSON(bad)).toThrow(/group/);
  });

  it('round-trips a small perf vault', () => {
    const perf = createPerfVault(SMALL_PERF);
    expect(importJSON(exportJSON(perf))).toStrictEqual(perf);
  });

  it('writes the format envelope', () => {
    const parsed = JSON.parse(exportJSON(createDemoVault())) as { format: string; version: number; vault: Vault };
    expect(parsed.format).toBe('living-writing');
    expect(parsed.version).toBe(FORMAT_VERSION);
    expect(Object.keys(parsed.vault.scenes)).toHaveLength(7);
  });

  it('fills missing collections with empty maps', () => {
    const text = JSON.stringify({ format: 'living-writing', version: 1, vault: {} });
    expect(importJSON(text)).toStrictEqual(emptyVault());
  });

  it('round-trips arcs and chapters both with and without an arc', () => {
    const demo = createDemoVault();
    demo.arcs.arc_extra = { id: 'arc_extra', storyId: 'story_main', title: 'Arc III: Coals', order: 2 };
    demo.chapters.ch_6 = { id: 'ch_6', storyId: 'story_main', title: 'Chapter 6', order: 5 };
    const imported = importJSON(exportJSON(demo));
    expect(imported).toStrictEqual(demo);
    expect(imported.chapters.ch_1.arcId).toBe('arc_1');
    expect(Object.hasOwn(imported.chapters.ch_6, 'arcId')).toBe(false);
  });

  it('imports older files that have no arcs key and no chapter arcIds', () => {
    const demo = createDemoVault();
    const parsed = JSON.parse(exportJSON(demo)) as { vault: Record<string, unknown> };
    delete parsed.vault.arcs;
    const oldChapters: Record<string, Chapter> = {};
    for (const chapter of Object.values(demo.chapters)) {
      const { arcId: _arcId, ...rest } = chapter;
      oldChapters[rest.id] = rest;
    }
    parsed.vault.chapters = oldChapters;
    const imported = importJSON(JSON.stringify(parsed));
    expect(imported.arcs).toStrictEqual({});
    expect(imported).toStrictEqual({ ...demo, arcs: {}, chapters: oldChapters });
  });

  it('rejects malformed arcs and chapter arcIds', () => {
    const bad = (vault: unknown): string => JSON.stringify({ format: 'living-writing', version: 1, vault });
    expect(() => importJSON(bad({ arcs: { a1: { id: 'a1', storyId: 's', title: 't' } } }))).toThrow(/arcs\.a1/);
    expect(() =>
      importJSON(bad({ chapters: { c1: { id: 'c1', storyId: 's', title: 't', order: 0, arcId: 7 } } })),
    ).toThrow(/arcId/);
  });

  it('rejects garbage with a clear Error', () => {
    expect(() => importJSON('this is not json')).toThrow(Error);
    expect(() => importJSON('this is not json')).toThrow(/not valid JSON/);
    expect(() => importJSON('[]')).toThrow(/Invalid/);
    expect(() => importJSON('{"format":"other","version":1,"vault":{}}')).toThrow(/format/);
    expect(() => importJSON('{"format":"living-writing","version":1}')).toThrow(/vault/);
    expect(() => importJSON('{"format":"living-writing","version":99,"vault":{}}')).toThrow(/newer version/);
  });

  it('rejects malformed records with the offending path', () => {
    const bad = (vault: unknown): string =>
      JSON.stringify({ format: 'living-writing', version: 1, vault });
    expect(() => importJSON(bad({ entities: { e1: { id: 'e1', typeId: 't' } } }))).toThrow(/entities\.e1/);
    expect(() =>
      importJSON(
        bad({
          entities: {
            e1: { id: 'e1', typeId: 't', name: 'x', aliases: [], note: '', props: { a: { nested: true } } },
          },
        }),
      ),
    ).toThrow(/property "a"/);
    expect(() => importJSON(bad({ changes: { c1: { id: 'c1', sceneId: 's', entityId: 'e', op: 'poke', order: 0 } } }))).toThrow(
      /unknown op/,
    );
    expect(() => importJSON(bad({ moments: { m1: { id: 'other', timelineId: 'main' } } }))).toThrow(/does not match/);
  });
});

describe('markdown zip export/import', () => {
  it('round-trips the demo vault', async () => {
    const demo = createDemoVault();
    expect(await importMarkdownZip(await exportMarkdownZip(demo))).toStrictEqual(demo);
  });

  it('round-trips the group flag on entity types through markdown', async () => {
    const v = emptyVault();
    v.entityTypes.t_faction = { id: 't_faction', name: 'Faction', color: '#0f766e', icon: 'flag', defaultProps: {}, group: true };
    v.entityTypes.t_plain = { id: 't_plain', name: 'Plain', color: '#000', icon: 'circle', defaultProps: {} };
    const back = await importMarkdownZip(await exportMarkdownZip(v));
    expect(back.entityTypes.t_faction.group).toBe(true);
    expect(Object.hasOwn(back.entityTypes.t_plain, 'group')).toBe(false);
    expect(back).toStrictEqual(v);
  });

  it('round-trips a small perf vault', async () => {
    const perf = createPerfVault(SMALL_PERF);
    expect(await importMarkdownZip(await exportMarkdownZip(perf))).toStrictEqual(perf);
  });

  it('round-trips an empty vault', async () => {
    expect(await importMarkdownZip(await exportMarkdownZip(emptyVault()))).toStrictEqual(emptyVault());
  });

  it('round-trips arcs and chapters both with and without an arc', async () => {
    const demo = createDemoVault();
    demo.arcs.arc_extra = { id: 'arc_extra', storyId: 'story_main', title: 'Arc III: Coals', order: 2 };
    demo.chapters.ch_6 = { id: 'ch_6', storyId: 'story_main', title: 'Chapter 6', order: 5 };
    const bytes = await exportMarkdownZip(demo);
    const zip = await JSZip.loadAsync(bytes);
    expect(await readText(zip, 'living-writing.yaml')).toContain('arcs:');
    const imported = await importMarkdownZip(bytes);
    expect(imported).toStrictEqual(demo);
    expect(imported.arcs.arc_1.title).toBe('Arc I: Embers');
    expect(Object.hasOwn(imported.chapters.ch_6, 'arcId')).toBe(false);
  });

  it('imports an older archive whose index has no arcs list', async () => {
    const zip = await JSZip.loadAsync(await exportMarkdownZip(createDemoVault()));
    const index = parse(await readText(zip, 'living-writing.yaml')) as Record<string, unknown>;
    delete index.arcs;
    zip.file('living-writing.yaml', stringify(index));
    const imported = await importMarkdownZip(await zip.generateAsync({ type: 'uint8array' }));
    expect(imported.arcs).toStrictEqual({});
    expect(imported.scenes).toStrictEqual(createDemoVault().scenes);
  });

  it('accepts an ArrayBuffer as well as a Uint8Array', async () => {
    const demo = createDemoVault();
    const bytes = await exportMarkdownZip(demo);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    expect(await importMarkdownZip(buffer)).toStrictEqual(demo);
  });

  it('writes the expected layout', async () => {
    const zip = await JSZip.loadAsync(await exportMarkdownZip(createDemoVault()));
    const paths = filePaths(zip);
    expect(paths).toContain('living-writing.yaml');
    expect(paths).toContain('Entities/Character/Norman.md');
    expect(paths).toContain('Entities/Place/Ashford.md');
    expect(paths).toContain('Stories/The Ashford Chronicle/00 Supper at the Inn.md');
    expect(paths).toContain('Stories/The Ashford Chronicle/01 The Stranger.md');
    expect(paths).toContain("Stories/Mira's Road/00 Crossroads.md");
    expect(paths).toHaveLength(1 + 9 + 7);
  });

  it('writes the entity body verbatim after the frontmatter', async () => {
    const demo = createDemoVault();
    const zip = await JSZip.loadAsync(await exportMarkdownZip(demo));
    const text = await readText(zip, 'Entities/Character/Norman.md');
    expect(text.startsWith('---\n')).toBe(true);
    expect(text.endsWith(`---\n${demo.entities.ent_norman.note}`)).toBe(true);
    expect(text).toContain('type: type_character');
  });

  it('writes the scene prose verbatim and the changes in frontmatter', async () => {
    const demo = createDemoVault();
    const zip = await JSZip.loadAsync(await exportMarkdownZip(demo));
    const text = await readText(zip, 'Stories/The Ashford Chronicle/00 Supper at the Inn.md');
    expect(text.endsWith(`---\n${demo.scenes.sc_1.prose}`)).toBe(true);
    const swordScene = await readText(zip, "Stories/Mira's Road/01 The Sword in the Ash.md");
    expect(swordScene).toContain('owner');
    expect(swordScene).toContain('target: Mira');
  });

  it('gives colliding names unique file names and keeps both entities', async () => {
    const demo = createDemoVault();
    demo.entities.ent_twin_a = {
      id: 'ent_twin_a',
      typeId: 'type_character',
      name: 'Norman',
      aliases: [],
      note: 'The first namesake.',
      props: {},
    };
    demo.entities.ent_twin_b = {
      id: 'ent_twin_b',
      typeId: 'type_character',
      name: 'norman',
      aliases: [],
      note: 'The second namesake.',
      props: {},
    };
    const bytes = await exportMarkdownZip(demo);
    const zip = await JSZip.loadAsync(bytes);
    const characterFiles = filePaths(zip).filter((p) => p.startsWith('Entities/Character/'));
    expect(characterFiles).toContain('Entities/Character/Norman.md');
    expect(characterFiles).toContain('Entities/Character/Norman (2).md');
    // The lower-case "norman" collides case-insensitively, so it gets the next free number.
    expect(characterFiles).toContain('Entities/Character/norman (3).md');
    expect(characterFiles).toHaveLength(new Set(characterFiles.map((p) => p.toLowerCase())).size);
    expect(await importMarkdownZip(bytes)).toStrictEqual(demo);
  });

  it('sanitises names containing slashes and other reserved characters', async () => {
    const demo = createDemoVault();
    demo.entities.ent_ash_ember = {
      id: 'ent_ash_ember',
      typeId: 'type_object',
      name: 'Ash/Ember',
      aliases: [],
      note: 'Named with a slash.',
      props: {},
    };
    demo.entities.ent_colon = {
      id: 'ent_colon',
      typeId: 'type_object',
      name: 'Why: "Because?" <no>|*',
      aliases: [],
      note: '',
      props: {},
    };
    demo.stories.story_tales = { id: 'story_tales', name: 'Tales: Part 1/2', color: '#000000', order: 2 };
    demo.scenes.sc_tales = {
      id: 'sc_tales',
      storyId: 'story_tales',
      chapterId: null,
      title: 'Opening?',
      prose: 'A tale begins.',
      momentId: 'm_1',
      order: 0,
    };
    const bytes = await exportMarkdownZip(demo);
    const zip = await JSZip.loadAsync(bytes);
    const paths = filePaths(zip);
    expect(paths).toContain('Entities/Object/Ash-Ember.md');
    expect(paths).toContain('Entities/Object/Why- -Because-- -no---.md');
    expect(paths).toContain('Stories/Tales- Part 1-2/00 Opening-.md');
    expect(paths.some((p) => /[:"<>|*?]/.test(p.replace(/^Stories\/|^Entities\/|^living-writing\.yaml$/g, '')))).toBe(
      false,
    );
    expect(await importMarkdownZip(bytes)).toStrictEqual(demo);
  });

  it('round-trips notes and prose with awkward content', async () => {
    const demo = createDemoVault();
    demo.entities.ent_norman.note = '\n\n---\nA body that starts with a rule.\n---\n\n  indented, trailing spaces   \n\n';
    demo.entities.ent_mira.note = '';
    demo.entities.ent_alice.note = '---';
    demo.entities.ent_bob.note = 'Ünïcode ✓ 日本語 🌙 — “quotes” and \\backslashes\\ and\ttabs';
    demo.entities.ent_ashford.props = { motto: '\n---\nnested rule inside a property\n---\n', empty: '' };
    demo.scenes.sc_2.prose = '\n---\n\nleading and trailing newlines\n\n---\n';
    demo.scenes.sc_3.prose = 'Windows line endings:\r\nkept as they are.\r\n';
    expect(await importMarkdownZip(await exportMarkdownZip(demo))).toStrictEqual(demo);
  });

  it('keeps a change whose scene is missing', async () => {
    const demo = createDemoVault();
    demo.changes.chg_orphan = {
      id: 'chg_orphan',
      sceneId: 'sc_missing',
      entityId: 'ent_norman',
      op: 'set',
      property: 'mood',
      value: 'grim',
      order: 0,
    };
    expect(await importMarkdownZip(await exportMarkdownZip(demo))).toStrictEqual(demo);
  });

  it('keeps moment labels optional and omits absent ones', async () => {
    const demo = createDemoVault();
    const imported = await importMarkdownZip(await exportMarkdownZip(demo));
    expect(imported.moments.m_1.label).toBe('Late autumn');
    expect(Object.hasOwn(imported.moments.m_2, 'label')).toBe(false);
    expect(Object.hasOwn(imported.changes.chg_1, 'value')).toBe(true);
  });

  it('rejects archives without the index file or with a broken scene', async () => {
    const noIndex = new JSZip();
    noIndex.file('hello.txt', 'hi');
    const noIndexBytes = await noIndex.generateAsync({ type: 'uint8array' });
    await expect(importMarkdownZip(noIndexBytes)).rejects.toThrow(/living-writing\.yaml/);

    await expect(importMarkdownZip(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/zip/);

    const bytes = await exportMarkdownZip(createDemoVault());
    const zip = await JSZip.loadAsync(bytes);
    zip.file('Stories/The Ashford Chronicle/00 Supper at the Inn.md', 'no frontmatter here');
    const broken = await zip.generateAsync({ type: 'uint8array' });
    await expect(importMarkdownZip(broken)).rejects.toThrow(/frontmatter/);
  });
});

describe('vault as files (vaultToFiles / filesToVault)', () => {
  it('round-trips the demo vault', () => {
    const demo = createDemoVault();
    expect(filesToVault(vaultToFiles(demo))).toStrictEqual(demo);
  });

  it('round-trips a small perf vault and an empty vault', () => {
    const perf = createPerfVault(SMALL_PERF);
    expect(filesToVault(vaultToFiles(perf))).toStrictEqual(perf);
    expect(filesToVault(vaultToFiles(emptyVault()))).toStrictEqual(emptyVault());
  });

  it('round-trips messages, the note op, cast, arcs and colliding names', () => {
    const v = withCommits();
    v.arcs.arc_extra = { id: 'arc_extra', storyId: 'story_main', title: 'Arc III: Coals', order: 2 };
    v.entities.ent_twin = { id: 'ent_twin', typeId: 'type_character', name: 'norman', aliases: [], note: 'Twin.', props: {} };
    expect(filesToVault(vaultToFiles(v))).toStrictEqual(v);
  });

  it('produces exactly the files of the markdown zip, with "/" separators', async () => {
    const demo = createDemoVault();
    const files = vaultToFiles(demo);
    const zip = await JSZip.loadAsync(await exportMarkdownZip(demo));
    expect([...files.keys()].sort()).toEqual(filePaths(zip));
    expect(files.has('Entities/Character/Norman.md')).toBe(true);
    expect(files.has('Stories/The Ashford Chronicle/00 Supper at the Inn.md')).toBe(true);
    expect(files.size).toBe(1 + 9 + 7);
  });

  it('is deterministic: the same vault gives the same text for every file', () => {
    const a = vaultToFiles(createDemoVault());
    const b = vaultToFiles(createDemoVault());
    expect([...a]).toStrictEqual([...b]);
  });

  it('rejects a file set without the index file', () => {
    const files = vaultToFiles(createDemoVault());
    files.delete('living-writing.yaml');
    expect(() => filesToVault(files)).toThrow(/living-writing\.yaml/);
  });

  it('ignores files outside the layout', () => {
    const files = vaultToFiles(createDemoVault());
    files.set('README.md', '# notes the user keeps here');
    files.set('Stories/The Ashford Chronicle/notes.txt', 'not a scene');
    expect(filesToVault(files)).toStrictEqual(createDemoVault());
  });
});

/** The demo with commit messages, a note-only commit and a hand-made cast on two scenes. */
function withCommits(): Vault {
  const v = createDemoVault();
  v.changes.chg_5.message = 'Arrives in Ashford: “watching”, #1 from the doorway';
  v.scenes.sc_2.cast = ['ent_mira', 'ent_norman'];
  v.scenes.sc_1.cast = [];
  return v;
}

/** Drops every key a pre-commit-message file would not have. */
function stripCommitFields(v: Vault): Vault {
  const out = structuredClone(v);
  for (const c of Object.values(out.changes)) delete c.message;
  for (const s of Object.values(out.scenes)) delete s.cast;
  return out;
}

async function rewriteFrontmatter(zip: JSZip, path: string, edit: (fm: Record<string, unknown>) => void): Promise<void> {
  const text = await readText(zip, path);
  const close = text.indexOf('\n---\n', 3);
  const fm = parse(text.slice(4, close + 1)) as Record<string, unknown>;
  edit(fm);
  zip.file(path, `---\n${stringify(fm)}---\n${text.slice(close + 5)}`);
}

describe('commit messages, note op and scene cast', () => {
  it('round-trips messages, the note op and cast through JSON', () => {
    const v = withCommits();
    const imported = importJSON(exportJSON(v));
    expect(imported).toStrictEqual(v);
    expect(imported.changes.chg_5.op).toBe('note');
    expect(imported.changes.chg_5.message).toBe('Arrives in Ashford: “watching”, #1 from the doorway');
    expect(imported.scenes.sc_2.cast).toEqual(['ent_mira', 'ent_norman']);
    expect(imported.scenes.sc_1.cast).toEqual([]);
  });

  it('round-trips messages, the note op and cast through markdown', async () => {
    const v = withCommits();
    expect(await importMarkdownZip(await exportMarkdownZip(v))).toStrictEqual(v);
  });

  it('omits message and cast keys when absent instead of writing undefined', async () => {
    const v = createDemoVault();
    delete v.changes.chg_1.message;
    const text = exportJSON(v);
    expect(text).not.toContain('undefined');
    const imported = importJSON(text);
    expect(Object.hasOwn(imported.changes.chg_1, 'message')).toBe(false);
    expect(Object.hasOwn(imported.scenes.sc_3, 'cast')).toBe(false);
    expect(imported).toStrictEqual(v);

    const bytes = await exportMarkdownZip(v);
    const zip = await JSZip.loadAsync(bytes);
    const betrayal = await readText(zip, 'Stories/The Ashford Chronicle/02 The Betrayal.md');
    expect(betrayal).not.toMatch(/^cast:/m);
    expect(betrayal).not.toContain('undefined');
    expect(await importMarkdownZip(bytes)).toStrictEqual(v);
  });

  it('writes the note op and messages into the markdown frontmatter', async () => {
    const zip = await JSZip.loadAsync(await exportMarkdownZip(withCommits()));
    const stranger = await readText(zip, 'Stories/The Ashford Chronicle/01 The Stranger.md');
    expect(stranger).toContain('cast:');
    expect(stranger).toContain('op: note');
    expect(stranger).toContain('Arrives in Ashford');
    expect(stranger).not.toContain('undefined');
  });

  it('accepts a note with no property or value in JSON', () => {
    const text = JSON.stringify({
      format: 'living-writing',
      version: 1,
      vault: {
        changes: { c1: { id: 'c1', sceneId: 's', entityId: 'e', op: 'note', order: 0, message: 'Just a thought' } },
      },
    });
    const imported = importJSON(text);
    expect(imported.changes.c1).toStrictEqual({ id: 'c1', sceneId: 's', entityId: 'e', op: 'note', order: 0, message: 'Just a thought' });
  });

  it('rejects non-string messages and non-list casts in JSON', () => {
    const bad = (vault: unknown): string => JSON.stringify({ format: 'living-writing', version: 1, vault });
    const change = (extra: Record<string, unknown>) => ({
      c1: { id: 'c1', sceneId: 's', entityId: 'e', op: 'set', property: 'p', value: 'v', order: 0, ...extra },
    });
    const scene = (extra: Record<string, unknown>) => ({
      s1: { id: 's1', storyId: 'st', chapterId: null, title: 't', prose: '', momentId: 'm', order: 0, ...extra },
    });
    expect(() => importJSON(bad({ changes: change({ message: 42 }) }))).toThrow(/changes\.c1[\s\S]*"message" must be a string/);
    expect(() => importJSON(bad({ changes: change({ message: null }) }))).toThrow(/"message" must be a string/);
    expect(() => importJSON(bad({ scenes: scene({ cast: 'ent_mira' }) }))).toThrow(/scenes\.s1[\s\S]*"cast" must be a list of strings/);
    expect(() => importJSON(bad({ scenes: scene({ cast: null }) }))).toThrow(/"cast" must be a list of strings/);
    expect(() => importJSON(bad({ scenes: scene({ cast: [1] }) }))).toThrow(/"cast" must be a list of strings/);
  });

  it('imports an old JSON file that has no message, note or cast fields', () => {
    const old = JSON.parse(exportJSON(createDemoVault())) as { vault: { changes: Record<string, Record<string, unknown>> } };
    for (const [id, c] of Object.entries(old.vault.changes)) {
      if (c.op === 'note') delete old.vault.changes[id];
      else delete c.message;
    }
    const expected = createDemoVault();
    delete expected.changes.chg_5;
    for (const c of Object.values(expected.changes)) delete c.message;
    const imported = importJSON(JSON.stringify(old));
    expect(imported).toStrictEqual(expected);
    expect(Object.values(imported.scenes).some((s) => Object.hasOwn(s, 'cast'))).toBe(false);
  });

  it('imports an old markdown archive that has no message, note or cast fields', async () => {
    const zip = await JSZip.loadAsync(await exportMarkdownZip(createDemoVault()));
    for (const path of Object.keys(zip.files)) {
      if (!path.startsWith('Stories/') || !path.endsWith('.md')) continue;
      await rewriteFrontmatter(zip, path, (fm) => {
        const changes = (fm.changes as Record<string, unknown>[]).filter((c) => c.op !== 'note');
        for (const c of changes) delete c.message;
        fm.changes = changes;
        delete fm.cast;
      });
    }
    const imported = await importMarkdownZip(await zip.generateAsync({ type: 'uint8array' }));
    const expected = stripCommitFields(createDemoVault());
    delete expected.changes.chg_5;
    expect(imported).toStrictEqual(expected);
  });

  it('rejects a non-string message or non-list cast in a markdown archive', async () => {
    const withBadMessage = await JSZip.loadAsync(await exportMarkdownZip(createDemoVault()));
    await rewriteFrontmatter(withBadMessage, 'Stories/The Ashford Chronicle/02 The Betrayal.md', (fm) => {
      (fm.changes as Record<string, unknown>[])[0].message = 42;
    });
    await expect(importMarkdownZip(await withBadMessage.generateAsync({ type: 'uint8array' }))).rejects.toThrow(
      /"message" must be a string/,
    );

    const withBadCast = await JSZip.loadAsync(await exportMarkdownZip(createDemoVault()));
    await rewriteFrontmatter(withBadCast, 'Stories/The Ashford Chronicle/01 The Stranger.md', (fm) => {
      fm.cast = 'ent_mira';
    });
    await expect(importMarkdownZip(await withBadCast.generateAsync({ type: 'uint8array' }))).rejects.toThrow(
      /"cast" must be a list of strings/,
    );
  });

  it('keeps an empty cast list distinct from no cast', async () => {
    const v = createDemoVault();
    v.scenes.sc_1.cast = [];
    const imported = await importMarkdownZip(await exportMarkdownZip(v));
    expect(imported.scenes.sc_1.cast).toStrictEqual([]);
    expect(Object.hasOwn(imported.scenes.sc_2, 'cast')).toBe(false);
  });
});

describe('stretched clips and during placement', () => {
  /** The demo world with sc_1 stretched over 3 columns and sc_2 placed during it (offset 1). */
  const stretched = (): Vault => {
    const v = createDemoVault();
    v.scenes.sc_1.span = 3;
    v.constraints.c_during = { id: 'c_during', before: v.scenes.sc_1.momentId, after: v.scenes.sc_2.momentId, timelineId: 'main', offset: 1 };
    return v;
  };

  it('round-trips span and offset through JSON', () => {
    const v = stretched();
    const parsed = importJSON(exportJSON(v));
    expect(parsed).toStrictEqual(v);
    expect(parsed.scenes.sc_1.span).toBe(3);
    expect(parsed.constraints.c_during.offset).toBe(1);
  });

  it('round-trips span and offset through markdown and files, and omits them when absent', async () => {
    const v = stretched();
    const imported = await importMarkdownZip(await exportMarkdownZip(v));
    expect(imported.scenes.sc_1.span).toBe(3);
    expect(imported.constraints.c_during).toStrictEqual(v.constraints.c_during);
    expect(filesToVault(vaultToFiles(v))).toStrictEqual(v);

    expect(Object.hasOwn(imported.scenes.sc_2, 'span')).toBe(false);
    const others = Object.values(imported.constraints).filter((c) => c.id !== 'c_during');
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((c) => !Object.hasOwn(c, 'offset'))).toBe(true);
    expect(Object.hasOwn(JSON.parse(exportJSON(createDemoVault())).vault.scenes.sc_1, 'span')).toBe(false);
  });

  it('rejects a span that is not a whole number of columns, and a negative offset', () => {
    const fractional = JSON.parse(exportJSON(stretched())) as { vault: { scenes: Record<string, { span: number }> } };
    fractional.vault.scenes.sc_1.span = 1.5;
    expect(() => importJSON(JSON.stringify(fractional))).toThrow(/"span" must be a whole number/);

    const negative = JSON.parse(exportJSON(stretched())) as { vault: { constraints: Record<string, { offset: number }> } };
    negative.vault.constraints.c_during.offset = -1;
    expect(() => importJSON(JSON.stringify(negative))).toThrow(/"offset" must not be negative/);
  });
});

describe('vaultToFiles remembers per-object text', () => {
  // The folder flush re-serialises only what an edit touched. The invariant that makes that safe: after any sequence of
  // edits, the files equal what a vault with no history (a deep copy, so nothing is remembered) produces.
  it('gives the same files as a fresh serialisation after a long random sequence of edits', () => {
    let seed = 7;
    const rand = (n: number) => Math.floor(((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296) * n);
    let v = createDemoVault();
    for (let step = 0; step < 150; step++) {
      const scenes = Object.values(v.scenes);
      const entities = Object.values(v.entities);
      const pick = <T,>(xs: T[]) => xs[rand(xs.length)];
      switch (rand(6)) {
        case 0: {
          const s = pick(scenes);
          v = { ...v, scenes: { ...v.scenes, [s.id]: { ...s, prose: `${s.prose} edit ${step}` } } };
          break;
        }
        case 1: {
          const e = pick(entities);
          v = { ...v, entities: { ...v.entities, [e.id]: { ...e, props: { ...e.props, mood: `m${step}` } } } };
          break;
        }
        case 2: {
          const e = pick(entities);
          v = { ...v, entities: { ...v.entities, [e.id]: { ...e, name: `${e.name} ${step}` } } };
          break;
        }
        case 3: {
          const id = `chg_${step}`;
          v = { ...v, changes: { ...v.changes, [id]: { id, sceneId: pick(scenes).id, entityId: pick(entities).id, op: 'set', property: 'p', value: step, order: 1000 + step } } };
          break;
        }
        case 4: {
          const c = Object.values(v.changes);
          const x = c.length > 0 ? pick(c) : undefined;
          if (x) v = { ...v, changes: { ...v.changes, [x.id]: { ...x, order: rand(50) } } };
          break;
        }
        default:
          if (scenes.length > 2) v = deleteScene(v, pick(scenes).id);
      }
      expect(vaultToFiles(v), `step ${step}`).toEqual(vaultToFiles(structuredClone(v)));
    }
  });
});

describe('fields this version does not know', () => {
  // Contract with newer versions of the app: a record written with extra fields keeps them through import and export,
  // in both formats, instead of silently losing them.
  const collections = ['entityTypes', 'entities', 'moments', 'constraints', 'stories', 'arcs', 'chapters', 'scenes', 'changes'] as const;

  function withFutureFields() {
    const doc = JSON.parse(exportJSON(createDemoVault())) as { vault: Record<string, Record<string, Record<string, unknown>>> };
    for (const name of collections) {
      const first = Object.values(doc.vault[name])[0];
      first.futureField = { from: name, nested: [1, 'two', true] };
    }
    return doc;
  }

  it('survive a JSON round trip, on every kind of record', () => {
    const vault = importJSON(JSON.stringify(withFutureFields()));
    for (const name of collections) expect(Object.values(vault[name])[0].extra).toEqual({ futureField: { from: name, nested: [1, 'two', true] } });
    const again = importJSON(exportJSON(vault));
    expect(again).toStrictEqual(vault);
  });

  it('survive the markdown files too: written beside the known fields, read back into the same records', () => {
    const vault = importJSON(JSON.stringify(withFutureFields()));
    const files = vaultToFiles(vault);
    expect([...files.values()].some((text) => text.includes('futureField:'))).toBe(true);
    expect(filesToVault(files)).toStrictEqual(vault);
  });

  it('never let a kept field override a known one, and add nothing to records that have none', () => {
    const doc = withFutureFields();
    const entity = Object.values(doc.vault.entities)[0];
    entity.extra = { name: 'Impostor', kept: 1 };
    const vault = importJSON(JSON.stringify(doc));
    const read = Object.values(vault.entities)[0];
    expect(read.name).not.toBe('Impostor');
    const text = [...vaultToFiles(vault).values()].find((t) => t.includes(`id: ${read.id}\n`))!;
    expect(text).not.toContain('name: Impostor');
    expect(text).toContain('kept: 1');
    expect(Object.values(vault.entities)[1]).not.toHaveProperty('extra');
  });
});

describe('generator stamp', () => {
  // Contract with bug reports: a JSON export says which build wrote it, and it is the version in package.json.
  it('a JSON export names the app version that wrote it, and still imports as the same vault', () => {
    const vault = new VaultBuilder().entity('norman').scene('a').build();
    const text = exportJSON(vault);
    expect((JSON.parse(text) as { generator: string }).generator).toBe(`living-writing@${(JSON.parse(pkgRaw) as { version: string }).version}`);
    expect(importJSON(text)).toStrictEqual(vault);
  });
});
