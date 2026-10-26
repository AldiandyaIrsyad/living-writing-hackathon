import { describe, expect, it } from 'vitest';
import { addedBlocks, applyPropagation, insertBlocks, planPropagation } from './pagePropagate';
import { createDemoVault } from './seed';
import type { Vault } from './types';

const page = (...lines: string[]) => lines.join('\n');

/** Adds `added` to the early page and returns what each later page becomes. */
const propagate = (early: string, edited: string, ...later: string[]) =>
  planPropagation(early, edited, later.map((note, i) => ({ changeId: `c${i}`, sceneId: `s${i}`, note }))).versions;

describe('scaffolding upwards: added lines flow into later versions', () => {
  it('puts an added line after the line it followed', () => {
    const [v] = propagate(page('# Mira', 'A baker.', 'Loves bread.'), page('# Mira', 'A baker.', 'Tall, dark hair.', 'Loves bread.'), page('# Mira', 'A baker.', 'Cut her hair short.', 'Loves bread.', 'Left town.'));
    expect(v.after).toBe(page('# Mira', 'A baker.', 'Tall, dark hair.', 'Cut her hair short.', 'Loves bread.', 'Left town.'));
    expect(v.status).toBe('placed');
  });

  it('does not propagate an edited line, only pure additions', () => {
    const plan = propagate(page('A baker.', 'Loves bread.'), page('A pastry chef.', 'Loves bread.', 'Short.'), page('A baker.', 'Loves bread.', 'Left.'));
    expect(plan[0].after).toBe(page('A baker.', 'Loves bread.', 'Short.', 'Left.'));
  });

  it('adding to a page that already has the line changes nothing', () => {
    const [v] = propagate('A baker.', page('A baker.', 'Tall.'), page('A baker.', 'Tall.', 'Left.'));
    expect(v.status).toBe('present');
    expect(v.after).toBe(v.before);
  });

  it('falls back to the end of the same heading when the surrounding lines were rewritten', () => {
    const [v] = propagate(
      page('# Mira', '## Looks', 'Plain coat.', '## Habits', 'Early riser.'),
      page('# Mira', '## Looks', 'Plain coat.', 'Green eyes.', '## Habits', 'Early riser.'),
      page('# Mira', '## Looks', 'A red coat now.', '', '## Quirks', 'Sleeps in.'),
    );
    expect(v.after).toBe(page('# Mira', '## Looks', 'A red coat now.', 'Green eyes.', '', '## Quirks', 'Sleeps in.'));
    expect(v.status).toBe('section');
  });

  it('is marked a conflict, placed at the end, when neither the lines nor a heading can be found', () => {
    const [v] = propagate(page('Plain coat.', 'Early riser.'), page('Plain coat.', 'Green eyes.', 'Early riser.'), page('Red coat.', 'Sleeps in.'));
    expect(v.status).toBe('conflict');
    expect(v.after).toBe(page('Red coat.', 'Sleeps in.', 'Green eyes.'));
  });

  it('an addition at the very top stays at the top', () => {
    const [v] = propagate('A baker.', page('Born in Ashford.', 'A baker.'), page('A baker.', 'Left.'));
    expect(v.after).toBe(page('Born in Ashford.', 'A baker.', 'Left.'));
  });

  it('keeps a multi-line addition together and in order, and a missing trailing newline as it was', () => {
    const [v] = propagate(page('A baker.'), page('A baker.', 'Tall.', 'Dark hair.'), 'A baker.\nLeft.\n');
    expect(v.after).toBe('A baker.\nTall.\nDark hair.\nLeft.\n');
  });

  it('pure edits and deletions propagate nothing', () => {
    expect(planPropagation('A baker.\nTall.', 'A pastry chef.\nTall.', [{ changeId: 'c', sceneId: 's', note: 'x' }]).versions).toEqual([]);
    expect(planPropagation('A baker.\nTall.', 'A baker.', [{ changeId: 'c', sceneId: 's', note: 'x' }]).versions).toEqual([]);
  });

  it('a blank line alone is not an anchor', () => {
    const blocks = addedBlocks('A.\n\nB.', 'A.\n\nNew.\nB.');
    const { text } = insertBlocks('A.\nB.\nC.', blocks);
    // the blank line before "New." exists nowhere in the later page; B. (the line after) decides
    expect(text).toBe('A.\nNew.\nB.\nC.');
  });
});

describe('applying the chosen versions', () => {
  const vaultWithRevisions = (): { vault: Vault; ids: string[] } => {
    const vault = createDemoVault();
    const ids = Object.values(vault.changes)
      .filter((c) => c.op === 'revise' && c.note !== undefined)
      .map((c) => c.id);
    return { vault, ids };
  };

  it('writes only the ticked versions, leaves the input vault alone, and skips a version edited since the preview', () => {
    const { vault, ids } = vaultWithRevisions();
    expect(ids.length).toBeGreaterThan(0);
    const id = ids[0];
    const c = vault.changes[id];
    if (c.op !== 'revise' || c.note === undefined) throw new Error('fixture');
    const plan = planPropagation('x', 'x\nA brand new line.', [{ changeId: id, sceneId: c.sceneId, note: c.note }]);
    const snapshot = JSON.stringify(vault);

    const none = applyPropagation(vault, plan, []);
    expect(none.vault).toBe(vault);

    const done = applyPropagation(vault, plan, [id]);
    expect(done.applied).toBe(1);
    const written = done.vault.changes[id];
    expect(written.op === 'revise' && written.note).toContain('A brand new line.');
    expect(JSON.stringify(vault)).toBe(snapshot);

    const stale = { ...plan, versions: plan.versions.map((v) => ({ ...v, before: v.before + ' (edited since)' })) };
    expect(applyPropagation(vault, stale, [id]).applied).toBe(0);
  });
});
