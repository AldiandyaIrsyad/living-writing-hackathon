import { beforeEach, describe, expect, it } from 'vitest';
import { VaultBuilder } from '../core/testkit';
import type { Vault } from '../core/types';
import { deleteChange } from './actions';
import { useStore } from './store';

const toasts = () => useStore.getState().toasts.map((t) => t.text);

// Contract with the retcon preview: an edit that changes what other scenes see waits for a yes; one that does not goes through.

function world(mentionLater: boolean): Vault {
  const b = new VaultBuilder().entity('norman', { status: 'alive' }).scene('a').scene('b').chain('a', 'b').change('a', 'norman', 'status', 'dead');
  const v = b.build();
  if (mentionLater) v.scenes.b = { ...v.scenes.b, prose: '[[norman]] again.' };
  return v;
}

const deathOf = (v: Vault) => Object.keys(v.changes)[0];

beforeEach(() => {
  useStore.setState({ vault: world(true), past: [], future: [], proposal: null });
});

describe('propose', () => {
  it('holds back an edit that changes what a later scene sees, until the writer says yes', () => {
    const before = useStore.getState().vault;
    const next = deleteChange(before, deathOf(before));
    useStore.getState().propose('Delete this change', next);

    expect(useStore.getState().vault).toBe(before); // nothing happened yet
    expect(useStore.getState().proposal?.impacts.map((i) => i.sceneId)).toEqual(['b']);

    useStore.getState().resolveProposal(true);
    expect(useStore.getState().vault).toBe(next);
    expect(useStore.getState().proposal).toBeNull();
    useStore.getState().undo();
    expect(useStore.getState().vault).toBe(before); // one undo step
  });

  it('saying no leaves the vault exactly as it was', () => {
    const before = useStore.getState().vault;
    useStore.getState().propose('Delete this change', deleteChange(before, deathOf(before)));
    useStore.getState().resolveProposal(false);
    expect(useStore.getState().vault).toBe(before);
    expect(useStore.getState().proposal).toBeNull();
    expect(useStore.getState().past).toHaveLength(0);
  });

  it('commits at once when no scene would see a difference', () => {
    useStore.setState({ vault: world(false) }); // nobody mentions him after the death
    const before = useStore.getState().vault;
    const next = deleteChange(before, deathOf(before));
    useStore.getState().propose('Delete this change', next);
    expect(useStore.getState().vault).toBe(next);
    expect(useStore.getState().proposal).toBeNull();
  });
});

describe('adding the touched scenes to the review list', () => {
  it('lists each scene with the edit and what changed for it, in the same undo step: Undo removes the edit and the items together', () => {
    const before = useStore.getState().vault;
    useStore.getState().propose('Delete this change', deleteChange(before, deathOf(before)));
    useStore.getState().resolveProposal(true, true);

    const items = Object.values(useStore.getState().vault.reviewItems);
    expect(items.map((i) => [i.sceneId, i.cause, i.status])).toEqual([['b', 'Delete this change: norman status: dead → alive', 'open']]);

    useStore.getState().undo();
    expect(useStore.getState().vault).toBe(before);
    expect(useStore.getState().vault.reviewItems).toEqual({});
  });

  it('does not list anything when the writer just says go ahead', () => {
    const before = useStore.getState().vault;
    useStore.getState().propose('Delete this change', deleteChange(before, deathOf(before)));
    useStore.getState().resolveProposal(true);
    expect(useStore.getState().vault.reviewItems).toEqual({});
  });
});

describe('naming the step', () => {
  it('Undo and Redo say what they undid when the edit was named, and stay quiet when it was not', () => {
    useStore.setState({ toasts: [] });
    const s = useStore.getState();
    s.commit(deleteChange(s.vault, deathOf(s.vault)), undefined, 'Delete a commit');
    s.undo();
    s.redo();
    expect(toasts()).toEqual(['Undid: Delete a commit', 'Redid: Delete a commit']);

    useStore.setState({ toasts: [] });
    s.commit(world(false)); // an edit nobody named
    s.undo();
    expect(toasts()).toEqual([]);
  });
});
