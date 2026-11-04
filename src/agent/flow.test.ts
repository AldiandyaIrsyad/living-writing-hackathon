import { describe, expect, it } from 'vitest';
import { VaultBuilder } from '../core/testkit';
import type { Vault } from '../core/types';
import { flowContext, isStale, outline, parseFlow, proseFingerprint, thinOutline, type FlowReading } from './flow';

/** Two arcs, three chapters, scenes told in the order given. */
function story(): Vault {
  const v = new VaultBuilder().scene('opening').scene('market').scene('betrayal').scene('fire').scene('ashes').chain('opening', 'market', 'betrayal', 'fire', 'ashes').build();
  v.arcs.a1 = { id: 'a1', storyId: 's', title: 'Embers', order: 0 };
  v.arcs.a2 = { id: 'a2', storyId: 's', title: 'Ash', order: 1 };
  v.chapters.c1 = { id: 'c1', storyId: 's', title: 'Arrival', order: 0, arcId: 'a1' };
  v.chapters.c2 = { id: 'c2', storyId: 's', title: 'Knives', order: 1, arcId: 'a1' };
  v.chapters.c3 = { id: 'c3', storyId: 's', title: 'After', order: 2, arcId: 'a2' };
  const place: Record<string, string> = { opening: 'c1', market: 'c1', betrayal: 'c2', fire: 'c3', ashes: 'c3' };
  for (const [id, ch] of Object.entries(place)) Object.assign(v.scenes[id], { chapterId: ch, prose: `${id} prose.` });
  return v;
}

const sceneLines = (text: string) => text.split('\n').filter((l) => /^\s+\d+\.\d\d /.test(l));

describe('the outline the model reads', () => {
  it('lists every scene in reading order under its arc and chapter, and marks the scene being read', () => {
    const lines = outline(story(), 'betrayal').split('\n');
    const at = (needle: string) => lines.findIndex((l) => l.includes(needle));
    expect(sceneLines(lines.join('\n')).map((l) => /"(.*?)"/.exec(l)![1])).toEqual(['opening', 'market', 'betrayal', 'fire', 'ashes']);
    expect(at('Arc 1 of 2: Embers')).toBeLessThan(at('Chapter 2 of 3: Knives'));
    expect(at('Chapter 2 of 3: Knives')).toBeLessThan(at('"betrayal"'));
    expect(at('Arc 2 of 2: Ash')).toBeLessThan(at('"fire"'));
    expect(lines.filter((l) => l.includes('<-- THIS SCENE'))).toEqual([expect.stringContaining('2.01 "betrayal"')]);
    expect(lines[0]).toContain('this scene is 3 of 5 in reading order');
  });

  it('marks a scene told out of order as happening before scenes told earlier, and no other', () => {
    // "memory" is told last but happens first.
    const v = new VaultBuilder().scene('a').scene('b').scene('memory').chain('memory', 'a', 'b').build();
    const marked = outline(v, 'a')
      .split('\n')
      .filter((l) => l.includes('told out of order'));
    expect(marked).toEqual([expect.stringContaining('"memory"')]);
  });

  it('gives a scene with no synopsis its opening words, so an unsummarised story still has a shape', () => {
    const v = story();
    v.scenes.market.synopsis = 'Mara buys a knife.';
    const lines = outline(v, 'betrayal').split('\n');
    expect(lines.find((l) => l.includes('"market"'))).toContain(': Mara buys a knife.');
    expect(lines.find((l) => l.includes('"fire"'))).toContain('opens: "fire prose."');
    // The scene being read is given whole further down, not twice.
    expect(lines.find((l) => l.includes('"betrayal"'))).not.toContain('opens:');
  });

  it('keeps scenes that are in no chapter, so a story without chapters still has an outline', () => {
    const v = new VaultBuilder().scene('a').scene('b').chain('a', 'b').build();
    expect(outline(v, 'b')).toContain('s2 "b"');
  });
});

describe('characters’ states in the flow reading', () => {
  /** Mara starts grieving in "funeral"; "childhood" is a flashback told after it, set before it. */
  function grief(): Vault {
    const v = new VaultBuilder().entity('mara', {}, 'Mara').scene('funeral').scene('childhood').scene('market').chain('childhood', 'funeral', 'market').change('funeral', 'mara', 'state', 'grieving her brother').build();
    v.scenes.funeral.prose = 'Mara stood by the grave.';
    v.scenes.childhood.prose = 'Young Mara laughed in the orchard.';
    v.scenes.market.prose = 'Mara joked with the fishmonger.';
    return v;
  }

  it('shows the state a character is in as the scene begins', () => {
    expect(flowContext(grief(), 'market')).toContain('- Mara: grieving her brother');
  });

  it('shows a flashback the state as it stood at its own moment, not the latest one', () => {
    expect(flowContext(grief(), 'childhood')).not.toContain('grieving');
  });

  it('does not show the state the scene itself sets', () => {
    expect(flowContext(grief(), 'funeral')).not.toContain('grieving');
  });
});

describe('a thin outline', () => {
  it('is fewer than three scenes with text or a synopsis', () => {
    const v = new VaultBuilder().scene('a').scene('b').scene('c').build();
    v.scenes.a.prose = 'Text.';
    v.scenes.b.prose = 'Text.';
    expect(thinOutline(v, 's')).toBe(true);
    v.scenes.c.synopsis = 'Planned: the fire.';
    expect(thinOutline(v, 's')).toBe(false);
  });
});

describe('reading the model’s reply', () => {
  it('finds the JSON inside a fenced reply, settles the role and drops mood checks that name no one', () => {
    const reply = 'Sure:\n```json\n{"position":"Middle of Arc I","role":"Turn","why":"After the market.","tone":"cold, quiet","shift":"Darker than before.","moodChecks":[{"entity":"Mara","state":"grieving","sceneQuote":"Mara joked","note":"She jokes while grieving."},{"note":"nobody"}]}\n```';
    expect(parseFlow(reply)).toEqual({
      position: 'Middle of Arc I',
      role: 'turn',
      why: 'After the market.',
      tone: 'cold, quiet',
      shift: 'Darker than before.',
      moodChecks: [{ entity: 'Mara', state: 'grieving', sceneQuote: 'Mara joked', note: 'She jokes while grieving.' }],
    });
  });

  it('reads a role it does not know as unclear', () => {
    expect(parseFlow('{"role":"inciting incident"}').role).toBe('unclear');
  });

  it('refuses a reply with no JSON in it', () => {
    expect(() => parseFlow('This scene is the turn of the story.')).toThrow();
  });
});

describe('an out-of-date reading', () => {
  it('is one of text the scene no longer has, even when only a word changed', () => {
    const v = story();
    const reading = { prose: proseFingerprint(v.scenes.fire.prose) } as FlowReading;
    expect(isStale(reading, v.scenes.fire)).toBe(false);
    expect(isStale(reading, { ...v.scenes.fire, prose: 'fire prose!' })).toBe(true);
  });
});
