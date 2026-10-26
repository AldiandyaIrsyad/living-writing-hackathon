import { describe, expect, it } from 'vitest';
import { findEntity } from '../core/links';
import { Resolver } from '../core/resolve';
import { VaultBuilder } from '../core/testkit';
import type { Vault } from '../core/types';
import { commitRevision } from '../store/actions';
import { applyAgentOutput, editPage, parseAgentOutput, revertAgentOutput, type AgentOptions, type AgentOutput } from './apply';
import { buildContext } from './context';
import { applyEdits, pageLines, type PageEdit } from './page';

const answer = (part: Partial<AgentOutput> = {}): AgentOutput => ({ newEntities: [], pages: [], properties: [], states: [], contradictions: [], unlinkedNames: [], ...part });
const agent: AgentOptions = { model: 'm1', allowOverwrite: false };
const adds = (entity: string, ...lines: string[]) => ({ entity, edits: lines.map((text): PageEdit => ({ kind: 'add', text })), certainty: 'stated' as const });

/** Nora and Mira, two scenes in order. Scene two's prose is whatever the test needs. */
function world(prose2: string): Vault {
  const v = new VaultBuilder().entity('nora', {}, 'Nora').entity('mira', {}, 'Mira').scene('s1').scene('s2').chain('s1', 's2').build();
  v.entities.nora.note = 'Nora is a courier.';
  v.scenes.s1.prose = 'Nora rode north.';
  v.scenes.s2.prose = prose2;
  return v;
}

const noteAfter = (v: Vault, entity: string, scene: string) => {
  const r = new Resolver(v);
  return r.entityAt(findEntity(v, entity)!.id, r.atScene(scene, true)).note;
};
const latestLines = (v: Vault, entity: string) =>
  pageLines(new Resolver(v).entityAt(findEntity(v, entity)!.id, { kind: 'latest' }).note)
    .filter((l) => l.trim())
    .sort();

describe('reading the model’s reply', () => {
  it('finds the JSON inside a fenced reply and drops items that are not usable', () => {
    const out = parseAgentOutput('Here you go:\n```json\n{"pages":[{"entity":"Nora","edits":[{"add":"Left-handed"},{"bogus":1},{"replace":"Nora is a courier"}],"certainty":"maybe"},{"entity":"","edits":[{"add":"x"}]}],"states":[{"entity":"Nora","state":"tired"},{"state":"orphan"}]}\n```');
    expect(out.pages).toEqual([{ entity: 'Nora', edits: [{ kind: 'add', text: 'Left-handed' }], certainty: 'stated', message: undefined }]);
    expect(out.states).toEqual([{ entity: 'Nora', state: 'tired' }]);
  });

  it('refuses a reply with no JSON in it', () => {
    expect(() => parseAgentOutput('I could not read that scene.')).toThrow('did not answer with JSON');
  });
});

describe('a [[link]] with no page', () => {
  it('gets a page that exists from its scene on, while a name the writer did not link only becomes a suggestion', () => {
    const v = world('The [[Tam]] arrived with Zed.');
    const { vault, report } = applyAgentOutput(
      v,
      's2',
      answer({ newEntities: [{ name: 'Tam', type: 'Thing', aliases: ['the courier'] }, { name: 'Zed', type: 'Thing', aliases: [] }], pages: [adds('Tam', 'A courier from the north')] }),
      agent,
    );
    expect(report.created.map((c) => c.name)).toEqual(['Tam']);
    expect(findEntity(vault, 'Zed')).toBeUndefined();
    expect(report.unlinkedNames.map((n) => n.name)).toEqual(['Zed']);
    expect(findEntity(vault, 'the courier')?.name).toBe('Tam');
    // Nothing the scene reveals leaks into the story before it.
    const r = new Resolver(vault);
    const tam = findEntity(vault, 'Tam')!.id;
    expect(r.entityAt(tam, r.atScene('s2')).note).toBe('');
    expect(r.entityAt(tam, r.atScene('s2', true)).note).toBe('- A courier from the north\n');
  });

  it('gets a page even when it shares its own scene’s title, since a scene never links itself', () => {
    const v = world('She woke by [[the Hollow Cairn]].');
    v.scenes.s2.title = 'The Hollow Cairn';
    expect(buildContext(v, 's2')).toContain('Links with no page yet: the Hollow Cairn');
    const { report } = applyAgentOutput(v, 's2', answer({ newEntities: [{ name: 'the Hollow Cairn', type: 'Person', aliases: [] }] }), agent);
    expect(report.created.map((c) => c.name)).toEqual(['the Hollow Cairn']);
  });

  it('filed under a gallery type the writer has not used yet, installs that type', () => {
    const v = world('Mira hid the [[split tally]].');
    const context = buildContext(v, 's2');
    expect(context).toContain('- Item: Objects, artefacts and tools that matter to the plot.');
    // A new page starts from its type's template: the model is told its sections so it can file facts under them.
    expect(context).toContain('- Creature (page sections: Appearance, Habitat, Behaviour): Animals');
    const { vault, report } = applyAgentOutput(v, 's2', answer({ newEntities: [{ name: 'split tally', type: 'item', aliases: [] }] }), agent);
    expect(report.created.map((c) => c.type)).toEqual(['Item']);
    expect(vault.entityTypes[findEntity(vault, 'split tally')!.typeId].defaultProps).toEqual({ owner: '' });
  });
});

