import { describe, it, expect } from 'vitest';
import {
  parseLinkInner,
  parseLinks,
  formatLink,
  findEntity,
  findScene,
  resolveLinkTime,
  renameEntity,
  renameScene,
  parseTags,
  findAuthorNotesOutsideCode,
} from './links';
import type { LinkTime } from './links';
import { emptyVault, slugify } from './types';
import type { Vault, Entity, Scene, StateChange, Moment } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entity(id: string, name: string, extra: Partial<Entity> = {}): Entity {
  return { id, typeId: 'type_char', name, aliases: [], note: '', props: {}, ...extra };
}

function scene(id: string, title: string, momentId: string, extra: Partial<Scene> = {}): Scene {
  return { id, storyId: 'story_main', chapterId: null, title, prose: '', momentId, order: 0, ...extra };
}

function moment(id: string): Moment {
  return { id, timelineId: 'main' };
}

function vaultOf(parts: {
  entities?: Entity[];
  scenes?: Scene[];
  moments?: Moment[];
  changes?: StateChange[];
}): Vault {
  const v = emptyVault();
  for (const e of parts.entities ?? []) v.entities[e.id] = e;
  for (const s of parts.scenes ?? []) v.scenes[s.id] = s;
  for (const m of parts.moments ?? []) v.moments[m.id] = m;
  for (const c of parts.changes ?? []) v.changes[c.id] = c;
  return v;
}

// ---------------------------------------------------------------------------
// parseLinkInner
// ---------------------------------------------------------------------------

describe('parseLinkInner', () => {
  it('parses a plain target as contextual time', () => {
    expect(parseLinkInner('norman')).toEqual({
      target: 'norman',
      heading: undefined,
      alias: undefined,
      time: { kind: 'context' },
      timeRaw: undefined,
    });
  });

  it('trims the target', () => {
    expect(parseLinkInner('   norman  ').target).toBe('norman');
  });

  it('splits a heading at the first #', () => {
    const p = parseLinkInner('norman#Backstory');
    expect(p.target).toBe('norman');
    expect(p.heading).toBe('Backstory');
    expect(p.time).toEqual({ kind: 'context' });
  });

  it('trims the heading and drops an empty heading', () => {
    expect(parseLinkInner('norman# Back story ').heading).toBe('Back story');
    expect(parseLinkInner('norman#').heading).toBeUndefined();
  });

  it('splits an alias at the first |', () => {
    const p = parseLinkInner('norman|the old man');
    expect(p.target).toBe('norman');
    expect(p.alias).toBe('the old man');
  });

  it('accepts the escaped pipe used inside markdown tables', () => {
    const p = parseLinkInner('norman\\|the old man');
    expect(p.target).toBe('norman');
    expect(p.alias).toBe('the old man');
  });

  it('trims the alias and treats an empty alias as absent', () => {
    expect(parseLinkInner('norman|  old  ').alias).toBe('old');
    expect(parseLinkInner('norman|   ').alias).toBeUndefined();
  });

  it('keeps @ and # characters inside the alias', () => {
    const p = parseLinkInner('norman|a@b#c');
    expect(p.alias).toBe('a@b#c');
    expect(p.time).toEqual({ kind: 'context' });
    expect(p.heading).toBeUndefined();
  });

  it('parses @latest case-insensitively', () => {
    for (const s of ['norman@latest', 'norman@LATEST', 'norman@ Latest ']) {
      const p = parseLinkInner(s);
      expect(p.target).toBe('norman');
      expect(p.time).toEqual({ kind: 'latest' });
      expect(p.timeRaw).toBe(s.split('@')[1].trim());
    }
  });

  it('parses @Scene Title as an at-edge scene reference', () => {
    const p = parseLinkInner('norman@The Siege');
    expect(p.time).toEqual({ kind: 'scene', scene: 'The Siege', edge: 'at' });
    expect(p.timeRaw).toBe('The Siege');
  });

  it('parses @before: and @after: edges', () => {
    expect(parseLinkInner('norman@before:The Siege').time).toEqual({
      kind: 'scene',
      scene: 'The Siege',
      edge: 'before',
    });
    expect(parseLinkInner('norman@after:The Siege').time).toEqual({
      kind: 'scene',
      scene: 'The Siege',
      edge: 'after',
    });
    expect(parseLinkInner('norman@BEFORE: The Siege').time).toEqual({
      kind: 'scene',
      scene: 'The Siege',
      edge: 'before',
    });
  });

  it('keeps timeRaw as the trimmed text after @', () => {
    expect(parseLinkInner('norman@before:The Siege').timeRaw).toBe('before:The Siege');
    expect(parseLinkInner('norman@  The Siege  ').timeRaw).toBe('The Siege');
  });

  it('treats an empty @ part as no time part', () => {
    const p = parseLinkInner('norman@');
    expect(p.time).toEqual({ kind: 'context' });
    expect(p.timeRaw).toBeUndefined();
  });

  it('handles heading, time and alias together', () => {
    const p = parseLinkInner('norman#Bio@latest|Old man');
    expect(p).toEqual({
      target: 'norman',
      heading: 'Bio',
      alias: 'Old man',
      time: { kind: 'latest' },
      timeRaw: 'latest',
    });
  });

  it('handles a scene time with an alias and a heading', () => {
    const p = parseLinkInner('norman#Bio@before:The Siege|the old man');
    expect(p.target).toBe('norman');
    expect(p.heading).toBe('Bio');
    expect(p.time).toEqual({ kind: 'scene', scene: 'The Siege', edge: 'before' });
    expect(p.alias).toBe('the old man');
  });

  it('returns an empty target when nothing precedes the parts', () => {
    expect(parseLinkInner('|alias').target).toBe('');
    expect(parseLinkInner('@latest').target).toBe('');
    expect(parseLinkInner('#Heading').target).toBe('');
  });
});

