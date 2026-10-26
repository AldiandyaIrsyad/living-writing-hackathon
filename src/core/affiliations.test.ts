import { describe, expect, it } from 'vitest';
import { AFFILIATIONS, affiliationsAt, groupCandidates, joinGroup, leaveGroup, membersAt } from './affiliations';
import { Resolver } from './resolve';
import { VaultBuilder } from './testkit';
import type { Props, Vault } from './types';

const link = (target: string) => ({ kind: 'link' as const, target });

/**
 * Scenes s1 < s2 < s3 (chained). Group entities `guard` and `guild` of a group type; characters
 * `norman` (base member of the guard), `mira` (no base memberships), `bob` (base member of both).
 */
function world(props: Record<string, Props> = {}): Vault {
  const b = new VaultBuilder();
  b.v.entityTypes.fac = { id: 'fac', name: 'Faction', color: '#0f766e', icon: 'flag', defaultProps: {}, group: true };
  b.entity('guard', {}, 'The Ashford Guard');
  b.entity('guild', {}, "The Wanderers' Guild");
  b.v.entities.guard.typeId = 'fac';
  b.v.entities.guild.typeId = 'fac';
  b.entity('norman', props.norman ?? { status: 'alive', [AFFILIATIONS]: [link('The Ashford Guard')] }, 'Norman');
  b.entity('mira', props.mira ?? { status: 'alive' }, 'Mira');
  b.entity('bob', props.bob ?? { [AFFILIATIONS]: [link('The Ashford Guard'), link("The Wanderers' Guild")] }, 'Bob');
  b.scene('s1').scene('s2').scene('s3').chain('s1', 's2', 's3');
  return b.build();
}

const at = (v: Vault, sceneId: string, own = false) => new Resolver(v).atScene(sceneId, own);

describe('affiliationsAt', () => {
  it('reads base memberships at any time when nothing changes them', () => {
    const v = world();
    const r = new Resolver(v);
    expect(affiliationsAt(r, 'norman', { kind: 'latest' })).toEqual(['guard']);
    expect(affiliationsAt(r, 'norman', { kind: 'position', x: 0 })).toEqual(['guard']);
    expect(affiliationsAt(r, 'mira', { kind: 'latest' })).toEqual([]);
  });

  it('accepts a single link value as well as a list', () => {
    const v = world({ norman: { [AFFILIATIONS]: link('The Ashford Guard') } });
    expect(affiliationsAt(new Resolver(v), 'norman', { kind: 'latest' })).toEqual(['guard']);
  });

  it('ignores unresolved links and non-link values', () => {
    const v = world({ norman: { [AFFILIATIONS]: [link('Nowhere Club'), 'just text', link('the ashford guard')] } });
    expect(affiliationsAt(new Resolver(v), 'norman', { kind: 'latest' })).toEqual(['guard']);
  });

  it('resolves aliases of the group too', () => {
    const v = world({ norman: { [AFFILIATIONS]: [link('Ashford Watch')] } });
    v.entities.guard.aliases = ['Ashford Watch'];
    expect(affiliationsAt(new Resolver(v), 'norman', { kind: 'latest' })).toEqual(['guard']);
  });

  it('is empty before the entity comes into existence', () => {
    const v = world({ mira: { [AFFILIATIONS]: [link("The Wanderers' Guild")] } });
    v.changes.chg_create = { id: 'chg_create', sceneId: 's2', entityId: 'mira', op: 'create', order: 0 };
    const r = new Resolver(v);
    expect(affiliationsAt(r, 'mira', at(v, 's1'))).toEqual([]);
    expect(affiliationsAt(r, 'mira', at(v, 's2', true))).toEqual(['guild']);
  });
});

describe('membersAt', () => {
  it('lists base members sorted by name', () => {
    const v = world();
    const r = new Resolver(v);
    expect(membersAt(r, 'guard', { kind: 'latest' })).toEqual(['bob', 'norman']);
    expect(membersAt(r, 'guild', { kind: 'latest' })).toEqual(['bob']);
  });

  it('changes with joins and leaves over time', () => {
    let v = world();
    v = joinGroup(v, 'mira', 'guild', { sceneId: 's2' });
    v = leaveGroup(v, 'bob', 'guard', { sceneId: 's3' });
    const r = new Resolver(v);
    expect(membersAt(r, 'guild', at(v, 's1', true))).toEqual(['bob']);
    expect(membersAt(r, 'guild', at(v, 's2', true))).toEqual(['bob', 'mira']);
    expect(membersAt(r, 'guard', at(v, 's2', true))).toEqual(['bob', 'norman']);
    expect(membersAt(r, 'guard', { kind: 'latest' })).toEqual(['norman']);
  });
});

describe('groupCandidates', () => {
  it('lists group-type entities first, then every other entity, each sorted by name', () => {
    const v = world();
    v.entities.zz = { id: 'zz', typeId: 't', name: 'Zed', aliases: [], note: '', props: {} };
    expect(groupCandidates(v).map((e) => e.name)).toEqual(['The Ashford Guard', "The Wanderers' Guild", 'Bob', 'Mira', 'Norman', 'Zed']);
  });
});