describe('editing pages', () => {
  it('adds only lines the page does not already say, and keeps a claim out of the wiki', () => {
    const v = world('Nora lied: she said she was an orphan.');
    const { vault, report } = applyAgentOutput(v, 's2', answer({ pages: [adds('Nora', 'Nora is a courier', 'Left-handed'), { ...adds('Nora', 'Orphaned at six'), certainty: 'claimed' }] }), agent);
    expect(noteAfter(vault, 'Nora', 's2')).toBe('Nora is a courier.\n\n- Left-handed\n');
    expect(report.claimed).toEqual([{ entity: 'Nora', edits: [{ kind: 'add', text: 'Orphaned at six' }] }]);
  });

  it('rewrites its own lines whatever the setting, but the writer’s only when overwriting is allowed, else offers the edit', () => {
    let v = world('Nora buried her dog. The courier guild threw her out.');
    v = applyAgentOutput(v, 's1', answer({ pages: [adds('Nora', 'Keeps a dog')] }), agent).vault;
    const edits = answer({
      pages: [
        {
          entity: 'Nora',
          edits: [
            { kind: 'replace', old: 'Keeps a dog', text: 'Her dog died' },
            { kind: 'replace', old: 'Nora is a courier.', text: 'Nora was a courier until the guild threw her out.' },
          ],
          certainty: 'stated',
        },
      ],
    });

    const careful = applyAgentOutput(v, 's2', edits, agent);
    expect(noteAfter(careful.vault, 'Nora', 's2')).toBe('Nora is a courier.\n\n- Her dog died\n');
    expect(careful.report.suggestions.map((s) => s.edit)).toEqual([{ kind: 'replace', old: 'Nora is a courier.', text: 'Nora was a courier until the guild threw her out.' }]);

    const bold = applyAgentOutput(v, 's2', edits, { ...agent, allowOverwrite: true });
    expect(noteAfter(bold.vault, 'Nora', 's2')).toBe('Nora was a courier until the guild threw her out.\n\n- Her dog died\n');
    expect(bold.report.suggestions).toEqual([]);
  });

  it('never amends a revision the writer made after the same scene, and offers its edits instead', () => {
    let v = world('Mira smiled.');
    v = commitRevision(v, { entityId: 'mira', anchor: { sceneId: 's2' }, note: 'Mira, in the writer’s words.', before: { note: '', name: 'Mira' } }).vault;
    const { vault, report } = applyAgentOutput(v, 's2', answer({ pages: [adds('Mira', 'Smiles often')] }), { ...agent, allowOverwrite: true });
    expect(noteAfter(vault, 'Mira', 's2')).toBe('Mira, in the writer’s words.');
    expect(report.suggestions).toHaveLength(1);
  });

  it('carries an edit made at an earlier scene into later versions of the page, and takes it back from them too', () => {
    // A bug report: re-reading chapter one after chapter two left chapter two's page with chapter one's old facts.
    let v = world('Nora again.');
    v.entities.nora.note = '';
    v = applyAgentOutput(v, 's1', answer({ pages: [adds('Nora', 'Fact A')] }), agent).vault;
    v = applyAgentOutput(v, 's2', answer({ pages: [adds('Nora', 'Fact B')] }), agent).vault;

    const reread = applyAgentOutput(v, 's1', answer({ pages: [adds('Nora', 'Fact C')] }), agent).vault;
    expect(latestLines(reread, 'Nora')).toEqual(['- Fact B', '- Fact C']);
    expect(latestLines(revertAgentOutput(v, 's1'), 'Nora')).toEqual(['- Fact B']);
  });

  it('a page version the writer accepts an edit into becomes theirs: taking back the agent’s output keeps it', () => {
    // A bug report: accepting a suggestion on a page the agent had revised in the same scene was lost on "Take back".
    let v = world('Nora quit.');
    v = applyAgentOutput(v, 's2', answer({ pages: [adds('Nora', 'Quit the guild')], states: [{ entity: 'Nora', state: 'restless' }] }), agent).vault;
    v = editPage(v, 's2', 'nora', [{ kind: 'replace', old: 'Nora is a courier.', text: 'Nora is a retired courier.' }], 'writer', 'Accepted').vault;
    const taken = revertAgentOutput(v, 's2');
    expect(latestLines(taken, 'Nora')).toEqual(['- Quit the guild', 'Nora is a retired courier.']);
    const r = new Resolver(taken);
    expect(r.entityAt('nora', { kind: 'latest' }).props.state).toBeUndefined();
  });
});

