// Deterministic performance world (SPEC section 5): many entities, stories, scenes and state changes.
import type { Arc, Chapter, Constraint, Entity, EntityType, Moment, Props, Scene, Story, StateChange, Vault } from './types';

export interface PerfOptions {
  entities?: number;
  stories?: number;
  scenes?: number;
  changes?: number;
  seed?: number;
  /**
   * Words of prose per scene. Unset keeps the two short paragraphs the original perf world has; set it to benchmark at
   * the size of a real manuscript (a scene of a novel is 1,000 to 2,000 words).
   */
  wordsPerScene?: number;
}

/** Named sizes for the scale benchmark (`npm run bench:scale`): a novel, a long saga, and a worst case. */
export const SCALE_PRESETS = {
  novel: { entities: 40, stories: 1, scenes: 60, changes: 150, wordsPerScene: 1700 },
  saga: { entities: 500, stories: 5, scenes: 400, changes: 1500, wordsPerScene: 1500 },
  monster: { entities: 500, stories: 20, scenes: 2000, changes: 5000, wordsPerScene: 1500 },
} as const satisfies Record<string, PerfOptions>;

const TYPE_NAMES = ['Character', 'Place', 'Object', 'Faction'];
const TYPE_COLORS = ['#c2410c', '#15803d', '#7c3aed', '#0e7490'];
const TYPE_ICONS = ['user', 'map-pin', 'box', 'flag'];
const STORY_COLORS = ['#2563eb', '#d97706', '#be185d', '#15803d', '#7c3aed', '#0e7490'];
const PROP_POOL = ['status', 'location', 'mood', 'allegiance', 'owner'];
const VALUE_POOL = ['alive', 'dead', 'calm', 'anxious', 'loyal', 'hostile', 'north', 'south', 'harbor', 'keep', 'ash', 'iron'];
const MATERIALS = ['iron', 'bone', 'glass', 'wood'];
const WORDS = ['smoke', 'river', 'lantern', 'road', 'storm', 'bell', 'ember', 'gate'];
// Everyday words for generated manuscript prose: only the count and the link density matter, not the meaning.
const VOCAB = ('the of and a to in he she they was were had that with his her for not on at by from as but said ' +
  'night road door light hand water wind stone fire voice after before under across through slowly quietly ' +
  'old long dark cold bright heavy narrow broken silent distant familiar sudden careful tired afraid ' +
  'walked turned waited listened remembered opened closed carried followed looked asked answered ' +
  'morning river window letter table shadow garden market bridge morning kitchen mountain village').split(' ');
/** About one [[link]] per this many words, like a world-heavy manuscript. */
const WORDS_PER_LINK = 60;
const CHAPTERS_PER_STORY = 5;
const ARCS_PER_STORY = 2;
/** Chapters with index below this (within their story) go to the first arc, the rest to the second. */
const CHAPTERS_IN_FIRST_ARC = 3;