// ---------------------------------------------------------------------------
// parseLinks
// ---------------------------------------------------------------------------

describe('parseLinks', () => {
  it('finds a simple link with correct offsets', () => {
    const text = 'See [[norman]] now.';
    const links = parseLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      raw: '[[norman]]',
      start: 4,
      end: 14,
      embed: false,
      target: 'norman',
      time: { kind: 'context' },
    });
    expect(text.slice(links[0].start, links[0].end)).toBe(links[0].raw);
  });

  it('parses an embed including the leading !', () => {
    const links = parseLinks('![[norman#Bio@latest|Old man]]');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      raw: '![[norman#Bio@latest|Old man]]',
      start: 0,
      end: 30,
      embed: true,
      target: 'norman',
      heading: 'Bio',
      alias: 'Old man',
      time: { kind: 'latest' },
      timeRaw: 'latest',
    });
  });

  it('does not treat a plain image as an embed', () => {
    const links = parseLinks('![alt](img.png) [[a]]');
    expect(links).toHaveLength(1);
    expect(links[0].embed).toBe(false);
    expect(links[0].target).toBe('a');
  });

  it('finds several links on one line', () => {
    const links = parseLinks('[[a]] and [[b@latest]] and ![[c|C]]');
    expect(links.map((l) => l.target)).toEqual(['a', 'b', 'c']);
    expect(links[2].embed).toBe(true);
  });

  it('skips empty targets', () => {
    expect(parseLinks('[[]] [[|x]] [[ ]] [[#Heading]]')).toEqual([]);
  });

  it('closes at the first ]]', () => {
    const links = parseLinks('[[a]]]');
    expect(links).toHaveLength(1);
    expect(links[0].raw).toBe('[[a]]');
  });

  it('does not match across a newline', () => {
    expect(parseLinks('[[a\nb]]')).toEqual([]);
  });

  it('parses the escaped pipe as an alias separator', () => {
    const links = parseLinks('[[norman\\|the old man]]');
    expect(links[0].target).toBe('norman');
    expect(links[0].alias).toBe('the old man');
    expect(links[0].raw).toBe('[[norman\\|the old man]]');
  });

  it('parses non-ASCII targets', () => {
    const links = parseLinks('[[Ñandú Café|el pájaro]]');
    expect(links[0].target).toBe('Ñandú Café');
    expect(links[0].alias).toBe('el pájaro');
  });

  it('ignores links inside inline code spans', () => {
    const links = parseLinks('`[[norman]]` and [[mira]]');
    expect(links.map((l) => l.target)).toEqual(['mira']);
  });

  it('ignores links inside double-backtick code spans', () => {
    expect(parseLinks('``[[a]] and ` tick``  [[b]]').map((l) => l.target)).toEqual(['b']);
  });

  it('ignores links inside fenced code blocks', () => {
    const text = '```\n[[norman]]\n```\n[[mira]]';
    expect(parseLinks(text).map((l) => l.target)).toEqual(['mira']);
  });

  it('ignores links inside tilde-fenced code blocks', () => {
    const text = '~~~ts\nconst x = "[[norman]]";\n~~~\n[[mira]]';
    expect(parseLinks(text).map((l) => l.target)).toEqual(['mira']);
  });

  it('treats an unclosed fence as running to the end of the text', () => {
    expect(parseLinks('```\n[[a]]\nmore')).toEqual([]);
  });

  it('does not let a code span cross a blank line', () => {
    const text = '`open\n\n[[x]]` text';
    expect(parseLinks(text).map((l) => l.target)).toEqual(['x']);
  });

  it('does not let a code span hide a link after it is closed on the same paragraph', () => {
    const text = '`a\n[[x]]`';
    expect(parseLinks(text)).toEqual([]);
  });

  it('keeps a link that is inside a code block fence of a different length', () => {
    const text = '````\n```\n[[hidden]]\n````\n[[shown]]';
    expect(parseLinks(text).map((l) => l.target)).toEqual(['shown']);
  });

  it('ignores a backtick escaped with a backslash when detecting code spans', () => {
    const text = '\\`[[a]]`';
    // The escaped backtick is literal, so the trailing backtick opens nothing and [[a]] is a link.
    expect(parseLinks(text).map((l) => l.target)).toEqual(['a']);
  });
});

