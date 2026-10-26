import { describe, expect, it } from 'vitest';
import {
  compareConcretes,
  concreteEdges,
  DEFAULT_CALENDAR,
  findScenesByConcrete,
  matchesConcrete,
  parseConcrete,
  type CalendarSystem,
} from './concrete';
import { buildGraph } from './graph';
import {
  addChapterLabel,
  addSceneLabel,
  parseQuickCommit,
  removeChapterLabel,
  removeSceneLabel,
  setMomentConcrete,
  setMomentTimeSkip,
  setSceneSomeday,
  updateSceneSynopsis,
} from '../store/actions';
import {
  addStandaloneMilestone,
  allLabels,
  constrainScenesToLabel,
  deleteStandaloneMilestone,
  findLabel,
  moveScenesToLabel,
  updateStandaloneMilestone,
} from './labels';
import { moveSceneToChapterEnd } from './reorder';
import { createDemoVault } from './seed';
import { exportJSON, filesToVault, importJSON, vaultToFiles } from './exchange';
import { insertScene, layoutTimeline, moveScenes } from './timeline';
import { findProblems } from '../store/problems';

describe('Concrete dates and reprogrammable calendar', () => {
  it('parses ISO dates, year-month, year, and Season + Year', () => {
    const isoDay = parseConcrete('2026-10-25');
    expect(isoDay).toMatchObject({ year: 2026, precision: 'day', month: 10, day: 25, canonical: '2026-10-25' });

    const isoMonth = parseConcrete('2026-10');
    expect(isoMonth).toMatchObject({ year: 2026, precision: 'month', month: 10, canonical: '2026-10' });

    const season = parseConcrete('Autumn, 2026');
    expect(season).toMatchObject({ year: 2026, precision: 'season', seasonName: 'Autumn', canonical: 'Autumn, 2026' });

    const lateSeason = parseConcrete('Late Winter, 2026');
    expect(lateSeason).toMatchObject({
      year: 2026,
      precision: 'season',
      seasonName: 'Winter',
      modifier: 'late',
      canonical: 'Late Winter, 2026',
    });

    const yearOnly = parseConcrete('2026');
    expect(yearOnly).toMatchObject({ year: 2026, precision: 'year', canonical: '2026' });

    const namedDate = parseConcrete('October 25, 2026');
    expect(namedDate).toMatchObject({ year: 2026, precision: 'day', month: 10, day: 25, canonical: '2026-10-25' });

    expect(parseConcrete('The night of the fire')).toBeNull();
  });

  it('orders Concretes chronologically and supports reprogrammable custom calendars', () => {
    const spring = parseConcrete('Spring, 2026')!;
    const autumn = parseConcrete('Autumn, 2026')!;
    const winter = parseConcrete('Winter, 2026')!;
    const nextYear = parseConcrete('2027-01-01')!;

    expect(compareConcretes(spring, autumn)).toBe(-1);
    expect(compareConcretes(autumn, winter)).toBe(-1);
    expect(compareConcretes(winter, nextYear)).toBe(-1);

    // Custom calendar with 10 months of 50 days and custom seasons
    const customCal: CalendarSystem = {
      ...DEFAULT_CALENDAR,
      id: 'custom-10',
      months: Array.from({ length: 10 }, (_, i) => ({ name: `Moon${i + 1}`, days: 50 })),
      seasons: [
        { name: 'Thaw', order: 1 },
        { name: 'Frost', order: 2 },
      ],
    };
    const d45 = parseConcrete('100-02-45', customCal);
    expect(d45).toMatchObject({ year: 100, month: 2, day: 45, precision: 'day' });
    const thaw = parseConcrete('Thaw, 100', customCal)!;
    const frost = parseConcrete('Frost, 100', customCal)!;
    expect(compareConcretes(thaw, frost)).toBe(-1);
  });

  it('enforces Concrete as an absolute ordering constraint in the MomentGraph and rejects conflicting Concretes', () => {
    let vault = createDemoVault();
    // m_1 is before m_5 in the demo vault.
    const r1 = setMomentConcrete(vault, 'm_1', 'Autumn, 2026');
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    vault = r1.vault;

    // Setting m_5 (which is after m_1) to an earlier Concrete ("Spring, 2026") must be rejected as a cycle!
    const bad = setMomentConcrete(vault, 'm_5', 'Spring, 2026');
    expect(bad.ok).toBe(false);

    // Setting m_5 to a later Concrete ("Winter, 2026") succeeds.
    const good = setMomentConcrete(vault, 'm_5', 'Winter, 2026');
    expect(good.ok).toBe(true);

    // Unconstrained moments with Concretes are automatically ordered by concreteEdges in buildGraph.
    const edges = concreteEdges({
      a: { id: 'a', timelineId: 'main', concrete: '2026-10-25' },
      b: { id: 'b', timelineId: 'main', concrete: '2026-05-01' },
    });
    expect(edges).toEqual([{ before: 'b', after: 'a' }]);

    const g = buildGraph({
      moments: {
        a: { id: 'a', timelineId: 'main', concrete: '2026-10-25' },
        b: { id: 'b', timelineId: 'main', concrete: '2026-05-01' },
      },
      constraints: {},
    });
    expect(g.isBefore('b', 'a')).toBe(true);
  });

  it('searches scenes by Concrete date, season, month, or year', () => {
    let vault = createDemoVault();
    const res = setMomentConcrete(vault, 'm_1', '2026-10-25');
    if (res.ok) vault = res.vault;

    expect( matchesConcrete('2026-10-25', 'october') ).toBe(true);
    expect( matchesConcrete('2026-10-25', '2026') ).toBe(true);
    expect(findScenesByConcrete(vault, 'October').map((x) => x.sceneId)).toEqual(['sc_1']);
  });
});

