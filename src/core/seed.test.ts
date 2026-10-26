import { describe, expect, it } from 'vitest';
import { createDemoVault } from './seed';
import { createPerfVault } from './perfSeed';
import { buildGraph } from './graph';
import { findEntity, parseLinks } from './links';
import { Resolver } from './resolve';
import type { Vault } from './types';
import { countWords } from './wordcount';

function isAcyclic(v: Vault): boolean {
  const indegree = new Map<string, number>();
  const next = new Map<string, string[]>();
  for (const id of Object.keys(v.moments)) {
    indegree.set(id, 0);
    next.set(id, []);
  }
  for (const c of Object.values(v.constraints)) {
    next.get(c.before)?.push(c.after);
    indegree.set(c.after, (indegree.get(c.after) ?? 0) + 1);
  }
  const ready = [...indegree].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  for (;;) {
    const id = ready.pop();
    if (id === undefined) break;
    visited++;
    for (const after of next.get(id) ?? []) {
      const d = (indegree.get(after) ?? 0) - 1;
      indegree.set(after, d);
      if (d === 0) ready.push(after);
    }
  }
  return visited === Object.keys(v.moments).length;
}

function expectConsistent(v: Vault): void {
  for (const arc of Object.values(v.arcs)) {
    expect(v.stories[arc.storyId], `story of ${arc.id}`).toBeDefined();
  }
  for (const chapter of Object.values(v.chapters)) {
    if (chapter.arcId !== undefined) {
      const arc = v.arcs[chapter.arcId];
      expect(arc, `arc of ${chapter.id}`).toBeDefined();
      expect(arc?.storyId, `story of arc of ${chapter.id}`).toBe(chapter.storyId);
    }
  }
  for (const scene of Object.values(v.scenes)) {
    expect(v.stories[scene.storyId], `story of ${scene.id}`).toBeDefined();
    expect(v.moments[scene.momentId], `moment of ${scene.id}`).toBeDefined();
    if (scene.chapterId !== null) {
      expect(v.chapters[scene.chapterId], `chapter of ${scene.id}`).toBeDefined();
    }
  }
  for (const c of Object.values(v.constraints)) {
    expect(v.moments[c.before], `before of ${c.id}`).toBeDefined();
    expect(v.moments[c.after], `after of ${c.id}`).toBeDefined();
  }
  for (const change of Object.values(v.changes)) {
    if (change.sceneId !== undefined) expect(v.scenes[change.sceneId], `scene of ${change.id}`).toBeDefined();
    expect(v.entities[change.entityId], `entity of ${change.id}`).toBeDefined();
  }
  for (const entity of Object.values(v.entities)) {
    expect(v.entityTypes[entity.typeId], `type of ${entity.id}`).toBeDefined();
  }
}

describe('createDemoVault', () => {
  const v = createDemoVault();
  const r = new Resolver(v);
  const latest = { kind: 'latest' } as const;

  it('has chapters 1-5 in the main story, grouped into the two arcs of SPEC §5', () => {
    const chapters = Object.values(v.chapters).sort((a, b) => a.order - b.order);
    expect(chapters.map((c) => [c.title, v.arcs[c.arcId!].title])).toEqual([
      ['Chapter 1', 'Arc I: Embers'],
      ['Chapter 2', 'Arc I: Embers'],
      ['Chapter 3', 'Arc I: Embers'],
      ['Chapter 4', 'Arc II: Ash'],
      ['Chapter 5', 'Arc II: Ash'],
    ]);
    expect(chapters.every((c) => c.storyId === 'story_main')).toBe(true);
  });

  it("puts the Norman sentence in chapter 1 and Mira's Road between chapters 2 and 3", () => {
    expect(v.scenes.sc_1.chapterId).toBe('ch_1');
    expect(v.scenes.sc_1.prose).toContain('[[norman]] is eating his food.');

    const g = buildGraph(v);
    const mom = (scene: string) => v.scenes[scene].momentId;
    expect(g.isBefore(mom('sc_2'), mom('sc_m1'))).toBe(true);
    expect(g.isBefore(mom('sc_m2'), mom('sc_3'))).toBe(true);
  });

  it('plays out the state changes SPEC §5 lists', () => {
    const at = (entity: string, prop: string, scene: string, own = false) =>
      r.entityAt(entity, r.atScene(scene, own)).props[prop]?.value;
    expect(at('ent_alice_bob', 'status', 'sc_2')).toBe('friends');
    expect(at('ent_alice_bob', 'status', 'sc_3', true)).toBe('enemies');
    expect(r.entityAt('ent_norman', latest).props.status.value).toBe('dead');
    expect(at('ent_norman', 'status', 'sc_4')).toBe('alive');
    expect(r.entityAt('ent_ashford', latest).props.state.value).toBe('ruined');
    expect(r.entityAt('ent_sword', latest).props.owner.value).toEqual({ kind: 'link', target: 'Mira' });
    expect(r.history('ent_norman').map((h) => h.change.message)).toContain('Falls defending the inn');
  });

  it('is internally consistent: every reference resolves and the time graph has no loop', () => {
    expectConsistent(v);
    expect(isAcyclic(v)).toBe(true);
  });

  it('is deterministic', () => {
    expect(createDemoVault()).toEqual(v);
  });
});

