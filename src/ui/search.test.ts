import { describe, expect, it } from 'vitest';
import { emptyVault, type Entity, type Scene, type Vault } from '../core/types';
import { allTags, fullTextSearch, fuzzyScore, itemsWithTag, splitMatches } from './search';

function entity(id: string, name: string, note = '', aliases: string[] = []): Entity {
  return { id, typeId: 't', name, aliases, note, props: {} };
}

function scene(id: string, title: string, prose = ''): Scene {
  return { id, storyId: 's', chapterId: null, title, prose, momentId: `m_${id}`, order: 0 };
}

function vaultOf(entities: Entity[], scenes: Scene[]): Vault {
  const v = emptyVault();
  v.entityTypes.t = { id: 't', name: 'Character', color: '#000000', icon: '', defaultProps: {} };
  v.stories.s = { id: 's', name: 'Main story', color: '#000000', order: 0 };
  for (const e of entities) v.entities[e.id] = e;
  for (const s of scenes) v.scenes[s.id] = s;
  return v;
}

/** Score with a sentinel for "no match", so comparisons stay simple. */
function score(query: string, text: string): number {
  return fuzzyScore(query, text) ?? -Infinity;
}

describe('fuzzyScore', () => {
  it('returns null when characters are missing or out of order', () => {
    expect(fuzzyScore('xyz', 'Norman')).toBeNull();
    expect(fuzzyScore('mn', 'nm')).toBeNull();
  });

  it('matches case-insensitively as a subsequence', () => {
    expect(fuzzyScore('NRM', 'norman')).not.toBeNull();
  });

  it('treats an empty query as a match for everything', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
    expect(fuzzyScore('   ', 'anything')).toBe(0);
  });

  it('prefers prefix and word-start matches over matches buried inside a word', () => {
    expect(score('nor', 'Norman')).toBeGreaterThan(score('nor', 'Ashnorman'));
    expect(score('ash', 'Ash Lake')).toBeGreaterThan(score('ash', 'Trash'));
  });

  it('prefers contiguous runs over scattered letters', () => {
    expect(score('ab', 'abx')).toBeGreaterThan(score('ab', 'a_x_b'));
  });
});

describe('fullTextSearch', () => {
  it('finds entities by note text and scenes by prose, case-insensitively', () => {
    const v = vaultOf(
      [entity('norman', 'Norman', 'He is a Brave man.')],
      [scene('sc1', 'The Ride', 'The horse Gallops past.')],
    );

    const byNote = fullTextSearch(v, 'brave');
    expect(byNote).toHaveLength(1);
    expect(byNote[0]).toMatchObject({ kind: 'entity', id: 'norman' });

    const byProse = fullTextSearch(v, 'GALLOPS');
    expect(byProse).toHaveLength(1);
    expect(byProse[0]).toMatchObject({ kind: 'scene', id: 'sc1' });
  });

  it('ranks name matches above note matches', () => {
    const v = vaultOf(
      [entity('bob', 'Bob', 'Mira is his friend.'), entity('mira', 'Mira', '')],
      [],
    );
    const hits = fullTextSearch(v, 'mira');
    expect(hits.map((h) => h.id)).toEqual(['mira', 'bob']);
  });

  it('reports the match offset and a snippet around it', () => {
    const note = `${'x'.repeat(100)}NEEDLE${'y'.repeat(100)}`;
    const [hit] = fullTextSearch(vaultOf([entity('e', 'E', note)], []), 'needle');
    expect(hit.index).toBe(100);
    expect(hit.snippet).toContain('NEEDLE');
    expect(hit.snippet.startsWith('…')).toBe(true);
    expect(hit.snippet.endsWith('…')).toBe(true);
    expect(hit.snippet.length).toBeLessThanOrEqual(82);
  });

  it('respects the limit and returns nothing for a blank query', () => {
    const scenes = Array.from({ length: 5 }, (_, i) => scene(`sc${i}`, `Scene ${i}`, 'foo'));
    const v = vaultOf([], scenes);
    expect(fullTextSearch(v, 'foo', 2)).toHaveLength(2);
    expect(fullTextSearch(v, '   ')).toEqual([]);
  });
});

describe('allTags', () => {
  it('counts the items using each tag and sorts by tag', () => {
    const v = vaultOf(
      [entity('norman', 'Norman', '#magic and #fire')],
      [scene('sc1', 'One', '#magic #fire/water'), scene('sc2', 'Two', '#magic')],
    );
    expect(allTags(v)).toEqual([
      { tag: 'fire', count: 1 },
      { tag: 'fire/water', count: 1 },
      { tag: 'magic', count: 3 },
    ]);
  });
});

describe('itemsWithTag', () => {
  it('includes sub-tags and ignores partial tag names', () => {
    const v = vaultOf(
      [entity('norman', 'Norman', '#magic'), entity('mira', 'Mira', '#magic/fire')],
      [scene('sc1', 'Ride', '#magicfire'), scene('sc2', 'Ice', '#magic/fire/ice')],
    );
    const ids = itemsWithTag(v, 'magic').map((i) => i.id).sort();
    expect(ids).toEqual(['mira', 'norman', 'sc2']);
  });

  it('accepts a leading # and returns nothing for a partial tag', () => {
    const v = vaultOf([entity('norman', 'Norman', '#magic')], []);
    expect(itemsWithTag(v, '#magic').map((i) => i.id)).toEqual(['norman']);
    expect(itemsWithTag(v, 'mag')).toEqual([]);
  });
});

describe('splitMatches', () => {
  it('splits text around case-insensitive matches', () => {
    expect(splitMatches('The Old Man', 'old')).toEqual([
      { text: 'The ', match: false },
      { text: 'Old', match: true },
      { text: ' Man', match: false },
    ]);
  });

  it('returns the whole text unmarked for a blank query', () => {
    expect(splitMatches('Plain', '  ')).toEqual([{ text: 'Plain', match: false }]);
  });
});