// ---------------------------------------------------------------------------
// formatLink (round trip)
// ---------------------------------------------------------------------------

describe('formatLink', () => {
  it('builds the link text from parts', () => {
    expect(
      formatLink({ target: 'norman', heading: 'Bio', timeRaw: 'latest', alias: 'Old man', embed: true }),
    ).toBe('![[norman#Bio@latest|Old man]]');
    expect(formatLink({ target: 'norman' })).toBe('[[norman]]');
    expect(formatLink({ target: 'norman', timeRaw: 'before:The Siege' })).toBe('[[norman@before:The Siege]]');
  });

  it('round-trips through parseLinks', () => {
    const samples = [
      '[[norman]]',
      '[[norman#Backstory]]',
      '[[norman|the old man]]',
      '[[norman\\|the old man]]',
      '[[norman@latest]]',
      '[[norman@The Siege]]',
      '[[norman@before:The Siege]]',
      '[[norman@after:The Siege]]',
      '![[norman#Bio@latest|Old man]]',
      '![[alice-bob@after:The Betrayal]]',
    ];
    for (const sample of samples) {
      const [parsed] = parseLinks(sample);
      expect(parsed, sample).toBeDefined();
      const rebuilt = formatLink({
        target: parsed.target,
        heading: parsed.heading,
        alias: parsed.alias,
        timeRaw: parsed.timeRaw,
        embed: parsed.embed,
      });
      const [again] = parseLinks(rebuilt);
      expect(again.target, sample).toBe(parsed.target);
      expect(again.heading, sample).toBe(parsed.heading);
      expect(again.alias, sample).toBe(parsed.alias);
      expect(again.timeRaw, sample).toBe(parsed.timeRaw);
      expect(again.embed, sample).toBe(parsed.embed);
      expect(again.time, sample).toEqual(parsed.time);
    }
  });
});

// ---------------------------------------------------------------------------
// findEntity / findScene
// ---------------------------------------------------------------------------

