import { describe, expect, it } from 'vitest';
import { applyChapterPlan, chapterScenes, composeChapter, parseChapterText, reconcile, type Anchor, type DocScene } from './chapterDoc';
import { buildGraph } from './graph';
import { VaultBuilder } from './testkit';
import { layoutTimeline } from './timeline';
import type { Vault } from './types';

const doc = (...scenes: [id: string, title: string, prose: string][]): DocScene[] => scenes.map(([id, title, prose]) => ({ id, title, prose }));

/** Replace [from, to) with `insert` and move the anchors the way the editor does (an anchor sticks to the character after it). */
function edit(text: string, anchors: Anchor[], from: number, to: number, insert: string) {
  const next = text.slice(0, from) + insert + text.slice(to);
  const moved = anchors.map((a): Anchor => {
    if (a.pos === null || a.lead) return a; // the lead scene's anchor stays at the start
    if (a.pos >= to && (to > from || a.pos > from)) return { id: a.id, pos: a.pos - (to - from) + insert.length };
    if (to === from && a.pos === from) return { id: a.id, pos: a.pos + insert.length };
    if (a.pos < from) return a;
    return { id: a.id, pos: null };
  });
  return { text: next, anchors: moved };
}

/** A story of three scenes in one chapter, in a row on the timeline, with prose. */
function chapterVault(): Vault {
  const b = new VaultBuilder().scene('a').scene('b').scene('c').chain('a', 'b', 'c');
  b.v.chapters.ch = { id: 'ch', storyId: 's', title: 'Chapter', order: 0 };
  for (const [id, title, prose] of [['a', 'Arrival', 'Rain.'], ['b', 'The Stranger', 'A knock.'], ['c', 'Betrayal', 'Gone.']]) {
    b.v.scenes[id] = { ...b.v.scenes[id], chapterId: 'ch', title, prose };
  }
  return b.build();
}

const sceneDocs = (v: Vault) => chapterScenes(v, 'ch');

describe('chapter text', () => {
  it('composing then reconciling with untouched anchors changes nothing', () => {
    const scenes = doc(['a', 'Arrival', 'Rain on the roof.\n\nA second paragraph.'], ['b', 'Empty one', ''], ['c', 'Über', 'Ünï "quotes" and [[Norman]].']);
    const { text, anchors } = composeChapter(scenes);
    const plan = reconcile(text, scenes, anchors);
    expect(plan.merges).toEqual([]);
    expect(plan.sections).toEqual(scenes.map((s) => ({ id: s.id, title: s.title, prose: s.prose })));
  });

  it('only "# " headings outside code fences and author notes start a scene', () => {
    const text = '# One\n\n```\n# not a scene\n```\n\n%% # nor this\nstill a note %%\n\n#hashtag and ## sub\n\n# Two\n';
    expect(parseChapterText(text).map((s) => s.title)).toEqual(['One', 'Two']);
  });

  it('text above the first heading is an untitled first scene', () => {
    const sections = parseChapterText('Opening words.\n\n# First\n\nBody.');
    expect(sections.map((s) => [s.hasHeading, s.title, s.prose])).toEqual([
      [false, '', 'Opening words.'],
      [true, 'First', 'Body.'],
    ]);
  });
});

