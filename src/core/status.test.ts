import { describe, expect, it } from 'vitest';
import { exportJSON, filesToVault, importJSON, vaultToFiles } from './exchange';
import { buildManuscript } from './manuscript';
import { chapterRollup, setSceneStatus } from './status';
import { VaultBuilder } from './testkit';

function chapterWith(statuses: (string | undefined)[]) {
  const b = new VaultBuilder();
  statuses.forEach((_, i) => b.scene(`s${i}`));
  b.chain(...statuses.map((_, i) => `s${i}`));
  const v = b.build();
  v.chapters.c = { id: 'c', storyId: 's', title: 'One', order: 0 };
  statuses.forEach((st, i) => {
    v.scenes[`s${i}`] = { ...v.scenes[`s${i}`], chapterId: 'c', prose: `Scene ${i} text.`, ...(st ? { status: st as 'done' } : {}) };
  });
  return v;
}

describe('scene status', () => {
  it('rolls a chapter up as done of all its scenes, counting scenes with no status in the total', () => {
    expect(chapterRollup(chapterWith(['done', 'draft', undefined, 'done', 'idea']), 'c')).toEqual({ done: 2, total: 5 });
    expect(chapterRollup(chapterWith([]), 'c')).toEqual({ done: 0, total: 0 });
  });

  it('sets and clears a status without touching anything else, and returns the same vault when nothing changes', () => {
    const v = chapterWith([undefined]);
    const done = setSceneStatus(v, 's0', 'done');
    expect(done.scenes.s0.status).toBe('done');
    expect(setSceneStatus(done, 's0', 'done')).toBe(done);
    const cleared = setSceneStatus(done, 's0', undefined);
    expect(cleared.scenes.s0).not.toHaveProperty('status');
    expect(cleared.scenes.s0).toEqual(v.scenes.s0);
  });

  it('survives export and import in both formats', () => {
    const v = setSceneStatus(setSceneStatus(chapterWith(['draft', undefined]), 's1', 'revised'), 's0', 'done');
    expect(importJSON(exportJSON(v))).toStrictEqual(v);
    expect(filesToVault(vaultToFiles(v))).toStrictEqual(v);
  });

  it('refuses a status it does not know, naming the scene', () => {
    const doc = JSON.parse(exportJSON(chapterWith(['draft']))) as { vault: { scenes: Record<string, Record<string, unknown>> } };
    doc.vault.scenes.s0.status = 'finished';
    expect(() => importJSON(JSON.stringify(doc))).toThrow(/scenes\.s0.*idea, draft, revised or done/);
  });

  it('exports only the scenes marked done when asked, and everything otherwise', () => {
    const v = chapterWith(['done', 'draft', undefined, 'done']);
    const opts = { storyId: 's', chapterIds: null, sceneSeparator: 'none', chapterHeadings: false, keepNotes: false } as const;
    const texts = (onlyDone: boolean) => buildManuscript(v, { ...opts, onlyDone }).chapters.flatMap((c) => c.scenes.map((s) => s.text));
    expect(texts(true)).toEqual(['Scene 0 text.', 'Scene 3 text.']);
    expect(texts(false)).toHaveLength(4);
  });
});
