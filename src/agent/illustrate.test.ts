import { describe, expect, it } from 'vitest';
import { VaultBuilder } from '../core/testkit';
import { composePrompt, parseDraft, pickCast, scenePages, STYLES } from './illustrate';

describe('parseDraft', () => {
  it('reads the JSON the prompt asks for, even inside a code fence, and keeps only text lists', () => {
    const reply = '```json\n{"description":"Two friends laugh in a café.","caption":"Coffee","characters":["Ann",7,"Bob"]}\n```';
    expect(parseDraft(reply)).toEqual({ description: 'Two friends laugh in a café.', caption: 'Coffee', characters: ['Ann', 'Bob'] });
  });

  it('turns a reply that is not JSON into a description the writer can still edit', () => {
    expect(parseDraft('Just draw them at the café.')).toEqual({ description: 'Just draw them at the café.', caption: '', characters: [] });
    expect(parseDraft('{"description": ""}').description).toBe('{"description": ""}');
  });
});

describe('composePrompt', () => {
  it('names each reference picture in the order they are sent, so every person keeps their own face', () => {
    const prompt = composePrompt(STYLES[0], [{ name: 'Norman' }, { name: 'Alice' }], 'They drink coffee.');
    expect(prompt).toContain('1 is Norman; 2 is Alice');
    expect(prompt.indexOf(STYLES[0].prompt)).toBe(0);
    expect(prompt).toContain('They drink coffee.');
  });

  it('says nothing about references when there are none', () => {
    expect(composePrompt(STYLES[0], [], 'A road.')).not.toContain('reference');
  });
});

describe('what the model is shown for an illustration', () => {
  it('is the pages of those named in the text so far, not of everyone in the vault', () => {
    const v = new VaultBuilder().entity('ann', {}, 'Ann Vale').entity('bob', {}, 'Bob Reed').scene('s1').build();
    v.scenes.s1.prose = '[[Ann Vale]] walked in.';
    const { entities, text } = scenePages(v, 's1', 'Ann Vale walked in.');
    expect(entities.map((e) => e.name)).toEqual(['Ann Vale']);
    expect(text).toContain('Ann Vale');
    expect(text).not.toContain('Bob Reed');
  });

  it('keeps the people the model named, in its order, and ignores names that are not pages', () => {
    const v = new VaultBuilder().entity('ann', {}, 'Ann').entity('bob', {}, 'Bob').build();
    const cast = pickCast(Object.values(v.entities), ['bob', 'Nobody', 'ANN', 'Bob']);
    expect(cast.map((e) => e.name)).toEqual(['Bob', 'Ann']);
  });
});