describe('Labels (Standalone Event Bookmarks)', () => {
  it('attaches Labels to chapters or scenes, resolves their timeline span, and places scenes relative to a Label', () => {
    let vault = createDemoVault();
    // Put a Label "The Death of Hero Nora" spanning Chapter 3 and Chapter 4
    vault = addChapterLabel(vault, 'ch_3', 'The Death of Hero Nora');
    vault = addChapterLabel(vault, 'ch_4', 'The Death of Hero Nora');
    vault = addSceneLabel(vault, 'sc_5', 'The Fall');

    const labels = allLabels(vault);
    expect(labels.map((l) => l.name)).toEqual(['The Death of Hero Nora', 'The Fall']);

    const nora = findLabel(vault, 'the death of hero nora')!;
    expect(nora.chapters.map((c) => c.id)).toEqual(['ch_3', 'ch_4']);
    expect(nora.firstScene?.id).toBe('sc_3');
    expect(nora.lastScene?.id).toBe('sc_4');

    // Move "Mira's Road" scene sc_m1 to AFTER the Label "The Death of Hero Nora" (which ends at sc_4)
    const moved = moveScenesToLabel(vault, ['sc_m1'], 'after', 'The Death of Hero Nora');
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      const g = buildGraph(moved.vault);
      expect(g.isBefore(moved.vault.scenes.sc_4.momentId, moved.vault.scenes.sc_m1.momentId)).toBe(true);
    }

    // Constrain a scene BEFORE the Label
    const constrained = constrainScenesToLabel(vault, ['sc_m1'], 'before', 'The Death of Hero Nora');
    expect(constrained.ok).toBe(true);
    if (constrained.ok) {
      const g = buildGraph(constrained.vault);
      expect(g.isBefore(constrained.vault.scenes.sc_m1.momentId, constrained.vault.scenes.sc_3.momentId)).toBe(true);
    }

    // Removing labels cleans up optional fields
    vault = removeChapterLabel(vault, 'ch_3', 'The Death of Hero Nora');
    vault = removeChapterLabel(vault, 'ch_4', 'The Death of Hero Nora');
    vault = removeSceneLabel(vault, 'sc_5', 'The Fall');
    expect(allLabels(vault)).toEqual([]);
  });

  it('round-trips Concrete and Labels through JSON and Markdown files', () => {
    let vault = createDemoVault();
    const cRes = setMomentConcrete(vault, 'm_2', 'Autumn, 2026');
    if (cRes.ok) vault = cRes.vault;
    vault = addChapterLabel(vault, 'ch_3', 'The Death of Hero Nora');
    vault = addSceneLabel(vault, 'sc_5', 'Ashford Burns');

    expect(importJSON(exportJSON(vault))).toStrictEqual(vault);
    expect(filesToVault(vaultToFiles(vault))).toStrictEqual(vault);
  });

  it('supports standalone milestones (Labels and Concretes without a scene yet) and preserves them when scenes move', () => {
    let vault = createDemoVault();
    const m = addStandaloneMilestone(vault, {
      label: 'The Death of Hero Nora',
      concrete: 'Winter, 2027',
      afterMomentId: 'm_3',
    });
    expect(m.ok).toBe(true);
    if (!m.ok || !m.momentId) return;
    vault = m.vault;
    expect(vault.moments[m.momentId]).toMatchObject({
      concrete: 'Winter, 2027',
      labels: ['The Death of Hero Nora'],
    });
    expect(findLabel(vault, 'The Death of Hero Nora')?.moments.map((x) => x.id)).toContain(m.momentId);

    // Place a scene relative to the standalone milestone Label
    const moved = moveScenesToLabel(vault, ['sc_m1'], 'after', 'The Death of Hero Nora');
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      const g = buildGraph(moved.vault);
      expect(g.isBefore(m.momentId, moved.vault.scenes.sc_m1.momentId)).toBe(true);
    }
  });

  it('supports Someday (unplaced) scenes, scene synopsis, relative time skips, and parseQuickCommit shorthand', () => {
    let vault = createDemoVault();
    const created = insertScene(vault, { storyId: 'story_main', title: 'Cool Tavern Brawl' }, null, null);
    vault = setSceneSomeday(created.vault, created.sceneId, true);
    vault = updateSceneSynopsis(vault, created.sceneId, 'Norman meets the bounty hunter');
    const scId = created.sceneId;

    expect(vault.scenes[scId].someday).toBe(true);
    expect(vault.scenes[scId].synopsis).toBe('Norman meets the bounty hunter');

    // Someday scenes do not clutter the timeline layout or trigger floating scene problems
    const layout = layoutTimeline(vault, buildGraph(vault));
    expect(layout.cells.some((c) => c.sceneId === scId)).toBe(false);
    expect(findProblems(vault).some((p) => p.rule === 'floating' && p.sceneId === scId)).toBe(false);

    // Moving a Someday scene onto the timeline automatically clears its someday flag
    const placed = moveScenes(vault, [scId], 'after', 'sc_1');
    expect(placed.ok).toBe(true);
    if (placed.ok) {
      expect(placed.vault.scenes[scId].someday).toBeUndefined();
      vault = placed.vault;
    }

    // Can move back to Someday and update synopsis + relative timeSkip
    vault = setSceneSomeday(vault, scId, true);
    expect(vault.scenes[scId].someday).toBe(true);
    vault = updateSceneSynopsis(vault, scId, 'Updated beat');
    vault = setMomentTimeSkip(vault, 'm_2', '3 months later');
    expect(vault.moments.m_2.timeSkip).toBe('3 months later');

    // Round-trip through JSON and Markdown
    expect(importJSON(exportJSON(vault))).toStrictEqual(vault);
    expect(filesToVault(vaultToFiles(vault))).toStrictEqual(vault);

    // Shorthand commit parser
    expect(parseQuickCommit('status = dead — Falls defending the inn')).toEqual({
      op: 'set',
      property: 'status',
      value: 'dead',
      message: 'Falls defending the inn',
    });
    expect(parseQuickCommit('owner = [[Mira]]')).toEqual({
      op: 'set',
      property: 'owner',
      value: { kind: 'link', target: 'Mira' },
    });
    expect(parseQuickCommit('owner = [[Mira|Queen Mira]]')).toEqual({
      op: 'set',
      property: 'owner',
      value: { kind: 'link', target: 'Mira' },
    });
    expect(parseQuickCommit('Note: Norman arrived at the keep')).toEqual({
      op: 'note',
      message: 'Note: Norman arrived at the keep',
    });
    expect(parseQuickCommit('14:30: Arrived at tavern')).toEqual({
      op: 'note',
      message: '14:30: Arrived at tavern',
    });
    expect(parseQuickCommit('Norman hair turns white')).toEqual({
      op: 'note',
      message: 'Norman hair turns white',
    });

    // Moving a Someday scene into a chapter clears someday
    vault = moveSceneToChapterEnd(vault, scId, 'ch_1');
    expect(vault.scenes[scId].chapterId).toBe('ch_1');
    expect(vault.scenes[scId].someday).toBeUndefined();
  });

  it('supports natural writer date formats and editing/deleting standalone milestones', () => {
    expect(parseConcrete('October 25th, 2026')?.canonical).toBe('2026-10-25');
    expect(parseConcrete('Autumn of 2026')?.canonical).toBe('Autumn, 2026');
    expect(parseConcrete('10/25/2026')?.canonical).toBe('2026-10-25');
    expect(parseConcrete('44 BC')?.year).toBe(-44);
    expect(parseConcrete('Day 4')?.canonical).toBe('Day 4');

    let vault = createDemoVault();
    const m = addStandaloneMilestone(vault, {
      label: 'Typo Milestone',
      concrete: '2026-11-01',
      afterMomentId: 'm_1',
      beforeMomentId: 'm_2',
    });
    expect(m.ok).toBe(true);
    if (!m.ok || !m.momentId) return;
    vault = m.vault;

    const updated = updateStandaloneMilestone(vault, m.momentId, {
      labels: ['Fixed Milestone'],
      concrete: '2026-11-05',
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      vault = updated.vault;
      expect(findLabel(vault, 'Fixed Milestone')).toBeDefined();
      expect(vault.moments[m.momentId].concrete).toBe('2026-11-05');
    }

    // Deleting standalone milestone bridges m_1 -> m_2
    vault = deleteStandaloneMilestone(vault, m.momentId);
    expect(vault.moments[m.momentId]).toBeUndefined();
    expect(buildGraph(vault).isBefore('m_1', 'm_2')).toBe(true);
  });
});

