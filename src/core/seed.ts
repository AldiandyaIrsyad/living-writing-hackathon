// Deterministic demo world (SPEC section 5). Fixed readable ids so tests and e2e can refer to them.
import type { Arc, Chapter, Constraint, Entity, EntityType, Moment, Scene, Story, StateChange, Vault } from './types';

function byId<T extends { id: string }>(items: readonly T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) out[item.id] = item;
  return out;
}

export function createDemoVault(): Vault {
  const entityTypes: EntityType[] = [
    { id: 'type_character', name: 'Character', color: '#c2410c', icon: 'user', defaultProps: { status: 'alive' } },
    { id: 'type_place', name: 'Place', color: '#15803d', icon: 'map-pin', defaultProps: {} },
    { id: 'type_object', name: 'Object', color: '#7c3aed', icon: 'box', defaultProps: {} },
    { id: 'type_relationship', name: 'Relationship', color: '#be185d', icon: 'link', defaultProps: { status: '' } },
    { id: 'type_faction', name: 'Faction', color: '#0f766e', icon: 'flag', defaultProps: {}, group: true },
  ];

  const entities: Entity[] = [
    {
      id: 'ent_norman',
      typeId: 'type_character',
      name: 'Norman',
      aliases: [],
      note:
        'Norman keeps the inn at [[Ashford]] and has done for thirty years. He remembers every guest\'s order and most of their secrets.\n\nHe is the quiet centre of the town. #innkeeper',
      props: {
        status: 'alive',
        role: 'innkeeper',
        home: { kind: 'link', target: 'Ashford' },
        affiliations: [{ kind: 'link', target: 'The Ashford Guard' }],
      },
    },
    {
      id: 'ent_mira',
      typeId: 'type_character',
      name: 'Mira',
      aliases: ['The Wanderer'],
      note: 'Mira has walked every road between [[Ashford]] and the hills. She never stays anywhere long. #wanderer',
      props: { status: 'alive', role: 'wanderer' },
    },
    {
      id: 'ent_alice',
      typeId: 'type_character',
      name: 'Alice',
      aliases: [],
      note: 'Alice has known [[Bob]] since they were children. #friend',
      props: { status: 'alive' },
    },
    {
      id: 'ent_bob',
      typeId: 'type_character',
      name: 'Bob',
      aliases: [],
      note: 'Bob is loud, loyal and easily hurt. #friend',
      props: { status: 'alive', affiliations: [{ kind: 'link', target: 'The Ashford Guard' }] },
    },
    {
      id: 'ent_ashford',
      typeId: 'type_place',
      name: 'Ashford',
      aliases: [],
      note: 'A river town where the old roads meet. #place',
      props: { state: 'thriving' },
    },
    {
      id: 'ent_sword',
      typeId: 'type_object',
      name: 'Sword of Ash',
      aliases: [],
      note: 'Forged from black iron and quenched in ash. #object',
      props: { material: 'black iron' },
    },
    {
      id: 'ent_alice_bob',
      typeId: 'type_relationship',
      name: 'Alice-Bob',
      aliases: [],
      note: 'The bond between [[Alice]] and [[Bob]].',
      props: {
        between: [
          { kind: 'link', target: 'Alice' },
          { kind: 'link', target: 'Bob' },
        ],
        status: 'friends',
      },
    },
    {
      id: 'ent_guard',
      typeId: 'type_faction',
      name: 'The Ashford Guard',
      aliases: [],
      note: 'The town watch of [[Ashford]]. Few of them are paid, most of them are neighbours. #faction',
      props: { motto: 'Hold the gate' },
    },
    {
      id: 'ent_wanderers',
      typeId: 'type_faction',
      name: "The Wanderers' Guild",
      aliases: [],
      note: 'Loose fellowship of people who never stay put. Mira knows most of them. #faction',
      props: {},
    },
  ];

  const stories: Story[] = [
    { id: 'story_main', name: 'The Ashford Chronicle', color: '#2563eb', order: 0 },
    { id: 'story_mira', name: "Mira's Road", color: '#d97706', order: 1 },
  ];

  const arcs: Arc[] = [
    { id: 'arc_1', storyId: 'story_main', title: 'Arc I: Embers', order: 0 },
    { id: 'arc_2', storyId: 'story_main', title: 'Arc II: Ash', order: 1 },
  ];

  const chapters: Chapter[] = [1, 2, 3, 4, 5].map((n) => ({
    id: `ch_${n}`,
    storyId: 'story_main',
    title: `Chapter ${n}`,
    order: n - 1,
    arcId: n <= 3 ? 'arc_1' : 'arc_2',
  }));

  const moment = (id: string, label?: string): Moment =>
    label === undefined ? { id, timelineId: 'main' } : { id, label, timelineId: 'main' };
  const moments: Moment[] = [
    moment('m_1', 'Late autumn'),
    moment('m_2'),
    moment('m_3'),
    moment('m_4'),
    moment('m_5'),
    moment('m_m1'),
    moment('m_m2'),
  ];

  const orderedPairs: [string, string][] = [
    ['m_1', 'm_2'],
    ['m_2', 'm_3'],
    ['m_3', 'm_4'],
    ['m_4', 'm_5'],
    ['m_2', 'm_m1'],
    ['m_m1', 'm_m2'],
    ['m_m2', 'm_3'],
  ];
  const constraints: Constraint[] = orderedPairs.map(([before, after], i) => ({
    id: `c_${i + 1}`,
    before,
    after,
    timelineId: 'main',
  }));

  const scene = (
    id: string,
    title: string,
    storyId: string,
    chapterId: string | null,
    order: number,
    momentId: string,
    prose: string,
  ): Scene => ({ id, title, storyId, chapterId, order, momentId, prose });

  const scenes: Scene[] = [
    scene(
      'sc_1',
      'Supper at the Inn',
      'story_main',
      'ch_1',
      0,
      'm_1',
      '[[norman]] is eating his food.\n\nAcross the table, [[Alice]] and [[Bob]] argue quietly over the price of ale. The fire is low, and the [[Sword of Ash]] hangs above the hearth, black against the stones.',
    ),
    scene(
      'sc_2',
      'The Stranger',
      'story_main',
      'ch_2',
      1,
      'm_2',
      'A stranger comes in from the rain and asks for [[Norman]] by name. [[Mira]] watches from the doorway, her cloak still wet. [[Alice]] and [[Bob]] laugh together at the far table, not yet knowing what the night will cost them.',
    ),
    scene(
      'sc_3',
      'The Betrayal',
      'story_main',
      'ch_3',
      2,
      'm_3',
      '[[Bob]] says the words [[Alice]] will never forget. By morning their friendship lies broken on the floor of the [[Ashford]] inn.',
    ),
    scene(
      'sc_4',
      'Gathering Storm',
      'story_main',
      'ch_4',
      3,
      'm_4',
      'Clouds pile up over the hills above [[Ashford]]. [[Mira]] counts the coins in her purse and decides to leave before the storm breaks.',
    ),
    scene(
      'sc_5',
      'The Fall of Ashford',
      'story_main',
      'ch_5',
      4,
      'm_5',
      'The gates of [[Ashford]] give way at dusk. [[Norman]] falls defending the inn, and the town burns until the sky is red. Little of [[Ashford]] is left standing.',
    ),
    scene(
      'sc_m1',
      'Crossroads',
      'story_mira',
      null,
      0,
      'm_m1',
      '[[Mira]] reaches the crossroads at first light. One road leads back to [[Ashford]]; the other climbs into the hills. She stands there longer than she means to.',
    ),
    scene(
      'sc_m2',
      'The Sword in the Ash',
      'story_mira',
      null,
      1,
      'm_m2',
      'Among the ashes of the old road, [[Mira]] finds the [[Sword of Ash]] half buried in cinders. She lifts it, and it is heavier than it should be. From now on it is hers to carry.',
    ),
  ];

  const change = (
    id: string,
    sceneId: string,
    entityId: string,
    op: StateChange['op'],
    property: string,
    value: StateChange['value'],
    order: number,
  ): StateChange => ({ id, sceneId, entityId, op, property, value, order });

  const changes: StateChange[] = [
    {
      ...change('chg_1', 'sc_3', 'ent_alice_bob', 'set', 'status', 'enemies', 0),
      message: 'Alice sells Bob out to the mayor',
    },
    {
      ...change('chg_2', 'sc_5', 'ent_norman', 'set', 'status', 'dead', 0),
      message: 'Falls defending the inn',
    },
    {
      ...change('chg_3', 'sc_5', 'ent_ashford', 'set', 'state', 'ruined', 0),
      message: 'Burned in the night of the fall',
    },
    {
      ...change('chg_4', 'sc_m2', 'ent_sword', 'set', 'owner', { kind: 'link', target: 'Mira' }, 0),
      message: 'Mira pulls the sword from the ashes',
    },
    // A commit with only a message: no property changes, it just shows up in the history.
    {
      id: 'chg_5',
      sceneId: 'sc_2',
      entityId: 'ent_mira',
      op: 'note',
      order: 0,
      message: 'Arrives in Ashford, watching from the doorway',
    },
    {
      ...change('chg_6', 'sc_m1', 'ent_mira', 'add', 'affiliations', { kind: 'link', target: "The Wanderers' Guild" }, 0),
      message: "Joins the Wanderers' Guild at the crossroads",
    },
    {
      ...change('chg_7', 'sc_3', 'ent_alice', 'add', 'affiliations', { kind: 'link', target: 'The Ashford Guard' }, 1),
      message: "Takes Bob's place in the Guard",
    },
    // A living-page revision: Mira's page as it reads from "Gathering Storm" on.
    {
      id: 'chg_8',
      sceneId: 'sc_4',
      entityId: 'ent_mira',
      op: 'revise',
      order: 0,
      message: 'Decides to leave before the storm',
      note: 'Mira has walked every road between [[Ashford]] and the hills. She never stays anywhere long. #wanderer\n\nShe has cut her hair short for the road and means to be gone before the storm breaks.',
    },
  ];

  return {
    entityTypes: byId(entityTypes),
    entities: byId(entities),
    moments: byId(moments),
    constraints: byId(constraints),
    stories: byId(stories),
    arcs: byId(arcs),
    chapters: byId(chapters),
    scenes: byId(scenes),
    changes: byId(changes),
    reviewItems: {},
    images: {},
  };
}
