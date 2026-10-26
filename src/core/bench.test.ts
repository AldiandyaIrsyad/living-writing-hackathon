// Performance budget from SPEC §6.4: a timeline drag re-resolves in < 50 ms on the perf seed.

import { describe, expect, it } from 'vitest';
import { createPerfVault } from './perfSeed';
import { Resolver } from './resolve';
import { moveScenes } from './timeline';

describe('performance', () => {
  // Timing-sensitive: retried so a noisy parallel test run doesn't fail the budget spuriously.
  it('timeline drag + re-resolve stays under 50 ms with 2,000 scenes', { retry: 2 }, () => {
    const vault = createPerfVault();
    const scenes = Object.values(vault.scenes);
    const entities = Object.keys(vault.entities);
    const story = scenes[0].storyId;
    const block = scenes.filter((s) => s.storyId === story).slice(0, 5).map((s) => s.id);
    const target = scenes.find((s) => s.storyId !== story)!.id;
    const viewAt = scenes[scenes.length - 1].id;

    // Warm up the JIT once.
    new Resolver(vault).entityAt(entities[0], { kind: 'latest' });

    const times: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      const res = moveScenes(vault, block, i % 2 ? 'before' : 'after', target);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const r = new Resolver(res.vault);
      // What the UI recomputes after a drag: the entities shown in the open scene + the inspector.
      const tp = r.atScene(viewAt);
      for (const e of entities.slice(0, 50)) r.entityAt(e, tp);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    console.log(`drag+resolve median ${median.toFixed(1)} ms (runs: ${times.map((t) => t.toFixed(1)).join(', ')})`);
    expect(median).toBeLessThan(50);
  });
});