describe('Temporary Chapter/Scene Notes vs Lasting Changes & Ctrl+K Symbol Search', () => {
  it('temporary chapter notes (op: note) do not trigger downstream scene impact modals, while lasting changes (op: set) do', async () => {
    const { addChange } = await import('../store/actions');
    const { impactOf } = await import('../store/impact');
    const vault = createDemoVault();

    // Logging a temporary chapter note on Norman in sc_1 does not alter resolved state in later scenes
    const withNote = addChange(vault, {
      entityId: 'ent_norman',
      sceneId: 'sc_1',
      op: 'note',
      message: 'Suspicious of the stranger at the inn',
    }).vault;
    expect(impactOf(vault, withNote)).toEqual([]);

    // Logging a lasting property change (op: 'set') on Norman in sc_1 DOES impact downstream scenes mentioning Norman
    const withLasting = addChange(vault, {
      entityId: 'ent_norman',
      sceneId: 'sc_1',
      op: 'set',
      property: 'status',
      value: 'wounded',
      message: 'Ambush on the road',
    }).vault;
    expect(impactOf(vault, withLasting).length).toBeGreaterThan(0);
  });

  it('parses Ctrl+K prefix symbols (@ Wiki, # Timeline, ? Titles, / Full text, > Commands)', async () => {
    const { parseQuery } = await import('../ui/views/QuickSwitcher');
    expect(parseQuery('@norman')).toEqual({ mode: 'entities', text: 'norman' });
    expect(parseQuery('#Winter 2027')).toEqual({ mode: 'timeline', text: 'Winter 2027' });
    expect(parseQuery('?Chapter 1')).toEqual({ mode: 'titles', text: 'Chapter 1' });
    expect(parseQuery('/brass key')).toEqual({ mode: 'fulltext', text: 'brass key' });
    expect(parseQuery('>milestone')).toEqual({ mode: 'commands', text: 'milestone' });
    expect(parseQuery(':3')).toMatchObject({ mode: 'goto', text: ':3' });
  });
});
