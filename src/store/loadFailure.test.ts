import { describe, expect, it, vi } from 'vitest';
import { VaultBuilder } from '../core/testkit';
import { flushPendingSave, initPersistence, storage, useStore } from './store';

// Bug class this guards: the saved vault cannot be read, the app opens on the starter world, and the first
// autosave overwrites the writer's real (merely unreadable) data with it.

describe('when the saved vault cannot be read', () => {
  it('reports why and never writes over what is stored', async () => {
    vi.stubGlobal('window', { addEventListener: () => {} }); // initPersistence hooks beforeunload; the unit env has no DOM
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(storage, 'load').mockRejectedValue(new Error('database is locked'));
    const save = vi.spyOn(storage, 'save').mockResolvedValue();

    await initPersistence();
    expect(useStore.getState().loadError).toBe('database is locked');

    useStore.getState().commit(new VaultBuilder().scene('a').build());
    await flushPendingSave();
    expect(save).not.toHaveBeenCalled();
  });
});
