// Living pages: an entity's page and name are versioned over story time by 'revise' changes.
import { describe, expect, it } from 'vitest';
import { addChange, commitRevision } from '../store/actions';
import { diffLines, diffStats } from './diff';
import { importJSON, exportJSON } from './exchange';
import { findEntity } from './links';
import { Resolver } from './resolve';
import { createDemoVault } from './seed';
import type { Vault } from './types';

const HAIR = 'cut her hair short';

describe('time-resolved pages', () => {
  const v = createDemoVault();
  const r = new Resolver(v);

  it('uses the base page before the revision and the revised page after it', () => {
    expect(r.entityAt('ent_mira', r.atScene('sc_4')).note).not.toContain(HAIR);
    expect(r.entityAt('ent_mira', r.atScene('sc_4')).revision).toBeNull();
    const after = r.entityAt('ent_mira', r.atScene('sc_4', true));
    expect(after.note).toContain(HAIR);
    expect(after.revision?.id).toBe('chg_8');
    expect(r.entityAt('ent_mira', { kind: 'latest' }).note).toContain(HAIR);
  });

  it('applies at the end of the clip on the playhead', () => {
    expect(r.entityAt('ent_mira', r.atClip('sc_4', 'start')).note).not.toContain(HAIR);
    expect(r.entityAt('ent_mira', r.atClip('sc_4', 'end')).note).toContain(HAIR);
  });

  it('keeps the name when a revision does not rename', () => {
    expect(r.entityAt('ent_mira', { kind: 'latest' }).name).toBe('Mira');
  });

  it('lists page versions in story order, base first', () => {
    const h = r.pageHistory('ent_mira');
    expect(h.map((p) => p.change?.id ?? null)).toEqual([null, 'chg_8']);
    expect(h[1].prevNote).toBe(v.entities.ent_mira.note);
    expect(h[1].note).toContain(HAIR);
  });
});

describe('renames over time', () => {
  function renamed(): Vault {
    const v = createDemoVault();
    return addChange(v, { sceneId: 'sc_3', entityId: 'ent_norman', op: 'revise', rename: 'Norman the Bold' }).vault;
  }

  it('resolves the name as of each point in time', () => {
    const v = renamed();
    const r = new Resolver(v);
    expect(r.entityAt('ent_norman', r.atScene('sc_1')).name).toBe('Norman');
    expect(r.entityAt('ent_norman', r.atScene('sc_3', true)).name).toBe('Norman the Bold');
    // The page itself is untouched by a rename-only revision.
    expect(r.entityAt('ent_norman', { kind: 'latest' }).note).toBe(v.entities.ent_norman.note);
  });

  it('finds the entity by a later name', () => {
    expect(findEntity(renamed(), 'Norman the Bold')?.id).toBe('ent_norman');
    expect(findEntity(renamed(), 'norman-the-bold')?.id).toBe('ent_norman');
  });

  it('round-trips revise fields through JSON', () => {
    const v = renamed();
    expect(importJSON(exportJSON(v))).toStrictEqual(v);
  });
});

describe('commitRevision', () => {
  const before = (v: Vault, scene: string, ent: string) => {
    const s = new Resolver(v).entityAt(ent, new Resolver(v).atScene(scene));
    return { note: s.note, name: s.name };
  };

  it('adds a revision with only the fields that changed', () => {
    const v = createDemoVault();
    const b = before(v, 'sc_2', 'ent_norman');
    const { vault, id } = commitRevision(v, { entityId: 'ent_norman', anchor: { sceneId: 'sc_2' }, note: b.note + '\nHas brown hair.', name: b.name, message: 'Hair', before: b });
    const c = vault.changes[id!];
    expect(c.op).toBe('revise');
    expect(c.rename).toBeUndefined();
    expect(c.note).toContain('brown hair');
    expect(c.message).toBe('Hair');
  });

  it('amends the revision when committing again in the same scene', () => {
    const v = createDemoVault();
    const b = before(v, 'sc_2', 'ent_norman');
    const first = commitRevision(v, { entityId: 'ent_norman', anchor: { sceneId: 'sc_2' }, note: 'one', before: b });
    const second = commitRevision(first.vault, { entityId: 'ent_norman', anchor: { sceneId: 'sc_2' }, note: 'two', name: 'Old Norman', before: b });
    expect(second.id).toBe(first.id);
    const revs = Object.values(second.vault.changes).filter((c) => c.op === 'revise' && c.entityId === 'ent_norman');
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({ note: 'two', rename: 'Old Norman' });
  });

  it('removes an amended revision that no longer differs, and no-ops otherwise', () => {
    const v = createDemoVault();
    const b = before(v, 'sc_2', 'ent_norman');
    expect(commitRevision(v, { entityId: 'ent_norman', anchor: { sceneId: 'sc_2' }, note: b.note, before: b }).vault).toBe(v);
    const first = commitRevision(v, { entityId: 'ent_norman', anchor: { sceneId: 'sc_2' }, note: 'x', before: b });
    const back = commitRevision(first.vault, { entityId: 'ent_norman', anchor: { sceneId: 'sc_2' }, note: b.note, before: b });
    expect(back.id).toBeNull();
    expect(back.vault.changes[first.id!]).toBeUndefined();
  });

  it('supports write → revise → write → revise: each scene sees its own version', () => {
    let v = createDemoVault();
    v = commitRevision(v, { entityId: 'ent_norman', anchor: { sceneId: 'sc_1' }, note: 'Has brown hair.', before: before(v, 'sc_1', 'ent_norman') }).vault;
    v = commitRevision(v, { entityId: 'ent_norman', anchor: { sceneId: 'sc_3' }, note: 'Has green hair.', before: before(v, 'sc_3', 'ent_norman') }).vault;
    const r = new Resolver(v);
    expect(r.entityAt('ent_norman', r.atScene('sc_2')).note).toBe('Has brown hair.');
    expect(r.entityAt('ent_norman', r.atScene('sc_4')).note).toBe('Has green hair.');
    expect(r.pageHistory('ent_norman').map((p) => p.note)).toEqual([createDemoVault().entities.ent_norman.note, 'Has brown hair.', 'Has green hair.']);
  });
});

describe('diffLines', () => {
  it('marks added, removed and unchanged lines', () => {
    const d = diffLines('a\nb\nc', 'a\nB\nc\nd');
    expect(d).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'B' },
      { kind: 'same', text: 'c' },
      { kind: 'add', text: 'd' },
    ]);
    expect(diffStats(d)).toEqual({ added: 2, removed: 1 });
  });

  it('handles empty sides and trailing newlines', () => {
    expect(diffLines('', 'x\n')).toEqual([{ kind: 'add', text: 'x' }]);
    expect(diffLines('x\r\n', '')).toEqual([{ kind: 'del', text: 'x' }]);
    expect(diffLines('same\n', 'same')).toEqual([{ kind: 'same', text: 'same' }]);
  });
});
