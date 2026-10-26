import { describe, expect, it } from 'vitest';
import { createDemoVault } from '../core/seed';
import { emptyVault, type Vault } from '../core/types';
import { navItems, parseGoto, resolveGoto } from './goto';

const demo = createDemoVault();
const MAIN = 'story_main';
const MIRA = 'story_mira';

/** Demo vault with one scene removed, so a chapter has no scenes. */
function withoutScene(v: Vault, id: string): Vault {
  const scenes = { ...v.scenes };
  delete scenes[id];
  return { ...v, scenes };
}

describe('parseGoto', () => {
  it('reads chapter, scene-in-chapter, arc and scene-number forms', () => {
    expect(parseGoto(':5')).toEqual({ kind: 'chapter', n: 5 });
    expect(parseGoto(':5.2')).toEqual({ kind: 'scene', chapter: 5, n: 2 });
    expect(parseGoto(':a2')).toEqual({ kind: 'arc', n: 2 });
    expect(parseGoto(':A2')).toEqual({ kind: 'arc', n: 2 });
    expect(parseGoto(':s12')).toEqual({ kind: 'sceneNumber', n: 12 });
  });

  it('accepts > as the user may type it, but only for go-to forms', () => {
    expect(parseGoto('>5')).toEqual({ kind: 'chapter', n: 5 });
    expect(parseGoto('>a1')).toEqual({ kind: 'arc', n: 1 });
    expect(parseGoto('>new')).toBeNull();
    expect(parseGoto('>')).toBeNull();
  });

  it('ignores ordinary searches and surrounding spaces are fine', () => {
    expect(parseGoto('chapter 3')).toBeNull();
    expect(parseGoto('')).toBeNull();
    expect(parseGoto('  :3')).toEqual({ kind: 'chapter', n: 3 });
  });

  it('reports an empty or unreadable body', () => {
    expect(parseGoto(':')).toEqual({ kind: 'empty' });
    expect(parseGoto(': ')).toEqual({ kind: 'empty' });
    expect(parseGoto(':x')).toEqual({ kind: 'invalid', input: 'x' });
    expect(parseGoto(':5.')).toEqual({ kind: 'invalid', input: '5.' });
  });
});

describe('resolveGoto', () => {
  it(':3 opens the first scene of chapter 3', () => {
    const res = resolveGoto(demo, MAIN, ':3');
    expect(res.message).toBeUndefined();
    expect(res.targets).toHaveLength(1);
    expect(res.targets[0]).toMatchObject({ kind: 'chapter', number: 3, label: 'Chapter 3', sceneId: 'sc_3', storyId: MAIN });
  });

  it(':5.1 is the first scene of chapter 5', () => {
    const [t] = resolveGoto(demo, MAIN, ':5.1').targets;
    expect(t).toMatchObject({ kind: 'scene', sceneId: 'sc_5', label: 'The Fall of Ashford' });
  });

  it(':a2 opens the first scene of arc II (chapters 4 and 5)', () => {
    const [t] = resolveGoto(demo, MAIN, ':a2').targets;
    expect(t).toMatchObject({ kind: 'arc', number: 2, label: 'Arc II: Ash', sceneId: 'sc_4' });
  });

  it(':sN counts the scenes of one story in telling order', () => {
    // Mira's Road has two scenes, so :s2 is its second one and not a scene of the main story.
    const [t] = resolveGoto(demo, MIRA, ':s2').targets;
    expect(t).toMatchObject({ kind: 'scene', number: 2, sceneId: 'sc_m2' });
  });

  it('works on the first story when no story is current', () => {
    expect(resolveGoto(demo, null, ':1').targets[0]).toMatchObject({ sceneId: 'sc_1', storyId: MAIN });
    expect(resolveGoto(demo, 'story_gone', ':1').targets[0]).toMatchObject({ sceneId: 'sc_1', storyId: MAIN });
  });

  it('explains a chapter that does not exist', () => {
    const res = resolveGoto(demo, MAIN, ':9');
    expect(res.targets).toEqual([]);
    expect(res.message).toBe("Chapter 9 doesn't exist. The story has 5 chapters.");
  });

  it('explains a story with no chapters', () => {
    expect(resolveGoto(demo, MIRA, ':1').message).toBe("Chapter 1 doesn't exist. The story has no chapters yet.");
  });

  it('explains arcs and scenes that do not exist', () => {
    expect(resolveGoto(demo, MAIN, ':a3').message).toBe("Arc 3 doesn't exist. The story has 2 arcs.");
    expect(resolveGoto(demo, MAIN, ':s6').message).toBe("Scene 6 doesn't exist. The story has 5 scenes.");
    expect(resolveGoto(demo, MAIN, ':5.2').message).toBe("Scene 2 doesn't exist in chapter 5. It has 1 scene.");
  });

  it('explains an unreadable query', () => {
    expect(resolveGoto(demo, MAIN, ':x').message).toContain('Try :5');
  });

  it('says so when there are no stories', () => {
    expect(resolveGoto(emptyVault(), null, ':1').message).toBe('There are no stories yet.');
  });

  it('gives no targets for an empty or ordinary query', () => {
    expect(resolveGoto(demo, MAIN, ':')).toEqual({ targets: [] });
    expect(resolveGoto(demo, MAIN, 'betrayal')).toEqual({ targets: [] });
  });

  it('a chapter with no scenes has no scene to open', () => {
    const v = withoutScene(demo, 'sc_2');
    const [t] = resolveGoto(v, MAIN, ':2').targets;
    expect(t).toMatchObject({ kind: 'chapter', sceneId: null, meta: expect.stringContaining('no scenes yet') });
    expect(resolveGoto(v, MAIN, ':2.1').message).toBe('Chapter 2 has no scenes yet.');
  });
});

describe('navItems', () => {
  const items = navItems(demo);

  it('lists every chapter and arc across stories, with search texts', () => {
    const chapters = items.filter((t) => t.kind === 'chapter');
    const arcs = items.filter((t) => t.kind === 'arc');
    expect(chapters.map((t) => t.label)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4', 'Chapter 5']);
    expect(arcs.map((t) => t.label)).toEqual(['Arc I: Embers', 'Arc II: Ash']);
    expect(chapters[2].texts).toEqual(['Chapter 3']);
    expect(arcs[0].texts).toEqual(['Arc 1', 'Arc I: Embers']);
  });

  it('matches what :N and :aN would open', () => {
    expect(items.find((t) => t.kind === 'chapter' && t.number === 3)?.sceneId).toBe(resolveGoto(demo, MAIN, ':3').targets[0].sceneId);
    expect(items.find((t) => t.kind === 'arc' && t.number === 2)?.sceneId).toBe(resolveGoto(demo, MAIN, ':a2').targets[0].sceneId);
  });
});