describe('where each line of a page came from', () => {
  it('tags each line with the page version that wrote it, telling the agent’s lines from the writer’s', () => {
    let v = world('Nora quit.');
    v = applyAgentOutput(v, 's1', answer({ pages: [adds('Nora', 'Rides a grey mare')] }), agent).vault;
    v = editPage(v, 's2', 'nora', [{ kind: 'add', text: 'Quit the guild' }], 'writer', 'Mine').vault;
    const r = new Resolver(v);
    const sources = r
      .lineSources('nora', r.entityAt('nora', { kind: 'latest' }).revision)
      .filter((l) => l.text.trim())
      .map((l) => [l.text, l.change?.sceneId ?? 'base page', l.change?.agent ?? 'writer']);
    expect(sources).toEqual([
      ['Nora is a courier.', 'base page', 'writer'],
      ['- Rides a grey mare', 's1', 'm1'],
      ['- Quit the guild', 's2', 'writer'],
    ]);
  });
});

describe('placing a new line on a page', () => {
  it('goes at the end of its heading’s section, and a heading the page lacks is added', () => {
    const page = '# Nora\n\n## Looks\n- Tall\n\n## History\n- Born in Ashford\n';
    expect(applyEdits(page, [{ kind: 'add', text: 'Scar on her cheek', under: 'Looks' }]).note).toBe('# Nora\n\n## Looks\n- Tall\n- Scar on her cheek\n\n## History\n- Born in Ashford\n');
    expect(applyEdits(page, [{ kind: 'add', text: 'Hates the sea', under: 'Quirks' }]).note).toBe('# Nora\n\n## Looks\n- Tall\n\n## History\n- Born in Ashford\n\n## Quirks\n- Hates the sea\n');
  });

  it('with no heading named, goes in the page’s lead, not into whichever section happens to be last', () => {
    expect(applyEdits('# Nora\n\n## Looks\n- Tall\n\n## History\n', [{ kind: 'add', text: 'A courier' }]).note).toBe('# Nora\n- A courier\n\n## Looks\n- Tall\n\n## History\n');
    expect(applyEdits('## Appearance\n\n## Background\n', [{ kind: 'add', text: 'Grey eyes' }]).note).toBe('- Grey eyes\n## Appearance\n\n## Background\n');
  });
});

describe('properties and time', () => {
  it('changes a property from the scene on, over a value the writer set only when overwriting is allowed, else offers it', () => {
    const v = new VaultBuilder().entity('norman', { status: 'alive', mood: 'calm' }, 'Norman').scene('s1').scene('s2').chain('s1', 's2').build();
    v.entityTypes.t.defaultProps = { mood: 'calm' }; // filled in by the type, not chosen by the writer
    v.scenes.s2.prose = 'Norman fell.';
    const out = answer({
      properties: [
        { entity: 'Norman', property: 'status', value: 'dead' },
        { entity: 'Norman', property: 'mood', value: 'angry' },
        { entity: 'Norman', property: 'shoeSize', value: '9' },
      ],
    });
    const after = (x: Vault) => {
      const r = new Resolver(x);
      return Object.fromEntries(Object.entries(r.entityAt('norman', r.atScene('s2', true)).props).map(([k, p]) => [k, p.value]));
    };

    const careful = applyAgentOutput(v, 's2', out, agent);
    expect(after(careful.vault)).toEqual({ status: 'alive', mood: 'angry' });
    expect(careful.report.propertySuggestions.map((p) => [p.property, p.value])).toEqual([['status', 'dead']]);

    const bold = applyAgentOutput(v, 's2', out, { ...agent, allowOverwrite: true });
    expect(after(bold.vault)).toEqual({ status: 'dead', mood: 'angry' });
    const r = new Resolver(bold.vault);
    expect(r.entityAt('norman', r.atScene('s2')).props.status.value).toBe('alive');
  });

  it('dates a scene only with a label the timeline can order, and only suggests one that would not fit or over the writer’s', () => {
    const v = world('Snow fell.');
    const label = (x: Vault) => x.moments[v.scenes.s2.momentId].label;
    const vague = applyAgentOutput(v, 's2', answer({ timeLabel: 'morning' }), agent);
    expect([label(vague.vault), vague.report.timeLabel]).toEqual([undefined, undefined]);

    expect(label(applyAgentOutput(v, 's2', answer({ timeLabel: 'Early Winter, 2026' }), agent).vault)).toBe('Early Winter, 2026');

    // The scene before is already dated later: writing this date would contradict the order the writer gave.
    v.moments[v.scenes.s1.momentId].concrete = 'Spring, 2027';
    const misfit = applyAgentOutput(v, 's2', answer({ timeLabel: 'Early Winter, 2026' }), agent);
    expect([label(misfit.vault), misfit.report.timeLabel, misfit.report.timeLabelSet]).toEqual([undefined, 'Early Winter, 2026', undefined]);

    delete v.moments[v.scenes.s1.momentId].concrete;
    v.moments[v.scenes.s2.momentId].label = 'Winter, 2026';
    const kept = applyAgentOutput(v, 's2', answer({ timeLabel: 'Early Winter, 2026' }), agent);
    expect([label(kept.vault), kept.report.timeLabel, kept.report.timeLabelSet]).toEqual(['Winter, 2026', 'Early Winter, 2026', undefined]);
  });
});