describe('reconcile', () => {
  it('a heading typed in the middle of a scene splits it: the old scene keeps the text above, a new scene gets the rest', () => {
    const scenes = doc(['a', 'Arrival', 'Rain. Then a knock.']);
    const { text, anchors } = composeChapter(scenes);
    const at = text.indexOf(' Then');
    const next = edit(text, anchors, at, at + 1, '\n\n# The knock\n\n');
    const plan = reconcile(next.text, scenes, next.anchors);
    expect(plan.sections).toEqual([
      { id: 'a', title: 'Arrival', prose: 'Rain.' },
      { id: null, title: 'The knock', prose: 'Then a knock.' },
    ]);
  });

  it('renaming a heading keeps the scene', () => {
    const scenes = doc(['a', 'Arrival', 'Rain.'], ['b', 'Knock', 'Door.']);
    const { text, anchors } = composeChapter(scenes);
    const at = text.indexOf('Knock');
    const next = edit(text, anchors, at, at + 5, 'The Stranger');
    expect(reconcile(next.text, scenes, next.anchors).sections.map((s) => [s.id, s.title])).toEqual([
      ['a', 'Arrival'],
      ['b', 'The Stranger'],
    ]);
  });

  it('deleting a heading merges the scene into the one above, its text included', () => {
    const scenes = doc(['a', 'Arrival', 'Rain.'], ['b', 'Knock', 'Door.']);
    const { text, anchors } = composeChapter(scenes);
    const from = text.indexOf('# Knock');
    const next = edit(text, anchors, from, from + '# Knock\n\n'.length, '');
    const plan = reconcile(next.text, scenes, next.anchors);
    expect(plan.merges).toEqual([{ from: 'b', into: 'a' }]);
    expect(plan.sections).toEqual([{ id: 'a', title: 'Arrival', prose: 'Rain.\n\nDoor.' }]);
  });

  it('a first scene that lost its heading merges into the next one; an emptied chapter keeps its first scene', () => {
    const scenes = doc(['a', 'Arrival', 'Rain.'], ['b', 'Knock', 'Door.']);
    const { text, anchors } = composeChapter(scenes);
    const dropFirst = edit(text, anchors, 0, text.indexOf('# Knock'), '');
    expect(reconcile(dropFirst.text, scenes, dropFirst.anchors).merges).toEqual([{ from: 'a', into: 'b' }]);

    const cleared = edit(text, anchors, 0, text.length, '');
    const plan = reconcile(cleared.text, scenes, cleared.anchors);
    expect(plan.sections).toEqual([{ id: 'a', title: 'Arrival', prose: '' }]);
    expect(plan.merges).toEqual([{ from: 'b', into: 'a' }]);
  });

  it('a lone scene whose heading was deleted lives on, untitled; an untitled first scene keeps the text that leads the document', () => {
    const lone = doc(['a', 'Arrival', 'Rain.']);
    const { text, anchors } = composeChapter(lone);
    const noHeading = edit(text, anchors, 0, text.indexOf('Rain.'), '');
    expect(reconcile(noHeading.text, lone, noHeading.anchors)).toEqual({ sections: [{ id: 'a', title: '', prose: 'Rain.' }], merges: [] });

    const untitled = doc(['a', '', 'Opening words.'], ['b', 'Knock', 'Door.']);
    const composed = composeChapter(untitled);
    expect(composed.text.startsWith('Opening words.')).toBe(true);
    const typed = edit(composed.text, composed.anchors, 0, 0, 'More. ');
    expect(reconcile(typed.text, untitled, typed.anchors).sections.map((s) => [s.id, s.prose])).toEqual([['a', 'More. Opening words.'], ['b', 'Door.']]);
  });

  it('when two anchors land on one heading, the scene named like it keeps it', () => {
    const scenes = doc(['a', 'Arrival', 'Rain.'], ['b', 'Knock', 'Door.']);
    const { text } = composeChapter(scenes);
    const at = text.indexOf('# Knock');
    const plan = reconcile(text.slice(at), scenes, [{ id: 'a', pos: 0 }, { id: 'b', pos: 0 }]);
    expect(plan.sections.map((s) => s.id)).toEqual(['b']);
    expect(plan.merges).toEqual([{ from: 'a', into: 'b' }]);
  });
});