/** mulberry32: small deterministic PRNG returning floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nonNegative(value: number | undefined, fallback: number): number {
  return value === undefined ? fallback : Math.max(0, Math.floor(value));
}

function nameOf(index: number): string {
  return `${TYPE_NAMES[index % TYPE_NAMES.length]} ${index + 1}`;
}

export function createPerfVault(opts: PerfOptions = {}): Vault {
  const entityCount = nonNegative(opts.entities, 500);
  const storyCount = nonNegative(opts.stories, 20);
  // Scenes need at least one story to live in.
  const sceneCount = storyCount === 0 ? 0 : nonNegative(opts.scenes, 2000);
  const changeCount = nonNegative(opts.changes, 5000);

  const rand = mulberry32(opts.seed ?? 1);
  const randInt = (n: number): number => Math.floor(rand() * n);
  const pick = <T>(items: readonly T[]): T => items[randInt(items.length)];
  const someone = (): string => (entityCount > 0 ? `[[${nameOf(randInt(entityCount))}]]` : 'Someone');

  /** Paragraphs of generated prose totalling `target` words, one [[link]] per WORDS_PER_LINK words. */
  const manuscript = (target: number): string => {
    const paragraphs: string[] = [];
    let written = 0;
    while (written < target) {
      const words: string[] = [];
      const length = Math.min(target - written, 40 + randInt(80));
      for (let i = 0; i < length; i++) {
        const w = randInt(WORDS_PER_LINK) === 0 && entityCount > 0 ? someone() : pick(VOCAB);
        words.push(words.length === 0 || /[.!?]$/.test(words[words.length - 1]) ? w.charAt(0).toUpperCase() + w.slice(1) : w);
        if (i % 14 === 13) words[words.length - 1] += '.';
      }
      paragraphs.push(words.join(' ').replace(/[.!?]?$/, '.'));
      written += length;
    }
    return paragraphs.join('\n\n');
  };

  // Entity types: one per name, id derived from the name.
  const entityTypes: Record<string, EntityType> = {};
  const typeIdOf = (t: number): string => `type_${TYPE_NAMES[t].toLowerCase()}`;
  TYPE_NAMES.forEach((name, t) => {
    const id = typeIdOf(t);
    entityTypes[id] = { id, name, color: TYPE_COLORS[t], icon: TYPE_ICONS[t], defaultProps: {} };
  });

  const baseProps = (t: number): Props => {
    switch (t) {
      case 0:
        return { status: 'alive', mood: pick(VALUE_POOL) };
      case 1:
        return { state: 'thriving' };
      case 2:
        return { material: pick(MATERIALS) };
      default:
        return { status: 'stable' };
    }
  };

  const entities: Record<string, Entity> = {};
  for (let i = 0; i < entityCount; i++) {
    const t = i % TYPE_NAMES.length;
    const name = nameOf(i);
    const id = `p_ent_${i}`;
    entities[id] = {
      id,
      typeId: typeIdOf(t),
      name,
      aliases: [],
      note: `${name} appears alongside ${someone()} in the perf world.`,
      props: baseProps(t),
    };
  }

  const stories: Record<string, Story> = {};
  const arcs: Record<string, Arc> = {};
  const chapters: Record<string, Chapter> = {};
  for (let s = 0; s < storyCount; s++) {
    const storyId = `p_story_${s}`;
    stories[storyId] = { id: storyId, name: `Story ${s + 1}`, color: STORY_COLORS[s % STORY_COLORS.length], order: s };
    for (let a = 0; a < ARCS_PER_STORY; a++) {
      const id = `p_arc_${s}_${a}`;
      arcs[id] = { id, storyId, title: `Arc ${a + 1}`, order: a };
    }
    for (let c = 0; c < CHAPTERS_PER_STORY; c++) {
      const id = `p_ch_${s}_${c}`;
      const arcId = `p_arc_${s}_${c < CHAPTERS_IN_FIRST_ARC ? 0 : 1}`;
      chapters[id] = { id, storyId, title: `Chapter ${c + 1}`, order: c, arcId };
    }
  }

  // Scene g belongs to story g % storyCount and is the (g / storyCount)-th scene of that story.
  // Global index g grows along every story chain, which keeps the constraint graph acyclic.
  const perStory = storyCount === 0 ? 0 : Math.floor(sceneCount / storyCount);
  const extraScenes = storyCount === 0 ? 0 : sceneCount % storyCount;
  const storySize = (s: number): number => perStory + (s < extraScenes ? 1 : 0);
  const momentId = (g: number): string => `p_m_${g}`;

  const moments: Record<string, Moment> = {};
  const scenes: Record<string, Scene> = {};
  for (let g = 0; g < sceneCount; g++) {
    const s = g % storyCount;
    const k = Math.floor(g / storyCount);
    const chapterIndex = Math.floor((k * CHAPTERS_PER_STORY) / storySize(s));
    const id = `p_sc_${g}`;
    moments[momentId(g)] = { id: momentId(g), timelineId: 'main' };
    scenes[id] = {
      id,
      storyId: `p_story_${s}`,
      chapterId: `p_ch_${s}_${chapterIndex}`,
      title: `Scene ${g + 1}`,
      prose:
        opts.wordsPerScene === undefined
          ? `${someone()} meets ${someone()} near the ${pick(WORDS)}.\n\nThe ${pick(WORDS)} goes quiet, and nobody says what they came to say.`
          : manuscript(nonNegative(opts.wordsPerScene, 0)),
      momentId: momentId(g),
      order: k,
    };
  }

  const constraints: Record<string, Constraint> = {};
  let constraintCount = 0;
  const addConstraint = (before: string, after: string): void => {
    const id = `p_c_${constraintCount++}`;
    constraints[id] = { id, before, after, timelineId: 'main' };
  };
  // Chain: each scene precedes the next scene of its own story.
  for (let g = 0; g + storyCount < sceneCount; g++) {
    addConstraint(momentId(g), momentId(g + storyCount));
  }
  // Cross-story: about one per 10 scenes, always from a lower to a higher global index.
  if (storyCount > 1) {
    for (let g = 9; g < sceneCount; g += 10) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const a = randInt(g);
        if (a % storyCount !== g % storyCount) {
          addConstraint(momentId(a), momentId(g));
          break;
        }
      }
    }
  }

  const changes: Record<string, StateChange> = {};
  if (entityCount > 0 && sceneCount > 0) {
    const nextOrder = new Map<string, number>();
    for (let i = 0; i < changeCount; i++) {
      const entityId = `p_ent_${randInt(entityCount)}`;
      const sceneId = `p_sc_${randInt(sceneCount)}`;
      const order = nextOrder.get(sceneId) ?? 0;
      nextOrder.set(sceneId, order + 1);
      const id = `p_chg_${i}`;
      changes[id] = { id, sceneId, entityId, op: 'set', property: pick(PROP_POOL), value: pick(VALUE_POOL), order };
    }
  }

  return { entityTypes, entities, moments, constraints, stories, arcs, chapters, scenes, changes, reviewItems: {}, images: {} };
}