describe('contradictions', () => {
  const claim = { entity: 'Nora', claim: 'Nora is right-handed now', sceneQuote: 'She drew the sword with her right hand', wikiQuote: 'Nora lost her right hand' };

  function withLostHand(prose: string): Vault {
    const v = world(prose);
    v.entities.nora.note = 'Nora lost her right hand in the war.';
    return v;
  }

  it('are shown only when both quotes can be found in the text the agent saw', () => {
    const v = withLostHand('She drew the sword with her right hand.');
    expect(applyAgentOutput(v, 's2', answer({ contradictions: [claim] }), agent).report.contradictions).toEqual([claim]);
    expect(applyAgentOutput(v, 's2', answer({ contradictions: [{ ...claim, sceneQuote: 'She never held a sword' }] }), agent).report.contradictions).toEqual([]);
    expect(applyAgentOutput(v, 's2', answer({ contradictions: [{ ...claim, wikiQuote: 'Nora has two hands' }] }), agent).report.contradictions).toEqual([]);
  });

  it('are not raised for a scene the writer has not placed in time', () => {
    const v = withLostHand('She drew the sword with her right hand.');
    v.scenes.s2.someday = true;
    expect(applyAgentOutput(v, 's2', answer({ contradictions: [claim] }), agent).report.contradictions).toEqual([]);
  });
});

describe('what the agent is shown', () => {
  it('shows a flashback the story as it was then, not as it is now', () => {
    const v = new VaultBuilder().entity('nora', {}, 'Nora').scene('s1').scene('s2').scene('flash').chain('flash', 's1', 's2').build();
    v.scenes.flash.prose = 'Years ago, [[Nora]] laughed.';
    v.changes.c1 = { id: 'c1', sceneId: 's1', entityId: 'nora', op: 'set', property: 'state', value: 'grieving', order: 0 };
    expect(buildContext(v, 'flash')).toContain('Current state: (none recorded)');
    expect(buildContext(v, 's2')).not.toContain('Current state: (none recorded)');
  });

  it('shows the chapter’s notes and the latest dated scene before, so the scene can be dated from it', () => {
    const v = world('[[Nora]] slept.');
    v.chapters.ch = { id: 'ch', storyId: v.scenes.s2.storyId, title: 'The Crossing', order: 0, note: 'Set in late autumn, 2026.' };
    v.scenes.s2.chapterId = 'ch';
    v.moments[v.scenes.s1.momentId].label = 'Late Autumn, 2026';
    const context = buildContext(v, 's2');
    expect(context).toContain('Latest dated scene before this one: "s1", Late Autumn, 2026');
    expect(context).toContain('Chapter notes from the writer (they hold for every scene in "The Crossing"):\nSet in late autumn, 2026.');
  });

  it('marks the writer’s notes as notes where they stand, so a note about one passage is read against that passage', () => {
    const v = world('[[Nora]] flew over the sea. %% this section is a dream %% She woke in the cart. %% agent: Nora is lying later %%');
    expect(buildContext(v, 's2')).toContain(
      'Scene text:\n"""\n[[Nora]] flew over the sea. [Writer\'s note: this section is a dream] She woke in the cart. [Writer\'s note: Nora is lying later]\n"""',
    );
  });
});

describe('taking back a scene’s agent output', () => {
  it('removes what the agent wrote and the pages it made, and keeps everything the writer wrote', () => {
    let v = world('The [[Tam]] arrived.');
    v.changes.mine = { id: 'mine', sceneId: 's2', entityId: 'mira', op: 'set', property: 'status', value: 'waiting', order: 0 };
    v = applyAgentOutput(v, 's2', answer({ newEntities: [{ name: 'Tam', type: 'Thing', aliases: [] }], pages: [adds('Tam', 'A courier')], states: [{ entity: 'Mira', state: 'worried' }] }), agent).vault;
    const reverted = revertAgentOutput(v, 's2');
    expect(findEntity(reverted, 'Tam')).toBeUndefined();
    expect(Object.keys(reverted.changes)).toEqual(['mine']);
  });
});