describe('applyChapterPlan', () => {
  it('a new heading becomes a scene right after the one above it in time, in reading order', () => {
    const v = chapterVault();
    const { text, anchors } = composeChapter(sceneDocs(v));
    const at = text.indexOf('# The Stranger');
    const next = edit(text, anchors, at, at, '# Interlude\n\nWind.\n\n');
    const { vault, ids } = applyChapterPlan(v, 'ch', reconcile(next.text, sceneDocs(v), next.anchors));

    expect(sceneDocs(vault).map((s) => s.title)).toEqual(['Arrival', 'Interlude', 'The Stranger', 'Betrayal']);
    expect(sceneDocs(vault).map((s) => s.order)).toEqual([0, 1, 2, 3]);
    expect(ids).toHaveLength(4);
    const cols = Object.fromEntries(layoutTimeline(vault).cells.map((c) => [vault.scenes[c.sceneId].title, c.column]));
    expect(cols).toEqual({ Arrival: 0, Interlude: 1, 'The Stranger': 2, Betrayal: 3 });
    expect(v.scenes.a.title).toBe('Arrival'); // input untouched
    expect(Object.keys(v.scenes)).toHaveLength(3);
  });

  it('merging carries the scene\'s commits and cast to the scene above and closes the gap in time and reading order', () => {
    const b = new VaultBuilder().scene('a').scene('b').scene('c').chain('a', 'b', 'c').entity('norman', { status: 'alive' }).change('b', 'norman', 'status', 'dead');
    b.v.chapters.ch = { id: 'ch', storyId: 's', title: 'Chapter', order: 0 };
    for (const id of ['a', 'b', 'c']) b.v.scenes[id] = { ...b.v.scenes[id], chapterId: 'ch', title: id.toUpperCase(), prose: `${id} text` };
    b.v.scenes.b.cast = ['norman'];
    const v = b.build();
    const { text, anchors } = composeChapter(sceneDocs(v));
    const from = text.indexOf('# B');
    const next = edit(text, anchors, from, from + '# B\n\n'.length, '');
    const { vault } = applyChapterPlan(v, 'ch', reconcile(next.text, sceneDocs(v), next.anchors));

    expect(vault.scenes.b).toBeUndefined();
    expect(vault.scenes.a.prose).toBe('a text\n\nb text');
    expect(vault.scenes.a.cast).toEqual(['norman']);
    expect(Object.values(vault.changes).map((c) => [c.sceneId, c.property, c.value])).toEqual([['a', 'status', 'dead']]);
    expect(sceneDocs(vault).map((s) => [s.id, s.order])).toEqual([['a', 0], ['c', 1]]);
    const g = buildGraph(vault);
    expect(g.isBefore(vault.scenes.a.momentId, vault.scenes.c.momentId)).toBe(true);
  });

  it('renaming a heading renames the scene everywhere', () => {
    const v = chapterVault();
    v.scenes.c = { ...v.scenes.c, prose: 'See [[x@Arrival]].' };
    const { text, anchors } = composeChapter(sceneDocs(v));
    const at = text.indexOf('Arrival');
    const next = edit(text, anchors, at, at + 'Arrival'.length, 'The Arrival');
    const { vault, diverged } = applyChapterPlan(v, 'ch', reconcile(next.text, sceneDocs(v), next.anchors));
    expect(vault.scenes.a.title).toBe('The Arrival');
    expect(vault.scenes.c.prose).toBe('See [[x@The Arrival]].');
    // The editor still shows the old link in scene C, so it has to be told to reload the text.
    expect(diverged).toBe(true);
  });

  it('typing into an empty chapter creates its first scene', () => {
    const b = new VaultBuilder().scene('x');
    b.v.chapters.ch = { id: 'ch', storyId: 's', title: 'Empty', order: 0 };
    const plan = reconcile('# Opening\n\nOnce.', [], []);
    const { vault, ids } = applyChapterPlan(b.build(), 'ch', plan);
    expect(vault.scenes[ids[0]]).toMatchObject({ title: 'Opening', prose: 'Once.', chapterId: 'ch', storyId: 's' });
    expect(buildGraph(vault).isBefore(vault.scenes.x.momentId, vault.scenes[ids[0]].momentId)).toBe(true);
  });
});