describe('findEntity', () => {
  const vault = vaultOf({
    entities: [
      entity('ent_mira', 'Mira'),
      entity('ent_norman', 'Norman', { aliases: ['the old man', 'bob'] }),
      entity('ent_bob', 'Bob'),
    ],
  });

  it('matches by slugified name, case and spacing insensitively', () => {
    expect(findEntity(vault, 'norman')?.id).toBe('ent_norman');
    expect(findEntity(vault, 'NORMAN')?.id).toBe('ent_norman');
    expect(findEntity(vault, '  Mira ')?.id).toBe('ent_mira');
  });

  it('matches a multi-word name through its slug', () => {
    const v = vaultOf({ entities: [entity('e1', 'Sword of Ash')] });
    expect(findEntity(v, 'sword-of-ash')?.id).toBe('e1');
    expect(findEntity(v, 'Sword Of Ash')?.id).toBe('e1');
  });

  it('matches aliases', () => {
    expect(findEntity(vault, 'the-old-man')?.id).toBe('ent_norman');
  });

  it('prefers an exact name match over an alias match', () => {
    // ent_norman has alias "bob", but ent_bob is named "Bob": the name wins even though
    // ent_norman comes first in the record.
    expect(findEntity(vault, 'bob')?.id).toBe('ent_bob');
  });

  it('returns undefined for unknown or empty targets', () => {
    expect(findEntity(vault, 'ghost')).toBeUndefined();
    expect(findEntity(vault, '   ')).toBeUndefined();
  });
});

