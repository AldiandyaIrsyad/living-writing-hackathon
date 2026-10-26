// Scale benchmark: how the engine, serialisation, search and storage behave at the size of real manuscripts.
// Not part of `npm test` (no *.test.ts name); run it with `npm run bench:scale`. It prints a table and writes it to
// .local/perf/scale-latest.md. Numbers are from Node, one machine, and fake-indexeddb for storage: orders of magnitude,
// not promises. Timing is allowed here (and in bench.test.ts) and nowhere else.

import 'fake-indexeddb/auto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { fullTextSearch } from '../ui/search';
import { deleteChange } from '../store/actions';
import { IndexedDBStorage } from '../store/db';
import { impactOf } from '../store/impact';
import { findProblems } from '../store/problems';
import { exportJSON, filesToVault, vaultToFiles } from './exchange';
import { buildGraph } from './graph';
import { SCALE_PRESETS, createPerfVault } from './perfSeed';
import { Resolver } from './resolve';
import { countWords } from './wordcount';

function time(fn: () => unknown, runs: number): number {
  const xs: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    xs.push(performance.now() - t0);
  }
  return xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
}

async function timeAsync(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

const ms = (n: number): string => (n < 10 ? n.toFixed(1) : String(Math.round(n)));

it('scale report', { timeout: 30 * 60_000 }, async () => {
  const rows: string[][] = [];
  for (const [name, preset] of Object.entries(SCALE_PRESETS)) {
    const vault = createPerfVault(preset);
    const words = Object.values(vault.scenes).reduce((n, s) => n + countWords(s.prose), 0);
    const json = exportJSON(vault);
    const files = vaultToFiles(vault);
    const heavy = words > 1_000_000 ? 1 : 3; // the biggest preset is slow enough to run once
    const entityIds = Object.keys(vault.entities);
    const store = new IndexedDBStorage();
    const someChange = Object.keys(vault.changes)[Math.floor(Object.keys(vault.changes).length / 2)];
    const withoutChange = deleteChange(vault, someChange);
    const impactFirst = time(() => impactOf(vault, withoutChange), 1); // the first call also parses every scene's links
    const saveAll = await timeAsync(() => store.save(null, vault));
    const edited = { ...vault, scenes: { ...vault.scenes } };
    const firstScene = Object.values(vault.scenes)[0];
    edited.scenes[firstScene.id] = { ...firstScene, prose: firstScene.prose + ' one more sentence.' };
    const saveOne = await timeAsync(() => store.save(vault, edited));
    const load = await timeAsync(() => store.load());
    rows.push([
      name,
      `${Math.round(words / 1000)}k`,
      String(Object.keys(vault.scenes).length),
      `${(json.length / 1e6).toFixed(1)} MB`,
      ms(time(() => buildGraph(vault), 5)),
      ms(time(() => { const r = new Resolver(vault); for (const id of entityIds) r.entityAt(id, { kind: 'latest' }); }, 5)),
      ms(time(() => vaultToFiles(vault), heavy)),
      ms(time(() => filesToVault(files), heavy)),
      ms(time(() => fullTextSearch(vault, 'quietly the lantern'), 5)),
      ms(time(() => Object.values(vault.scenes).forEach((s) => countWords(s.prose)), heavy)),
      `${ms(impactFirst)} / ${ms(time(() => impactOf(vault, withoutChange), heavy))}`,
      ms(time(() => findProblems(vault), heavy)),
      ms(saveAll),
      ms(saveOne),
      ms(load),
      `${Math.round(process.memoryUsage().heapUsed / 1e6)} MB`,
    ]);
  }
  const head = ['preset', 'words', 'scenes', 'JSON', 'graph', 'resolve all', 'to files', 'from files', 'search', 'count words', 'impact of 1 commit (first / repeat)', 'problems', 'IDB save all', 'IDB save 1 scene', 'IDB load', 'heap'];
  const table = [head, head.map(() => '---'), ...rows].map((r) => `| ${r.join(' | ')} |`).join('\n');
  const report = `# Scale report\n\nMilliseconds (median) unless noted. Node ${process.version}, fake-indexeddb for IDB columns, ${new Date().toISOString().slice(0, 10)}.\n\n${table}\n`;
  mkdirSync('.local/perf', { recursive: true });
  writeFileSync('.local/perf/scale-latest.md', report);
  console.log(report);
});
