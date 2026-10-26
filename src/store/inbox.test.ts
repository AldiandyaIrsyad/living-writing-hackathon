import { describe, expect, it } from 'vitest';
import { VaultBuilder } from '../core/testkit';
import {
  appendCapture,
  clearDoneIdeas,
  inboxCount,
  inboxOf,
  parseIdeas,
  pickRandomIdeaIndex,
  promoteIdeaToCommit,
  promoteIdeaToEntity,
  promoteIdeaToMilestone,
  promoteIdeaToScene,
  removeIdea,
  toggleIdeaDone,
  updateIdeaText,
} from './inbox';

const at = new Date(2026, 9, 22, 9, 5);

describe('appendCapture', () => {
  it('creates the Inbox on the first capture and adds later ones below, oldest first', () => {
    const v = new VaultBuilder().entity('norman').scene('a').build();
    const one = appendCapture(v, 'Norman owes a debt', at);
    const two = appendCapture(one, 'A line of dialogue', new Date(2026, 9, 22, 21, 30), 'The Fall');
    expect(inboxOf(two)!.note).toBe('- 2026-10-22 09:05 Norman owes a debt\n- 2026-10-22 21:30 A line of dialogue (from [[The Fall]])\n');
    expect(inboxCount(two)).toBe(2);
    expect(Object.values(two.entityTypes).filter((t) => t.name === 'Inbox')).toHaveLength(1);
  });

  it('touches nothing else: the original vault, other pages and scenes stay the same objects', () => {
    const v = new VaultBuilder().entity('norman').scene('a').build();
    const next = appendCapture(v, 'idea', at);
    expect(v.entities.inbox).toBeUndefined();
    expect(next.entities.norman).toBe(v.entities.norman);
    expect(next.scenes).toBe(v.scenes);
    expect(appendCapture(next, 'again', at).entities.norman).toBe(v.entities.norman);
  });

  it('keeps a capture to one line, appends after a note with no final newline, and ignores an empty one', () => {
    const v = appendCapture(new VaultBuilder().build(), 'two\nlines\r\n  here', at);
    expect(inboxOf(v)!.note).toBe('- 2026-10-22 09:05 two lines here\n');
    const edited = { ...v, entities: { ...v.entities, [inboxOf(v)!.id]: { ...inboxOf(v)!, note: 'Triaged by hand' } } };
    expect(inboxOf(appendCapture(edited, 'x', at))!.note).toBe('Triaged by hand\n- 2026-10-22 09:05 x\n');
    expect(appendCapture(v, '  \n ', at)).toBe(v);
  });

  it('counts only active bullet lines, so triaging by deleting lines or marking done lowers the count', () => {
    const v = appendCapture(appendCapture(new VaultBuilder().build(), 'a', at), 'b', at);
    const inbox = inboxOf(v)!;
    const trimmed = { ...v, entities: { ...v.entities, [inbox.id]: { ...inbox, note: '## Later\n' + inbox.note.split('\n')[0] + '\n' } } };
    expect(inboxCount(trimmed)).toBe(1);
    expect(inboxCount(new VaultBuilder().build())).toBe(0);
  });
});

