import { describe, expect, it } from 'vitest';
import { mergeText } from './merge';
import { conflictsOf, planSync, settle, type Decision } from './syncPlan';

// Contract with folder sync: this table decides whether the writer's words survive. A wrong cell loses work.

const files = (o: Record<string, string>) => new Map(Object.entries(o));
const decide = (base: string | undefined, ours: string | undefined, theirs: string | undefined): Decision => {
  const m = (v: string | undefined) => files(v === undefined ? {} : { f: v });
  return planSync(m(base), m(ours), m(theirs)).get('f')!;
};

describe('planSync: one file, every combination of who changed it', () => {
  it.each<[string, string | undefined, string | undefined, string | undefined, Decision]>([
    ['nothing changed', 'a', 'a', 'a', { action: 'keep', text: 'a' }],
    ['only we edited', 'a', 'b', 'a', { action: 'write', text: 'b' }],
    ['only the folder edited', 'a', 'a', 'b', { action: 'read', text: 'b' }],
    ['both made the same edit', 'a', 'b', 'b', { action: 'keep', text: 'b' }],
    ['we created it', undefined, 'n', undefined, { action: 'write', text: 'n' }],
    ['the folder created it', undefined, undefined, 'n', { action: 'read', text: 'n' }],
    ['both created it with the same text', undefined, 'n', 'n', { action: 'keep', text: 'n' }],
    ['both created it with different text', undefined, 'n1', 'n2', { action: 'conflict' }],
    ['we deleted it, the folder did not touch it', 'a', undefined, 'a', { action: 'write', text: null }],
    ['the folder deleted it, we did not touch it', 'a', 'a', undefined, { action: 'read', text: null }],
    ['both deleted it', 'a', undefined, undefined, { action: 'keep', text: null }],
    ['we deleted it, the folder edited it', 'a', undefined, 'b', { action: 'conflict' }],
    ['the folder deleted it, we edited it', 'a', 'b', undefined, { action: 'conflict' }],
  ])('%s', (_name, base, ours, theirs, expected) => {
    expect(decide(base, ours, theirs)).toEqual(expected);
  });

  it('treats a re-save with Windows line endings as no change at all', () => {
    expect(decide('one\ntwo\n', 'one\ntwo\n', 'one\r\ntwo\r\n')).toEqual({ action: 'keep', text: 'one\ntwo\n' });
    // ...and still sees a real edit made by an editor that also changed the line endings.
    expect(decide('one\ntwo\n', 'one\ntwo\n', 'one\r\nTWO\r\n')).toEqual({ action: 'read', text: 'one\r\nTWO\r\n' });
  });

  it('merges edits in different places and conflicts on edits in the same place', () => {
    const base = 'Title\n\nFirst paragraph.\n\nSecond paragraph.\n';
    const mine = 'Title\n\nFirst paragraph, revised here.\n\nSecond paragraph.\n';
    expect(decide(base, mine, 'Title\n\nFirst paragraph.\n\nSecond paragraph, revised outside.\n')).toEqual({
      action: 'merge',
      text: 'Title\n\nFirst paragraph, revised here.\n\nSecond paragraph, revised outside.\n',
    });
    expect(decide(base, mine, 'Title\n\nFirst paragraph, revised elsewhere.\n\nSecond paragraph.\n')).toEqual({ action: 'conflict' });
  });

  it('plans every file on its own and lists the conflicts', () => {
    const plan = planSync(files({ a: '1', b: '1', c: '1' }), files({ a: '2', b: '2', c: '1' }), files({ a: '1', b: '3', c: '3' }));
    expect(Object.fromEntries([...plan].map(([p, d]) => [p, d.action]))).toEqual({ a: 'write', b: 'conflict', c: 'read' });
    expect(conflictsOf(plan)).toEqual(['b']);
  });
});

describe('mergeText', () => {
  const lines = (...l: string[]) => l.join('\n');

  it('keeps both sides when they insert in different places, and when both make the identical edit', () => {
    expect(mergeText(lines('a', 'b', 'c'), lines('a', 'X', 'b', 'c'), lines('a', 'b', 'c', 'Y'))).toEqual({ clean: true, text: lines('a', 'X', 'b', 'c', 'Y') });
    expect(mergeText(lines('a', 'b'), lines('a', 'B'), lines('a', 'B'))).toEqual({ clean: true, text: lines('a', 'B') });
  });

  it('conflicts when both insert at the same place differently, or one edits a line the other deletes', () => {
    expect(mergeText(lines('a', 'b'), lines('a', 'X', 'b'), lines('a', 'Y', 'b'))).toEqual({ clean: false });
    expect(mergeText(lines('a', 'b', 'c'), lines('a', 'B', 'c'), lines('a', 'c'))).toEqual({ clean: false });
  });

  it('merges edits on neighbouring lines', () => {
    expect(mergeText(lines('a', 'b', 'c'), lines('A', 'b', 'c'), lines('a', 'B', 'c'))).toEqual({ clean: true, text: lines('A', 'B', 'c') });
  });

  it('gives up rather than guess on files too large to compare', () => {
    const big = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join('\n');
    expect(mergeText(big, big + '\nours', 'theirs\n' + big)).toEqual({ clean: false });
  });

  it('writes the merge with CRLF when our copy uses it', () => {
    expect(mergeText('a\r\nb\r\nc', 'A\r\nb\r\nc', 'a\nb\nC')).toEqual({ clean: true, text: 'A\r\nb\r\nC' });
  });
});

describe('mergeText invariants over random edits', () => {
  // A small seeded generator keeps failures reproducible.
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

  it('applying disjoint edits from both sides equals applying both to the base; a side that did nothing changes nothing', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const base = Array.from({ length: 12 }, (_, i) => `line ${i}`);
      const mine = [...base];
      const theirs = [...base];
      const both = [...base];
      for (let i = 0; i < base.length; i++) {
        const roll = r();
        if (roll < 0.2) mine[i] = both[i] = `mine ${i}`;
        else if (roll < 0.4) theirs[i] = both[i] = `theirs ${i}`;
      }
      const merged = mergeText(base.join('\n'), mine.join('\n'), theirs.join('\n'));
      expect(merged, `seed ${seed}`).toEqual({ clean: true, text: both.join('\n') });
      expect(mergeText(base.join('\n'), mine.join('\n'), base.join('\n'))).toEqual({ clean: true, text: mine.join('\n') });
      expect(mergeText(base.join('\n'), base.join('\n'), theirs.join('\n'))).toEqual({ clean: true, text: theirs.join('\n') });
    }
  });
});

describe('settle', () => {
  const ours = files({ a: 'mine', b: 'mine', c: 'mine' });
  const theirs = files({ a: 'theirs', b: 'theirs' });
  const plan = planSync(files({ a: 'base', b: 'base', c: 'base' }), ours, theirs);
  // a: both changed, b: both changed, c: the folder deleted it and we edited it.

  it('refuses to settle while a conflict has no choice, and names it', () => {
    expect(settle(plan, ours, theirs, { a: 'mine' })).toEqual({ unresolved: ['b', 'c'] });
  });

  it('takes the chosen side for each conflict, including "the folder has no file" as a choice', () => {
    const settled = settle(plan, ours, theirs, { a: 'mine', b: 'theirs', c: 'theirs' });
    expect(settled).toEqual({ files: files({ a: 'mine', b: 'theirs' }) });
  });
});
