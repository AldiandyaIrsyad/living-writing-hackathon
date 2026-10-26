// A change can sit on the timeline (at a column) instead of belonging to a scene: moving scenes never carries it.
import { describe, expect, it } from 'vitest';
import { commitRevision } from '../store/actions';
import { filesToVault, importJSON, exportJSON, vaultToFiles } from './exchange';
import { Resolver } from './resolve';
import { VaultBuilder } from './testkit';
import { insertColumn, moveScenes, removeColumn } from './timeline';
import type { StateChange, Vault } from './types';

/** a b c d in a row (columns 0-3), one entity "n" whose status starts as "well". */
function story() {
  const b = new VaultBuilder().entity('n', { status: 'well' }).scene('a').scene('b').scene('c').scene('d').chain('a', 'b', 'c', 'd');
  return b;
}

/** Adds a timeline change to the vault (these have no scene). */
function onTimeline(v: Vault, id: string, at: number, fields: Partial<StateChange>): void {
  v.changes[id] = { id, at, entityId: 'n', op: 'set', order: 0, ...fields };
}

const status = (v: Vault, x: number) => new Resolver(v).entityAt('n', { kind: 'position', x }).props.status?.value;

describe('timeline-anchored changes', () => {
  it('stay at their column when the scene they were written in moves; a scene-attached change goes with its scene', () => {
    const b = story().change('b', 'n', 'status', 'hurt');
    onTimeline(b.v, 'pinned', 2, { property: 'mood', value: 'grim' });
    const v = b.build();
    expect(status(v, 2)).toBe('hurt'); // b ends at column 2
    expect(new Resolver(v).entityAt('n', { kind: 'position', x: 2 }).props.mood?.value).toBe('grim');

    const moved = moveScenes(v, ['b'], 'after', 'd');
    if (!moved.ok) throw new Error(moved.error);
    // b now ends at column 4: the scene-attached "hurt" went with it, the timeline change did not.
    expect(status(moved.vault, 2)).toBe('well');
    expect(status(moved.vault, 4)).toBe('hurt');
    expect(new Resolver(moved.vault).entityAt('n', { kind: 'position', x: 2 }).props.mood?.value).toBe('grim');
  });

  it('interleave with scene-attached changes by column, so a later timeline change wins over an earlier scene one and the reverse', () => {
    const b = story().change('b', 'n', 'status', 'hurt').change('d', 'n', 'status', 'dead');
    onTimeline(b.v, 'mid', 3, { property: 'status', value: 'healed' });
    const v = b.build();
    expect([1, 2, 3, 4].map((x) => status(v, x))).toEqual(['well', 'hurt', 'healed', 'dead']);
    expect(new Resolver(v).entityAt('n', { kind: 'latest' }).props.status.value).toBe('dead');
    expect(new Resolver(v).history('n').map((h) => h.after)).toEqual(['hurt', 'healed', 'dead']);
  });

  it('are seen by a scene read as "entering it" only when they took effect before it starts', () => {
    const b = story();
    onTimeline(b.v, 'early', 1, { property: 'status', value: 'early' });
    onTimeline(b.v, 'late', 2, { property: 'status', value: 'late' });
    const r = new Resolver(b.build());
    expect(r.entityAt('n', r.atScene('b')).props.status.value).toBe('early'); // b starts at column 1
    expect(r.entityAt('n', r.atScene('b', true)).props.status.value).toBe('late'); // just after b ends at column 2
  });

  it('are not counted as ambiguous against scene changes, whatever their order', () => {
    const b = new VaultBuilder().entity('n', { status: 'well' }).scene('a').scene('x').scene('y').chain('a', 'x').chain('a', 'y').change('x', 'n', 'status', 'one').change('y', 'n', 'status', 'two');
    onTimeline(b.v, 'settle', 5, { property: 'status', value: 'three' });
    const v = b.build();
    const state = new Resolver(v).entityAt('n', { kind: 'latest' });
    expect(state.props.status.value).toBe('three');
    expect(state.props.status.ambiguous).toBeUndefined();
  });

  it('shift with the content when a gap is opened before them, not when it is opened after, and come back when it is closed', () => {
    const b = story();
    onTimeline(b.v, 'p1', 1, { property: 'x', value: 1 });
    onTimeline(b.v, 'p3', 3, { property: 'x', value: 3 });
    const v = b.build();
    const at = (vault: Vault) => [vault.changes.p1.at, vault.changes.p3.at];
    const opened = insertColumn(v, 2);
    expect(at(opened)).toEqual([1, 4]); // only the one past the new column moves
    expect(at(removeColumn(opened, 2))).toEqual([1, 3]);
  });

  it('count as made in the scene whose stretch of time they fall in', () => {
    const b = story().span('b', 2);
    onTimeline(b.v, 'in', 2, { property: 'x', value: 1 }); // inside b (columns 1-2)
    onTimeline(b.v, 'after', 3, { property: 'x', value: 2 }); // right after b
    b.change('c', 'n', 'x', 3);
    const r = new Resolver(b.build());
    expect(r.changesDuring('n', 'b').map((c) => c.id)).toEqual(['in', 'after']);
    expect(r.changesDuring('n', 'c').map((c) => c.id).sort()).toEqual([expect.stringMatching(/^chg/)]);
  });

  it('survive the folder/zip format and JSON, next to scene-attached changes', async () => {
    const b = story().change('b', 'n', 'status', 'hurt');
    onTimeline(b.v, 'pinned', 2, { property: 'mood', value: 'grim', message: 'Bad news' });
    const v = b.build();
    expect(filesToVault(vaultToFiles(v)).changes).toEqual(v.changes);
    expect((await importJSON(exportJSON(v))).changes).toEqual(v.changes);
  });
});

describe('page revisions on the timeline', () => {
  it('are amended per column, and "before" a revision is the page the earlier changes left', () => {
    const b = story();
    b.v.entities.n.note = 'base';
    b.v.changes.scn = { id: 'scn', sceneId: 'b', entityId: 'n', op: 'revise', note: 'by scene', order: 0 };
    const v = b.build();
    const r = new Resolver(v);
    // The scene revision ends at column 2: it comes before a timeline revision at the same column.
    const before = r.entityBefore('n', { at: 2 });
    expect(before.note).toBe('by scene');
    const first = commitRevision(v, { entityId: 'n', anchor: { at: 2 }, note: 'one', before });
    const again = commitRevision(first.vault, { entityId: 'n', anchor: { at: 2 }, note: 'two', before });
    expect(first.id).toBe(again.id);
    expect(Object.values(again.vault.changes).filter((c) => c.at === 2)).toHaveLength(1);
    expect(new Resolver(again.vault).entityAt('n', { kind: 'position', x: 2 }).note).toBe('two');
    // Another column is another revision.
    const other = commitRevision(again.vault, { entityId: 'n', anchor: { at: 3 }, note: 'three', before: new Resolver(again.vault).entityBefore('n', { at: 3 }) });
    expect(other.id).not.toBe(first.id);
  });
});