describe('Idea Queue operations', () => {
  it('parses timestamps, origin scene links, done checkboxes, and multi-line fenced code blocks', () => {
    const note = [
      '## Queue',
      '- 2026-10-22 09:05 [[Norman@latest]] meets #guild (from [[The Stranger]])',
      '- [x] 2026-10-22 10:00 Already used idea',
      '- 2026-10-22 11:15 Magic formula:',
      '  ```',
      '  mana = cost * 2',
      '  ``` (from [[Tower]])',
    ].join('\n');

    const ideas = parseIdeas(note);
    expect(ideas).toHaveLength(3);
    expect(ideas[0]).toMatchObject({
      index: 0,
      done: false,
      timestamp: '2026-10-22 09:05',
      fromSceneTitle: 'The Stranger',
      text: '[[Norman@latest]] meets #guild',
    });
    expect(ideas[1]).toMatchObject({
      index: 1,
      done: true,
      timestamp: '2026-10-22 10:00',
      text: 'Already used idea',
    });
    expect(ideas[2]).toMatchObject({
      index: 2,
      done: false,
      timestamp: '2026-10-22 11:15',
      fromSceneTitle: 'Tower',
      text: 'Magic formula:\n```\nmana = cost * 2\n```',
    });
  });

  it('toggles done, updates syntax text in place, and clears done ideas while preserving non-bullet notes', () => {
    let v = new VaultBuilder().build();
    v = appendCapture(v, 'First idea [[Norman]]', at, 'Scene 1');
    v = appendCapture(v, 'Second idea #plot', at);
    const inbox = inboxOf(v)!;
    v = { ...v, entities: { ...v.entities, [inbox.id]: { ...inbox, note: `Header note\n${inbox.note}` } } };

    // Mark first idea done: active count drops from 2 to 1
    v = toggleIdeaDone(v, 0, true);
    expect(inboxCount(v)).toBe(1);
    expect(parseIdeas(inboxOf(v)!.note)[0].done).toBe(true);

    // Edit second idea text in place
    v = updateIdeaText(v, 1, 'Updated [[Mira]] idea\nwith second line');
    const parsedAfterEdit = parseIdeas(inboxOf(v)!.note);
    expect(parsedAfterEdit[1].text).toBe('Updated [[Mira]] idea\nwith second line');
    expect(parsedAfterEdit[1].timestamp).toBe('2026-10-22 09:05');

    // Clear done removes only the done item and preserves "Header note"
    v = clearDoneIdeas(v);
    expect(inboxOf(v)!.note.startsWith('Header note\n')).toBe(true);
    expect(parseIdeas(inboxOf(v)!.note)).toHaveLength(1);
    expect(parseIdeas(inboxOf(v)!.note)[0].text).toBe('Updated [[Mira]] idea\nwith second line');

    // Remove remaining idea
    v = removeIdea(v, 0);
    expect(parseIdeas(inboxOf(v)!.note)).toHaveLength(0);
  });

  it('shuffles without repeating the current idea when at least 2 ideas exist', () => {
    expect(pickRandomIdeaIndex([], null)).toBeNull();
    expect(pickRandomIdeaIndex([4], 4)).toBe(4);
    // With candidates [0, 1, 2] and current = 1, pool is [0, 2]
    expect(pickRandomIdeaIndex([0, 1, 2], 1, () => 0)).toBe(0);
    expect(pickRandomIdeaIndex([0, 1, 2], 1, () => 0.99)).toBe(2);
  });

  it('graduates an idea to a Someday scene, Entity, Milestone, or StateChange commit and removes it from the queue', () => {
    let v = new VaultBuilder().entity('norman', { name: 'Norman' }).scene('s1').build();
    v = appendCapture(v, 'Ambush at the ford with [[Norman]]', at);
    v = appendCapture(v, 'The Silver Guild — secret bankers of Ashford', at);
    v = appendCapture(v, 'The Fall of the Bridge', at);
    v = appendCapture(v, 'status = wounded — Arrow at the ford', at);
    expect(inboxCount(v)).toBe(4);

    // 1. Promote to Someday scene
    const sceneRes = promoteIdeaToScene(v, 0)!;
    v = sceneRes.vault;
    expect(v.scenes[sceneRes.sceneId].someday).toBe(true);
    expect(v.scenes[sceneRes.sceneId].prose).toBe('Ambush at the ford with [[Norman]]');
    expect(inboxCount(v)).toBe(3);

    // 2. Promote to Wiki Entity
    const entRes = promoteIdeaToEntity(v, 0, { name: 'Silver Guild' })!;
    v = entRes.vault;
    expect(v.entities[entRes.entityId].name).toBe('Silver Guild');
    expect(v.entities[entRes.entityId].note).toBe('The Silver Guild — secret bankers of Ashford');
    expect(inboxCount(v)).toBe(2);

    // 3. Promote to Standalone Milestone
    const msRes = promoteIdeaToMilestone(v, 0, { concrete: 'Autumn, 2026' });
    expect(msRes.ok).toBe(true);
    if (msRes.ok) {
      v = msRes.vault;
      expect(v.moments[msRes.momentId].labels).toEqual(['The Fall of the Bridge']);
      expect(v.moments[msRes.momentId].concrete).toBe('Autumn, 2026');
    }
    expect(inboxCount(v)).toBe(1);

    // 4. Promote to StateChange Commit
    const chgRes = promoteIdeaToCommit(v, 0, { entityId: 'norman', sceneId: 's1' })!;
    v = chgRes.vault;
    expect(v.changes[chgRes.changeId]).toMatchObject({
      entityId: 'norman',
      sceneId: 's1',
      op: 'set',
      property: 'status',
      value: 'wounded',
      message: 'Arrow at the ford',
    });
    expect(inboxCount(v)).toBe(0);
  });
});

