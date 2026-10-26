import { describe, expect, it } from 'vitest';
import { presenceAt } from './presence';
import { Resolver } from './resolve';
import { VaultBuilder } from './testkit';
import type { Vault } from './types';

const where = (v: Vault, place: string, scene: string, includeOwn = true) => {
  const r = new Resolver(v);
  const p = presenceAt(v, r, place, r.atScene(scene, includeOwn));
  return p;
};

describe('presenceAt', () => {
  const world = () =>
    new VaultBuilder().entity('keep').entity('inn').entity('mira', {}, 'Mira').entity('norman', {}, 'Norman').scene('a').scene('b').scene('c').chain('a', 'b', 'c');

  it('follows a move: here before it, there after it', () => {
    const v = world().change('a', 'mira', 'location', { kind: 'link', target: 'keep' }).change('c', 'mira', 'location', { kind: 'link', target: 'inn' }).build();
    expect(where(v, 'keep', 'b')).toEqual({ here: ['mira'], maybe: [], contested: [] });
    expect(where(v, 'inn', 'b')).toEqual({ here: [], maybe: [], contested: [] });
    expect(where(v, 'keep', 'c')).toEqual({ here: [], maybe: [], contested: [] });
    expect(where(v, 'inn', 'c')).toEqual({ here: ['mira'], maybe: [], contested: [] });
  });

  it('reads a plain-text location, any capitalisation of the property, and several entities in name order', () => {
    const v = world().change('a', 'norman', 'Location', 'The Keep').change('a', 'mira', 'location', 'the keep').build();
    v.entities.keep = { ...v.entities.keep, name: 'The Keep' };
    expect(where(v, 'keep', 'b').here).toEqual(['mira', 'norman']);
  });

  it('leaves out an entity that has not begun to exist or has been retired', () => {
    const v = world()
      .change('a', 'mira', 'location', { kind: 'link', target: 'keep' })
      .op('b', 'mira', 'create')
      .op('c', 'mira', 'retire')
      .build();
    // Mira is created in b and retired in c: she is nowhere before b and after c.
    expect(where(v, 'keep', 'a', false).here).toEqual([]);
    expect(where(v, 'keep', 'b').here).toEqual(['mira']);
    expect(where(v, 'keep', 'c').here).toEqual([]);
  });

  it('says "maybe" when two moves in scenes with no known order disagree', () => {
    const b = new VaultBuilder().entity('keep').entity('inn').entity('mira', {}, 'Mira').scene('a').scene('x').scene('y').scene('z').chain('a', 'x').chain('a', 'y').chain('x', 'z').chain('y', 'z');
    const v = b
      .change('a', 'mira', 'location', { kind: 'link', target: 'keep' })
      .change('x', 'mira', 'location', { kind: 'link', target: 'inn' })
      .change('y', 'mira', 'location', { kind: 'link', target: 'keep' })
      .build();
    // Which of x and y came last is not known: at the keep she is resolved there but contested, at the inn she may be.
    expect(where(v, 'keep', 'z', false)).toEqual({ here: ['mira'], maybe: [], contested: ['mira'] });
    expect(where(v, 'inn', 'z', false)).toEqual({ here: [], maybe: ['mira'], contested: [] });
  });
});