describe('createPerfVault', () => {
  it('produces the default counts', () => {
    const v = createPerfVault();
    expect(Object.keys(v.entityTypes)).toHaveLength(4);
    expect(Object.keys(v.entities)).toHaveLength(500);
    expect(Object.keys(v.stories)).toHaveLength(20);
    expect(Object.keys(v.chapters)).toHaveLength(100);
    expect(Object.keys(v.arcs)).toHaveLength(40);
    expect(Object.keys(v.scenes)).toHaveLength(2000);
    expect(Object.keys(v.moments)).toHaveLength(2000);
    expect(Object.keys(v.changes)).toHaveLength(5000);
    // 1980 chain constraints plus roughly one cross-story constraint per 10 scenes.
    const constraintCount = Object.keys(v.constraints).length;
    expect(constraintCount).toBeGreaterThanOrEqual(1980);
    expect(constraintCount).toBeLessThanOrEqual(2180);
  });

  it('has a valid, acyclic graph and valid references by default', () => {
    const v = createPerfVault();
    expect(isAcyclic(v)).toBe(true);
    expectConsistent(v);
  });

  it('is deterministic for the same seed and differs for another seed', () => {
    const small = { entities: 50, stories: 3, scenes: 100, changes: 200 };
    expect(createPerfVault(small)).toEqual(createPerfVault(small));
    expect(createPerfVault({ ...small, seed: 2 })).not.toEqual(createPerfVault(small));
  });

  it('respects small options and keeps the graph acyclic', () => {
    const v = createPerfVault({ entities: 50, stories: 3, scenes: 100, changes: 200 });
    expect(Object.keys(v.entities)).toHaveLength(50);
    expect(Object.keys(v.stories)).toHaveLength(3);
    expect(Object.keys(v.chapters)).toHaveLength(15);
    expect(Object.keys(v.arcs)).toHaveLength(6);
    expect(Object.keys(v.scenes)).toHaveLength(100);
    expect(Object.keys(v.changes)).toHaveLength(200);
    expect(isAcyclic(v)).toBe(true);
    expectConsistent(v);
  });
});

describe('perf seed with manuscript-sized prose', () => {
  const opts = { entities: 30, stories: 2, scenes: 20, changes: 40, wordsPerScene: 800 };

  it('writes about the asked-for number of words per scene, linking to real entities', () => {
    const vault = createPerfVault(opts);
    for (const scene of Object.values(vault.scenes)) {
      const n = countWords(scene.prose);
      expect(n).toBeGreaterThan(opts.wordsPerScene * 0.95);
      expect(n).toBeLessThan(opts.wordsPerScene * 1.1);
      for (const link of parseLinks(scene.prose)) expect(findEntity(vault, link.target)).toBeDefined();
    }
  });

  it('is deterministic, so benchmark numbers stay comparable', () => {
    expect(createPerfVault(opts)).toStrictEqual(createPerfVault(opts));
  });
});
