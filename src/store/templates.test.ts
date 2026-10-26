import { describe, expect, it } from 'vitest';
import { VaultBuilder } from '../core/testkit';
import { expandTemplate, saveAsTemplate, templatesOf, templateValues } from './templates';

describe('expandTemplate', () => {
  it('fills the placeholders whatever the case or spacing, and empties one that has no value', () => {
    expect(expandTemplate('# {{title}} / {{ Story }} / {{CHAPTER}}!', { title: 'The Fall', story: 'Ashford' })).toBe('# The Fall / Ashford / !');
  });

  it('leaves braces that are not placeholders exactly as typed', () => {
    const text = 'json {"a": {"b": 1}} {{unknown}} {{ }} {title} {{title';
    expect(expandTemplate(text, { title: 'X' })).toBe(text);
  });

  it('keeps a placeholder literally when it is escaped with a backslash', () => {
    expect(expandTemplate(String.raw`Use \{{title}} for {{title}}.`, { title: 'X' })).toBe('Use {{title}} for X.');
  });

  it('inserts values as they are: never expanded again, and "$&" is just text', () => {
    expect(expandTemplate('{{title}} {{cast}}', { title: '{{cast}}', cast: '$& $1' })).toBe('{{cast}} $& $1');
  });
});

describe('templateValues', () => {
  it('describes the scene: its title, story, chapter and cast as links, and today', () => {
    const v = new VaultBuilder().entity('norman', {}, 'Norman').entity('alice', {}, 'Alice').scene('a').build();
    v.stories.s = { ...v.stories.s, name: 'Ashford' };
    v.chapters.c = { id: 'c', storyId: 's', title: 'Chapter 1', order: 0 };
    v.scenes.a = { ...v.scenes.a, title: 'The Fall', chapterId: 'c', prose: 'Then [[norman]] met [[Alice|her]].' };
    expect(templateValues(v, 'a', new Date(2026, 9, 5))).toEqual({
      title: 'The Fall',
      story: 'Ashford',
      chapter: 'Chapter 1',
      cast: '[[Norman]], [[Alice]]',
      date: '2026-10-05',
    });
  });
});

describe('saveAsTemplate', () => {
  it('adds the Template type on first use only, and numbers a name that is taken', () => {
    const v = new VaultBuilder().scene('a').build();
    const first = saveAsTemplate(v, 'Battle', '## {{title}}\n');
    const second = saveAsTemplate(first.vault, 'battle', 'other');
    const types = Object.values(second.vault.entityTypes).filter((t) => t.name === 'Template');
    expect(types).toHaveLength(1);
    expect(templatesOf(second.vault).map((e) => [e.name, e.note])).toEqual([
      ['Battle', '## {{title}}\n'],
      ['battle 2', 'other'],
    ]);
    expect(templatesOf(v)).toEqual([]);
  });
});
