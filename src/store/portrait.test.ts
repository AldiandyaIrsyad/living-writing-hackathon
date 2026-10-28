import { describe, expect, it } from 'vitest';
import { VaultBuilder } from '../core/testkit';
import { updateEntity } from './actions';

describe('a portrait made by a model', () => {
  it('keeps its AI mark until another picture replaces it, so a real illustration is never marked "temporary"', () => {
    const v0 = new VaultBuilder().entity('ann').build();
    const made = updateEntity(v0, 'ann', { image: 'data:made', imageAi: true });
    expect(made.entities.ann).toMatchObject({ image: 'data:made', imageAi: true });

    const renamedAlias = updateEntity(made, 'ann', { aliases: ['A.'] });
    expect(renamedAlias.entities.ann.imageAi).toBe(true);

    const uploaded = updateEntity(made, 'ann', { image: 'data:real' });
    expect(uploaded.entities.ann.image).toBe('data:real');
    expect('imageAi' in uploaded.entities.ann).toBe(false);

    const removed = updateEntity(made, 'ann', { image: undefined });
    expect('image' in removed.entities.ann || 'imageAi' in removed.entities.ann).toBe(false);
  });
});