describe('findScene', () => {
  const vault = vaultOf({
    scenes: [scene('sc_siege', 'The Siege', 'm1'), scene('sc_fall', 'The Fall of Ashford', 'm2')],
  });

  it('matches scenes by slugified title', () => {
    expect(findScene(vault, 'The Siege')?.id).toBe('sc_siege');
    expect(findScene(vault, 'the-siege')?.id).toBe('sc_siege');
    expect(findScene(vault, 'the fall of ashford')?.id).toBe('sc_fall');
  });

  it('returns undefined when nothing matches', () => {
    expect(findScene(vault, 'Nope')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveLinkTime
// ---------------------------------------------------------------------------

describe('resolveLinkTime', () => {
  const vault = vaultOf({
    moments: [moment('m_siege'), moment('m_fall')],
    scenes: [
      scene('sc_siege', 'The Siege', 'm_siege'),
      scene('sc_fall', 'The Fall of Ashford', 'm_fall'),
    ],
  });

  it('context: uses the moment of the containing scene', () => {
    expect(resolveLinkTime(vault, { kind: 'context' }, 'sc_fall')).toEqual({
      kind: 'moment',
      momentId: 'm_fall',
    });
  });

  it('context: falls back to latest without a scene, or with an unknown scene id', () => {
    expect(resolveLinkTime(vault, { kind: 'context' })).toEqual({ kind: 'latest' });
    expect(resolveLinkTime(vault, { kind: 'context' }, 'sc_missing')).toEqual({ kind: 'latest' });
  });

  it('latest: always latest', () => {
    expect(resolveLinkTime(vault, { kind: 'latest' }, 'sc_fall')).toEqual({ kind: 'latest' });
  });

  it('scene at: the moment of that scene', () => {
    const t: LinkTime = { kind: 'scene', scene: 'The Siege', edge: 'at' };
    expect(resolveLinkTime(vault, t)).toEqual({ kind: 'moment', momentId: 'm_siege' });
  });

  it('scene before: the same moment (state strictly before it)', () => {
    const t: LinkTime = { kind: 'scene', scene: 'The Siege', edge: 'before' };
    expect(resolveLinkTime(vault, t)).toEqual({ kind: 'moment', momentId: 'm_siege' });
  });

  it('scene after: the moment plus that scene\'s own changes', () => {
    const t: LinkTime = { kind: 'scene', scene: 'The Siege', edge: 'after' };
    expect(resolveLinkTime(vault, t)).toEqual({
      kind: 'moment',
      momentId: 'm_siege',
      includeSceneId: 'sc_siege',
    });
  });

  it('matches the scene title by slug', () => {
    const t: LinkTime = { kind: 'scene', scene: 'the-fall-of-ashford', edge: 'at' };
    expect(resolveLinkTime(vault, t)).toEqual({ kind: 'moment', momentId: 'm_fall' });
  });

  it('returns null for an unknown scene title', () => {
    expect(resolveLinkTime(vault, { kind: 'scene', scene: 'Nowhere', edge: 'at' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// renameEntity
// ---------------------------------------------------------------------------

describe('renameEntity', () => {
  function buildVault(): Vault {
    const norman = entity('ent_norman', 'Norman', {
      aliases: ['the old man'],
      note:
        '[[norman|the old man]] and [[Norman#Backstory]] and ![[norman@before:The Siege]] ' +
        'and [[mira]] and [[the old man]] and `[[norman]]` and [[norman@latest]]',
    });
    const mira = entity('ent_mira', 'Mira', {
      note: 'Friend of [[Norman]].',
      props: {
        friend: { kind: 'link', target: 'norman' },
        allies: [
          { kind: 'link', target: 'norman' },
          { kind: 'link', target: 'mira' },
        ],
        age: 30,
      },
    });
    const ashford = entity('ent_ashford', 'Ashford', {
      note: 'A place.',
      props: { state: 'ruined' },
    });
    const siege = scene('sc_siege', 'The Siege', 'm1', {
      prose: 'Norman [[norman@latest]] and `[[norman]]` and [[norman|old]].',
    });
    const changes: StateChange[] = [
      {
        id: 'chg_1',
        sceneId: 'sc_siege',
        entityId: 'ent_mira',
        op: 'set',
        property: 'owner',
        value: { kind: 'link', target: 'norman' },
        order: 0,
      },
      {
        id: 'chg_2',
        sceneId: 'sc_siege',
        entityId: 'ent_mira',
        op: 'add',
        property: 'allies',
        value: [{ kind: 'link', target: 'norman' }],
        order: 1,
      },
      { id: 'chg_3', sceneId: 'sc_siege', entityId: 'ent_mira', op: 'set', property: 'mood', value: 'calm', order: 2 },
    ];
    return vaultOf({ entities: [norman, mira, ashford], scenes: [siege], changes });
  }

  it('renames the entity and keeps the aliases', () => {
    const next = renameEntity(buildVault(), 'ent_norman', 'Nolan');
    expect(next.entities.ent_norman.name).toBe('Nolan');
    expect(next.entities.ent_norman.aliases).toEqual(['the old man']);
  });

  it('rewrites target text in entity notes, keeping alias, heading, time and embed', () => {
    const next = renameEntity(buildVault(), 'ent_norman', 'Nolan');
    expect(next.entities.ent_norman.note).toBe(
      '[[Nolan|the old man]] and [[Nolan#Backstory]] and ![[Nolan@before:The Siege]] ' +
        'and [[mira]] and [[the old man]] and `[[norman]]` and [[Nolan@latest]]',
    );
  });

  it('rewrites links in other entity notes, matching by slug', () => {
    const next = renameEntity(buildVault(), 'ent_norman', 'Nolan');
    expect(next.entities.ent_mira.note).toBe('Friend of [[Nolan]].');
  });

  it('rewrites links in scene prose, leaving code untouched', () => {
    const next = renameEntity(buildVault(), 'ent_norman', 'Nolan');
    expect(next.scenes.sc_siege.prose).toBe(
      'Norman [[Nolan@latest]] and `[[norman]]` and [[Nolan|old]].',
    );
  });

  it('rewrites LinkValue props, including inside arrays', () => {
    const next = renameEntity(buildVault(), 'ent_norman', 'Nolan');
    expect(next.entities.ent_mira.props).toEqual({
      friend: { kind: 'link', target: 'Nolan' },
      allies: [
        { kind: 'link', target: 'Nolan' },
        { kind: 'link', target: 'mira' },
      ],
      age: 30,
    });
  });

  it('rewrites LinkValue values in state changes, including arrays', () => {
    const next = renameEntity(buildVault(), 'ent_norman', 'Nolan');
    expect(next.changes.chg_1.value).toEqual({ kind: 'link', target: 'Nolan' });
    expect(next.changes.chg_2.value).toEqual([{ kind: 'link', target: 'Nolan' }]);
    expect(next.changes.chg_3.value).toBe('calm');
  });

  it('does not mutate the input vault', () => {
    const vault = buildVault();
    const snapshot = JSON.stringify(vault);
    const next = renameEntity(vault, 'ent_norman', 'Nolan');
    expect(JSON.stringify(vault)).toBe(snapshot);
    expect(next).not.toBe(vault);
    expect(vault.entities.ent_norman.name).toBe('Norman');
  });

  it('shares unchanged records with the input', () => {
    const vault = buildVault();
    const next = renameEntity(vault, 'ent_norman', 'Nolan');
    expect(next.entities.ent_ashford).toBe(vault.entities.ent_ashford);
    expect(next.changes.chg_3).toBe(vault.changes.chg_3);
  });

  it('returns an equal vault for an unknown entity id', () => {
    const vault = buildVault();
    expect(renameEntity(vault, 'ent_missing', 'X')).toEqual(vault);
  });
});

// ---------------------------------------------------------------------------
// renameScene
// ---------------------------------------------------------------------------

describe('renameScene', () => {
  function buildVault(): Vault {
    const norman = entity('ent_norman', 'Norman', {
      note: 'Seen at [[norman@The Siege]] and [[norman@the-siege]] and [[The Siege]].',
    });
    const siege = scene('sc_siege', 'The Siege', 'm_siege', {
      prose:
        '[[norman@The Siege]] [[norman@before:The Siege]] [[norman@after:The Siege|x]] ' +
        '[[The Siege]] [[norman@latest]] [[ashford@The Siege]] [[norman@Other]]',
    });
    const aftermath = scene('sc_after', 'Aftermath', 'm_after', {
      prose: 'Later: [[norman#Bio@after:The Siege]].',
    });
    return vaultOf({
      entities: [norman],
      scenes: [siege, aftermath],
      moments: [moment('m_siege'), moment('m_after')],
    });
  }

  it('sets the new title', () => {
    const next = renameScene(buildVault(), 'sc_siege', 'The Battle');
    expect(next.scenes.sc_siege.title).toBe('The Battle');
    expect(next.scenes.sc_after.title).toBe('Aftermath');
  });

  it('rewrites @Old, @before:Old and @after:Old time parts in notes and prose', () => {
    const next = renameScene(buildVault(), 'sc_siege', 'The Battle');
    expect(next.scenes.sc_siege.prose).toBe(
      '[[norman@The Battle]] [[norman@before:The Battle]] [[norman@after:The Battle|x]] ' +
        '[[The Battle]] [[norman@latest]] [[ashford@The Battle]] [[norman@Other]]',
    );
    expect(next.scenes.sc_after.prose).toBe('Later: [[norman#Bio@after:The Battle]].');
    expect(next.entities.ent_norman.note).toBe(
      'Seen at [[norman@The Battle]] and [[norman@The Battle]] and [[The Battle]].',
    );
  });

  it('matches the time part by slug', () => {
    const vault = vaultOf({
      entities: [entity('e1', 'Norman', { note: '[[norman@the-siege]]' })],
      scenes: [scene('sc_siege', 'The Siege', 'm1')],
      moments: [moment('m1')],
    });
    const next = renameScene(vault, 'sc_siege', 'Battle');
    expect(next.entities.e1.note).toBe('[[norman@Battle]]');
  });

  it('does not rewrite a [[title]] link that resolves to an entity of that name', () => {
    const vault = vaultOf({
      entities: [entity('e_siege', 'The Siege', { note: '[[The Siege]]' })],
      scenes: [scene('sc_siege', 'The Siege', 'm1', { prose: '[[The Siege]] [[The Siege@at]]' })],
      moments: [moment('m1')],
    });
    const next = renameScene(vault, 'sc_siege', 'Battle');
    expect(next.entities.e_siege.note).toBe('[[The Siege]]');
    expect(next.scenes.sc_siege.prose).toBe('[[The Siege]] [[The Siege@at]]');
  });

  it('does not mutate the input vault', () => {
    const vault = buildVault();
    const snapshot = JSON.stringify(vault);
    renameScene(vault, 'sc_siege', 'The Battle');
    expect(JSON.stringify(vault)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// parseTags
// ---------------------------------------------------------------------------

describe('parseTags', () => {
  it('finds simple tags', () => {
    expect(parseTags('a #tag here')).toEqual(['tag']);
  });

  it('finds nested tags', () => {
    expect(parseTags('#tag/sub and #tag/sub/deeper')).toEqual(['tag/sub', 'tag/sub/deeper']);
  });

  it('allows dashes and underscores', () => {
    expect(parseTags('#tag-with_dash')).toEqual(['tag-with_dash']);
  });

  it('allows non-ASCII letters', () => {
    expect(parseTags('#日本語 #café')).toEqual(['日本語', 'café']);
  });

  it('returns unique tags in order of first appearance', () => {
    expect(parseTags('#b #a #b #c #a')).toEqual(['b', 'a', 'c']);
  });

  it('requires at least one non-digit character', () => {
    expect(parseTags('#123 #2024a')).toEqual(['2024a']);
  });

  it('is not triggered by markdown headings', () => {
    expect(parseTags('# Heading\n## Sub heading\n### x')).toEqual([]);
  });

  it('needs start of text or whitespace before the #', () => {
    expect(parseTags('a#b')).toEqual([]);
    expect(parseTags('(#paren)')).toEqual([]);
    expect(parseTags('#start')).toEqual(['start']);
  });

  it('recognises tags after a newline', () => {
    expect(parseTags('line one\n#tag')).toEqual(['tag']);
  });

  it('ignores # inside URLs', () => {
    expect(parseTags('see https://example.com/#frag')).toEqual([]);
  });

  it('ignores # inside inline code and fenced code', () => {
    expect(parseTags('`#nope` and #yes')).toEqual(['yes']);
    expect(parseTags('```\n#nope\n```\n#yes')).toEqual(['yes']);
  });

  it('ignores # inside wikilinks', () => {
    expect(parseTags('[[norman#Bio]] and #real')).toEqual(['real']);
  });

  it('drops a trailing slash', () => {
    expect(parseTags('#tag/ next')).toEqual(['tag']);
  });
});

// ---------------------------------------------------------------------------
// Author notes: links and tags inside notes do not exist for the parser
// ---------------------------------------------------------------------------

describe('parseLinks inside author notes', () => {
  it('ignores a link inside a %% note but keeps the one outside', () => {
    const text = 'see %% [[norman]] %% and [[norman]]';
    const links = parseLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].start).toBe(text.lastIndexOf('[[norman]]'));
  });

  it('ignores a link inside an HTML comment note', () => {
    expect(parseLinks('<!-- [[norman]] --> text')).toEqual([]);
  });

  it('ignores links in a note spanning several lines', () => {
    const text = 'a\n%% first line\n[[norman]] and [[the siege]]\n%%\nb [[norman]]';
    const links = parseLinks(text);
    expect(links.map((l) => l.target)).toEqual(['norman']);
    expect(links[0].start).toBe(text.lastIndexOf('[[norman]]'));
  });

  it('ignores an embed inside a note', () => {
    expect(parseLinks('%% ![[norman]] %%')).toEqual([]);
  });

  it('still parses a link when the note marker is unclosed', () => {
    expect(parseLinks('%% open [[norman]]')).toHaveLength(1);
  });

  it('keeps a `%%` inside code from starting a note', () => {
    const text = 'use `%%` here [[norman]] %% real %%';
    const links = parseLinks(text);
    expect(links.map((l) => l.target)).toEqual(['norman']);
  });

  it('keeps code literal: a link in a fenced block is not parsed, a link after a note is', () => {
    const text = '```\n[[norman]]\n```\n%% note %%\n[[norman]]';
    const links = parseLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].start).toBe(text.lastIndexOf('[[norman]]'));
  });
});

describe('parseTags inside author notes', () => {
  it('ignores tags in %% and HTML notes', () => {
    expect(parseTags('#real %% #hidden %% <!-- #also --> #more')).toEqual(['real', 'more']);
  });

  it('ignores tags in a multi-line note', () => {
    expect(parseTags('text\n%%\n#hidden\n%%\n#shown')).toEqual(['shown']);
  });

  it('keeps tags when the note marker is unclosed', () => {
    expect(parseTags('%% open #tag')).toEqual(['tag']);
  });
});

describe('findAuthorNotesOutsideCode', () => {
  it('returns notes with positions into the original text and trimmed text', () => {
    const text = 'a %%  spaced  %% b <!-- html -->';
    const notes = findAuthorNotesOutsideCode(text);
    expect(notes.map((n) => n.text)).toEqual(['spaced', 'html']);
    expect(text.slice(notes[0].start, notes[0].end)).toBe('%%  spaced  %%');
    expect(text.slice(notes[1].start, notes[1].end)).toBe('<!-- html -->');
  });

  it('skips markers inside inline code', () => {
    const notes = findAuthorNotesOutsideCode('x `%%` [[a]] %% note %%');
    expect(notes.map((n) => n.text)).toEqual(['note']);
  });

  it('skips markers inside fenced code blocks', () => {
    const notes = findAuthorNotesOutsideCode('```\n<!-- code -->\n```\n%% real %%');
    expect(notes.map((n) => n.text)).toEqual(['real']);
  });

  it('returns nothing for text without markers', () => {
    expect(findAuthorNotesOutsideCode('plain text')).toEqual([]);
  });

  it('finds // notes outside code, and ignores // inside code spans and fences', () => {
    const notes = findAuthorNotesOutsideCode('`// x`\n// real\n```\n// code\n```');
    expect(notes.map((n) => [n.text, n.syntax])).toEqual([['real', 'line']]);
  });

  it('does not treat the // of a URL as a note', () => {
    expect(findAuthorNotesOutsideCode('see https://example.com [[a]]')).toEqual([]);
  });
});

describe('// notes and mentions', () => {
  it('does not count a link or a tag written in a // note', () => {
    const text = 'Met [[Norman]] there. // see [[Dawn]] #hidden';
    expect(parseLinks(text).map((l) => l.target)).toEqual(['Norman']);
    expect(parseTags(text)).toEqual([]);
  });
});

describe('findEntity: the index agrees with a plain scan', () => {
  // The scan the index replaced: names first, then aliases, then names a revision gives the entity later.
  function scan(vault: Vault, target: string): Entity | undefined {
    const slug = slugify(target);
    if (slug === '') return undefined;
    const entities = Object.values(vault.entities);
    const byName = entities.find((e) => slugify(e.name) === slug);
    if (byName) return byName;
    const byAlias = entities.find((e) => e.aliases.some((a) => slugify(a) === slug));
    if (byAlias) return byAlias;
    for (const c of Object.values(vault.changes)) {
      if (c.op === 'revise' && c.rename !== undefined && slugify(c.rename) === slug && vault.entities[c.entityId]) return vault.entities[c.entityId];
    }
    return undefined;
  }

  it('gives the same entity for names, aliases, past names, collisions and junk', () => {
    const v = emptyVault();
    // Two entities share a name, one entity's alias is another's name, a rename collides with a third's alias.
    for (const e of [
      entity('a', 'Mira'),
      entity('b', 'Mira'),
      entity('c', 'Strider', { aliases: ['ranger', 'Mira'] }),
      entity('d', 'Elf', { aliases: ['Aragorn'] }),
      entity('e', 'Éowyn'),
      entity('f', '王明'),
    ]) {
      v.entities[e.id] = e;
    }
    v.changes.r1 = { id: 'r1', entityId: 'c', op: 'revise', rename: 'Aragorn', sceneId: 's', order: 0 };
    v.changes.r2 = { id: 'r2', entityId: 'a', op: 'revise', rename: 'Queen', sceneId: 's', order: 1 };
    v.changes.r3 = { id: 'r3', entityId: 'gone', op: 'revise', rename: 'Ghost', sceneId: 's', order: 2 };
    for (const target of ['Mira', 'mira', ' MIRA ', 'Strider', 'ranger', 'Aragorn', 'Queen', 'Ghost', 'Éowyn', 'éowyn', '王明', 'Nobody', '', '   ', '???']) {
      expect(findEntity(v, target)?.id, target).toBe(scan(v, target)?.id);
    }
  });

  it('sees an entity renamed by replacing the entities, and a new revision rename by replacing the changes', () => {
    const v = emptyVault();
    v.entities.a = entity('a', 'Mira');
    expect(findEntity(v, 'Mira')?.id).toBe('a');
    expect(findEntity(v, 'Queen')).toBeUndefined();

    const renamed: Vault = { ...v, entities: { a: { ...v.entities.a, name: 'Queen' } } };
    expect(findEntity(renamed, 'Queen')?.id).toBe('a');
    expect(findEntity(renamed, 'Mira')).toBeUndefined();

    const revised: Vault = { ...v, changes: { r: { id: 'r', entityId: 'a', op: 'revise', rename: 'Empress', sceneId: 's', order: 0 } } };
    expect(findEntity(revised, 'Empress')?.id).toBe('a');
    expect(findEntity(v, 'Empress')).toBeUndefined();
  });
});
