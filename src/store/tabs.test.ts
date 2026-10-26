import { describe, expect, it } from 'vitest';
import { emptyVault } from '../core/types';
import { useStore } from './store';

describe('tabs', () => {
  it('never closes a tab on its own, however many are open', () => {
    useStore.getState().closeAllTabs();
    for (let i = 0; i < 25; i++) useStore.getState().navigate({ kind: 'entity', id: `e${i}` });
    expect(useStore.getState().tabs).toHaveLength(25);
    expect(useStore.getState().tabs.map((t) => t.view)).toContainEqual({ kind: 'entity', id: 'e0' });
  });

  it('reopens closed tabs newest first, and skips one whose entity has been deleted since', () => {
    const vault = emptyVault();
    for (const id of ['a', 'b', 'c']) vault.entities[id] = { id, typeId: 't', name: id, aliases: [], note: '', props: {} };
    useStore.setState({ vault });
    useStore.getState().closeAllTabs();
    for (const id of ['a', 'b', 'c']) useStore.getState().navigate({ kind: 'entity', id });
    useStore.getState().closeAllTabs(); // a, b, c closed together
    const { b, ...withoutB } = vault.entities;
    void b;
    useStore.setState({ vault: { ...vault, entities: withoutB } });

    for (let i = 0; i < 4; i++) useStore.getState().reopenClosedTab();
    // c came back first, then a; b is gone, and pressing again with nothing left opens nothing.
    expect(useStore.getState().tabs.map((tab) => (tab.view.kind === 'entity' ? tab.view.id : '?'))).toEqual(['c', 'a']);
  });
});
