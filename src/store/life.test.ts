import { describe, expect, it } from 'vitest';
import { findEntity, findScene } from '../core/links';
import { Resolver } from '../core/resolve';
import { createDemoVault } from '../core/seed';
import { VaultBuilder } from '../core/testkit';
import { entityLife } from './life';

describe('entityLife', () => {
  it('reads Norman’s arc in story order: in scenes quietly, then dead in the last one', () => {
    const vault = createDemoVault();
    const norman = findEntity(vault, 'norman')!.id;
    const r = new Resolver(vault);
    const life = entityLife(vault, r, norman);

    const fall = findScene(vault, 'The Fall of Ashford')!;
    const dying = life.filter((s) => s.props.some((p) => p.name === 'status'));
    expect(dying.map((s) => [s.sceneTitle, s.props.find((p) => p.name === 'status')])).toEqual([
      ['The Fall of Ashford', { name: 'status', before: 'alive', after: 'dead' }],
    ]);
    expect(life.at(-1)!.sceneId).toBe(fall.id);

    // Story order: no scene comes before one that precedes it on the timeline.
    const index = life.map((s) => r.graph.topoIndex(vault.scenes[s.sceneId].momentId));
    expect(index).toEqual([...index].sort((a, b) => a - b));
    expect(life.length).toBeGreaterThan(1);
    expect(life.slice(0, -1).every((s) => s.quiet || s.props.every((p) => p.name !== 'status'))).toBe(true);
  });

  it('marks where an entity begins and ends, and lists only the scenes it is in', () => {
    const v = new VaultBuilder()
      .entity('ghost', {}, 'Ghost')
      .scene('a')
      .scene('b')
      .scene('c')
      .scene('d')
      .chain('a', 'b', 'c', 'd')
      .op('b', 'ghost', 'create')
      .op('d', 'ghost', 'retire')
      .build();
    v.scenes.c = { ...v.scenes.c, prose: 'The [[ghost]] drifts by.' };
    const life = entityLife(v, new Resolver(v), 'ghost');
    expect(life.map((s) => [s.sceneTitle, s.existence ?? (s.quiet ? 'quiet' : 'other')])).toEqual([
      ['b', 'begins'],
      ['c', 'quiet'],
      ['d', 'ends'],
    ]);
  });

  it('is empty for an entity that is nowhere, or does not exist', () => {
    const v = new VaultBuilder().entity('lonely').scene('a').build();
    expect(entityLife(v, new Resolver(v), 'lonely')).toEqual([]);
    expect(entityLife(v, new Resolver(v), 'nobody')).toEqual([]);
  });
});
