import { describe, expect, it } from 'vitest';
import { findEntity } from '../core/links';
import { Resolver } from '../core/resolve';
import { VaultBuilder } from '../core/testkit';
import type { Vault } from '../core/types';
import { commitRevision } from '../store/actions';
import { applyAgentOutput, parseAgentOutput, revertAgentOutput, type AgentOutput } from './apply';
import { buildContext } from './context';

const answer = (part: Partial<AgentOutput> = {}): AgentOutput => ({ newEntities: [], wiki: [], states: [], contradictions: [], unlinkedNames: [], ...part });

/** Nora and Mira, two scenes in order. Scene two's prose is whatever the test needs. */
function world(prose2: string): Vault {
  const v = new VaultBuilder().entity('nora', {}, 'Nora').entity('mira', {}, 'Mira').scene('s1').scene('s2').chain('s1', 's2').build();
  v.entities.nora.note = 'Nora is a courier.';
  v.scenes.s2.prose = prose2;
  return v;
}

const noteAfter = (v: Vault, entity: string, scene: string) => {
  const r = new Resolver(v);
  return r.entityAt(findEntity(v, entity)!.id, r.atScene(scene, true)).note;
};

describe('reading the model’s reply', () => {
  it('finds the JSON inside a fenced reply and drops items that are not usable', () => {
    const out = parseAgentOutput('Here you go:\n```json\n{"wiki":[{"entity":"Nora","lines":["Left-handed"],"certainty":"maybe"},{"entity":"","lines":["x"]},{"entity":"Mira","lines":[]}],"states":[{"entity":"Nora","state":"tired"},{"state":"orphan"}]}\n```');
    expect(out.wiki).toEqual([{ entity: 'Nora', lines: ['Left-handed'], certainty: 'stated', message: undefined }]);
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
      answer({
        newEntities: [
          { name: 'Tam', type: 'Thing', page: ['A courier from the north'], aliases: ['the courier'] },
          { name: 'Zed', type: 'Thing', page: ['A stranger'], aliases: [] },
        ],
      }),
      'm1',
    );
    expect(report.created).toEqual(['Tam']);
    expect(findEntity(vault, 'Zed')).toBeUndefined();
    expect(report.unlinkedNames.map((n) => n.name)).toEqual(['Zed']);
    expect(findEntity(vault, 'the courier')?.name).toBe('Tam');
    // Nothing the scene reveals leaks into the story before it.
    const r = new Resolver(vault);
    const tam = findEntity(vault, 'Tam')!.id;
    expect(r.entityAt(tam, r.atScene('s2')).note).toBe('');
    expect(r.entityAt(tam, r.atScene('s2', true)).note).toBe('- A courier from the north\n');
  });
});

describe('writing to existing pages', () => {
  it('adds only lines the page does not already say, and keeps a claim out of the wiki', () => {
    const v = world('Nora lied: she said she was an orphan.');
    const { vault, report } = applyAgentOutput(
      v,
      's2',
      answer({
        wiki: [
          { entity: 'Nora', lines: ['Nora is a courier', 'Left-handed'], certainty: 'stated' },
          { entity: 'Nora', lines: ['Orphaned at six'], certainty: 'claimed' },
        ],
      }),
      'm1',
    );
    expect(noteAfter(vault, 'Nora', 's2')).toBe('Nora is a courier.\n\n- Left-handed\n');
    expect(report.claimed).toEqual([{ entity: 'Nora', lines: ['Orphaned at six'] }]);
  });

  it('never amends a revision the writer made after the same scene', () => {
    let v = world('Mira smiled.');
    v = commitRevision(v, { entityId: 'mira', anchor: { sceneId: 's2' }, note: 'Mira, in the writer’s words.', before: { note: '', name: 'Mira' } }).vault;
    const { vault, report } = applyAgentOutput(v, 's2', answer({ wiki: [{ entity: 'Mira', lines: ['Smiles often'], certainty: 'stated' }] }), 'm1');
    expect(noteAfter(vault, 'Mira', 's2')).toBe('Mira, in the writer’s words.');
    expect(report.skipped).toHaveLength(1);
  });

  it('replaces its own earlier output when the same scene is read again, instead of stacking', () => {
    const v = world('Nora ran.');
    const first = applyAgentOutput(v, 's2', answer({ wiki: [{ entity: 'Nora', lines: ['Fast runner'], certainty: 'stated' }], states: [{ entity: 'Nora', state: 'out of breath' }] }), 'm1').vault;
    const second = applyAgentOutput(first, 's2', answer({ states: [{ entity: 'Nora', state: 'rested' }] }), 'm1').vault;
    expect(noteAfter(second, 'Nora', 's2')).toBe('Nora is a courier.');
    const r = new Resolver(second);
    expect(r.entityAt('nora', r.atScene('s2', true)).props.state.value).toBe('rested');
    expect(Object.values(second.changes).filter((c) => c.agent)).toHaveLength(1);
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
    expect(applyAgentOutput(v, 's2', answer({ contradictions: [claim] }), 'm1').report.contradictions).toEqual([claim]);
    expect(applyAgentOutput(v, 's2', answer({ contradictions: [{ ...claim, sceneQuote: 'She never held a sword' }] }), 'm1').report.contradictions).toEqual([]);
    expect(applyAgentOutput(v, 's2', answer({ contradictions: [{ ...claim, wikiQuote: 'Nora has two hands' }] }), 'm1').report.contradictions).toEqual([]);
  });

  it('are not raised for a scene the writer has not placed in time', () => {
    const v = withLostHand('She drew the sword with her right hand.');
    v.scenes.s2.someday = true;
    expect(applyAgentOutput(v, 's2', answer({ contradictions: [claim] }), 'm1').report.contradictions).toEqual([]);
  });
});

describe('the scene’s own point in time', () => {
  it('shows a flashback the story as it was then, not as it is now', () => {
    const v = new VaultBuilder().entity('nora', {}, 'Nora').scene('s1').scene('s2').scene('flash').chain('flash', 's1', 's2').build();
    v.scenes.flash.prose = 'Years ago, [[Nora]] laughed.';
    v.changes.c1 = { id: 'c1', sceneId: 's1', entityId: 'nora', op: 'set', property: 'state', value: 'grieving', order: 0 };
    expect(buildContext(v, 'flash')).toContain('Current state: (none recorded)');
    expect(buildContext(v, 's2')).not.toContain('Current state: (none recorded)');
  });
});

describe('reverting a scene’s agent output', () => {
  it('removes what the agent wrote and the pages it made, and keeps everything the writer wrote', () => {
    let v = world('The [[Tam]] arrived.');
    v.changes.mine = { id: 'mine', sceneId: 's2', entityId: 'mira', op: 'set', property: 'status', value: 'waiting', order: 0 };
    v = applyAgentOutput(v, 's2', answer({ newEntities: [{ name: 'Tam', type: 'Thing', page: ['A courier'], aliases: [] }], states: [{ entity: 'Mira', state: 'worried' }] }), 'm1').vault;
    const reverted = revertAgentOutput(v, 's2');
    expect(findEntity(reverted, 'Tam')).toBeUndefined();
    expect(Object.keys(reverted.changes)).toEqual(['mine']);
  });
});