describe('joinGroup and leaveGroup in a scene', () => {
  it('makes the entity a member only from the scene on', () => {
    const v = joinGroup(world(), 'mira', 'guild', { sceneId: 's2' });
    const r = new Resolver(v);
    expect(affiliationsAt(r, 'mira', at(v, 's1', true))).toEqual([]);
    expect(affiliationsAt(r, 'mira', at(v, 's2'))).toEqual([]);
    expect(affiliationsAt(r, 'mira', at(v, 's2', true))).toEqual(['guild']);
    expect(affiliationsAt(r, 'mira', at(v, 's3'))).toEqual(['guild']);
  });

  it('adds an add change with a default message and a scene order after existing changes', () => {
    let v = joinGroup(world(), 'mira', 'guild', { sceneId: 's2' });
    v = joinGroup(v, 'mira', 'guard', { sceneId: 's2', message: '  Signs on as a guard  ' });
    const changes = Object.values(v.changes).filter((c) => c.sceneId === 's2');
    expect(changes).toHaveLength(2);
    const [first, second] = changes.sort((a, b) => a.order - b.order);
    expect(first).toMatchObject({
      entityId: 'mira',
      op: 'add',
      property: AFFILIATIONS,
      value: link("The Wanderers' Guild"),
      order: 0,
      message: "Joins The Wanderers' Guild",
    });
    expect(second).toMatchObject({ order: 1, message: 'Signs on as a guard' });
    expect(first.id).not.toBe(second.id);
  });

  it('leaves in a later scene: member before, not after', () => {
    const v = leaveGroup(world(), 'norman', 'guard', { sceneId: 's2', message: 'Quits the watch' });
    const r = new Resolver(v);
    expect(affiliationsAt(r, 'norman', at(v, 's1', true))).toEqual(['guard']);
    expect(affiliationsAt(r, 'norman', at(v, 's2', true))).toEqual([]);
    expect(affiliationsAt(r, 'norman', { kind: 'latest' })).toEqual([]);
    const change = Object.values(v.changes).find((c) => c.entityId === 'norman');
    expect(change).toMatchObject({ op: 'removeItem', message: 'Quits the watch', value: link('The Ashford Guard') });
  });

  it('keeps several groups apart when joining and leaving at once', () => {
    let v = joinGroup(world(), 'mira', 'guild', { sceneId: 's1' });
    v = joinGroup(v, 'mira', 'guard', { sceneId: 's2' });
    v = leaveGroup(v, 'mira', 'guild', { sceneId: 's3' });
    const r = new Resolver(v);
    expect(affiliationsAt(r, 'mira', at(v, 's2', true))).toEqual(['guild', 'guard']);
    expect(affiliationsAt(r, 'mira', at(v, 's3', true))).toEqual(['guard']);
    expect(membersAt(r, 'guild', at(v, 's3', true))).toEqual(['bob']);
  });

  it('does nothing when the entity is already (or still not) a member at that scene', () => {
    const v = world();
    expect(joinGroup(v, 'bob', 'guild', { sceneId: 's1' })).toBe(v);
    expect(joinGroup(v, 'bob', 'guard', { sceneId: 's2' })).toBe(v);
    expect(leaveGroup(v, 'mira', 'guild', { sceneId: 's2' })).toBe(v);
  });

  it('ignores unknown scenes, unknown groups, and an entity joining itself', () => {
    const v = world();
    expect(joinGroup(v, 'mira', 'guild', { sceneId: 'nope' })).toBe(v);
    expect(joinGroup(v, 'mira', 'nope', { sceneId: 's1' })).toBe(v);
    expect(joinGroup(v, 'guild', 'guild', { sceneId: 's1' })).toBe(v);
  });
});

describe('joinGroup and leaveGroup in the base properties', () => {
  it('adds a link to an entity without affiliations and keeps its other values', () => {
    const v = joinGroup(world(), 'mira', 'guild', 'base');
    expect(v.entities.mira.props).toEqual({ status: 'alive', [AFFILIATIONS]: [link("The Wanderers' Guild")] });
    expect(affiliationsAt(new Resolver(v), 'mira', { kind: 'latest' })).toEqual(['guild']);
  });

  it('appends to an existing list and keeps the other values', () => {
    const v = joinGroup(world(), 'norman', 'guild', 'base');
    expect(v.entities.norman.props[AFFILIATIONS]).toEqual([link('The Ashford Guard'), link("The Wanderers' Guild")]);
    expect(v.entities.norman.props.status).toBe('alive');
  });

  it('is a no-op when the base already has the membership', () => {
    const v = world();
    expect(joinGroup(v, 'norman', 'guard', 'base')).toBe(v);
    expect(leaveGroup(v, 'mira', 'guard', 'base')).toBe(v);
  });

  it('removes only the leaving link and keeps the rest of the list', () => {
    const v = leaveGroup(world(), 'bob', 'guard', 'base');
    expect(v.entities.bob.props[AFFILIATIONS]).toEqual([link("The Wanderers' Guild")]);
  });

  it('removes the key entirely when the list becomes empty', () => {
    const v = leaveGroup(world(), 'norman', 'guard', 'base');
    expect(v.entities.norman.props).toEqual({ status: 'alive' });
    expect(Object.hasOwn(v.entities.norman.props, AFFILIATIONS)).toBe(false);
    expect(v.entities.norman.props).not.toHaveProperty(AFFILIATIONS);
  });

  it('removes a single-link value and drops the key', () => {
    const start = world({ norman: { [AFFILIATIONS]: link('The Ashford Guard') } });
    const v = leaveGroup(start, 'norman', 'guard', 'base');
    expect(Object.hasOwn(v.entities.norman.props, AFFILIATIONS)).toBe(false);
  });
});

describe('purity', () => {
  it('never mutates the input vault', () => {
    const v = world();
    const snapshot = structuredClone(v);
    const propsBefore = v.entities.norman.props;
    joinGroup(v, 'mira', 'guild', { sceneId: 's2' });
    leaveGroup(v, 'norman', 'guard', { sceneId: 's2' });
    joinGroup(v, 'mira', 'guild', 'base');
    leaveGroup(v, 'norman', 'guard', 'base');
    expect(v).toStrictEqual(snapshot);
    expect(v.entities.norman.props).toBe(propsBefore);
    expect(Object.keys(v.changes)).toHaveLength(0);
  });
});
