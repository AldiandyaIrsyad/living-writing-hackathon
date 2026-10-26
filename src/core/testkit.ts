// Tiny builder for hand-made vaults in unit tests.

import type { Id, PropValue, Props, StateChange, Vault } from './types';
import { emptyVault } from './types';

export class VaultBuilder {
  v: Vault = emptyVault();
  private n = 0;

  constructor() {
    this.v.entityTypes.t = { id: 't', name: 'Thing', color: '#000', icon: 'box', defaultProps: {} };
    this.v.stories.s = { id: 's', name: 'Story', color: '#000', order: 0 };
  }

  entity(id: Id, props: Props = {}, name = id): this {
    this.v.entities[id] = { id, typeId: 't', name, aliases: [], note: '', props };
    return this;
  }

  /** Scene `id` at moment `m_<id>` unless a moment is given. */
  scene(id: Id, moment: Id = `m_${id}`, storyId = 's'): this {
    if (!this.v.stories[storyId]) this.v.stories[storyId] = { id: storyId, name: storyId, color: '#000', order: 1 };
    this.v.moments[moment] ??= { id: moment, timelineId: 'main' };
    this.v.scenes[id] = { id, storyId, chapterId: null, title: id, prose: '', momentId: moment, order: this.n++ };
    return this;
  }

  /** Scene ids (or moment ids prefixed with "m:") in order: a < b < c ... */
  chain(...ids: Id[]): this {
    for (let i = 1; i < ids.length; i++) this.before(ids[i - 1], ids[i]);
    return this;
  }

  before(a: Id, b: Id): this {
    const ma = this.v.scenes[a]?.momentId ?? a;
    const mb = this.v.scenes[b]?.momentId ?? b;
    const id = `c${this.n++}`;
    this.v.constraints[id] = { id, before: ma, after: mb, timelineId: 'main' };
    return this;
  }

  /** Stretch a scene's clip to `columns` columns. */
  span(sceneId: Id, columns: number): this {
    this.v.scenes[sceneId].span = columns;
    return this;
  }

  /** `guest` happens during `host`: it starts `offset` columns after host starts (see Constraint.offset). */
  during(host: Id, guest: Id, offset: number): this {
    const ma = this.v.scenes[host]?.momentId ?? host;
    const mb = this.v.scenes[guest]?.momentId ?? guest;
    const id = `c${this.n++}`;
    this.v.constraints[id] = { id, before: ma, after: mb, timelineId: 'main', offset };
    return this;
  }

  change(sceneId: Id, entityId: Id, property: string, value: PropValue, op: StateChange['op'] = 'set'): this {
    const id = `chg${this.n++}`;
    this.v.changes[id] = { id, sceneId, entityId, op, property, value, order: this.n };
    return this;
  }

  op(sceneId: Id, entityId: Id, op: 'create' | 'retire'): this {
    const id = `chg${this.n++}`;
    this.v.changes[id] = { id, sceneId, entityId, op, order: this.n };
    return this;
  }

  build(): Vault {
    return this.v;
  }
}
