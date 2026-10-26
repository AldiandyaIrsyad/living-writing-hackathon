import { describe, expect, it } from 'vitest';
import { VaultBuilder } from '../core/testkit';
import { groupCast } from './cast';

describe('groupCast', () => {
  it('lists everyone in the scenes once, in order of first appearance, with the scenes each is in', () => {
    const v = new VaultBuilder().entity('ann').entity('bob').entity('cy').scene('a').scene('b').scene('c').build();
    v.scenes.a.prose = 'Meet [[bob]] and [[ann]].';
    v.scenes.b.prose = '[[cy]] then [[ann]] again.';
    v.scenes.c.cast = ['cy'];
    const group = groupCast(v, [v.scenes.a, v.scenes.b, v.scenes.c]);
    expect(group.map((m) => [m.entityId, m.sceneIds])).toEqual([
      ['bob', ['a']],
      ['ann', ['a', 'b']],
      ['cy', ['b', 'c']],
    ]);
  });

  it('keeps how an entity first got in: a mention beats a later hand-added entry', () => {
    const v = new VaultBuilder().entity('ann').scene('a').scene('b').build();
    v.scenes.a.prose = '[[ann]]';
    v.scenes.b.cast = ['ann'];
    expect(groupCast(v, [v.scenes.a, v.scenes.b])[0].source).toBe('mention');
  });
});
