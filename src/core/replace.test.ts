import { describe, expect, it } from 'vitest';
import { findMatches, replaceMatches, type FindOptions, type Match } from './replace';
import { VaultBuilder } from './testkit';
import type { Vault } from './types';

const base: FindOptions = { query: '', regex: false, caseSensitive: false, wholeWord: false, includeNotes: false, scope: { prose: true, entityNotes: true, revisions: true } };

function vaultWith(prose: string, extra?: (v: Vault) => void): Vault {
  const v = new VaultBuilder().entity('norman', {}, 'Norman').scene('a').build();
  v.scenes.a = { ...v.scenes.a, prose };
  extra?.(v);
  return v;
}

/** Finds with the options and replaces every match, returning the new prose of scene a. */
function change(prose: string, find: Partial<FindOptions>, replacement: string, replace: { regex?: boolean; preserveCase?: boolean } = {}): string {
  const v = vaultWith(prose);
  const found = findMatches(v, { ...base, ...find });
  if (!found.ok) throw new Error(found.error);
  return replaceMatches(v, found.matches, replacement, { regex: replace.regex ?? !!find.regex, preserveCase: replace.preserveCase ?? false }).scenes.a.prose;
}

describe('findMatches and replaceMatches', () => {
  it('takes regex special characters literally unless regex mode is on', () => {
    expect(change('cost (a+b)* is a.b', { query: '(a+b)*' }, 'X')).toBe('cost X is a.b');
    expect(change('cost (a+b)* is a.b', { query: 'a.b' }, 'X')).toBe('cost (a+b)* is X');
    expect(change('a1b a22b', { query: String.raw`a\d+b`, regex: true }, 'X')).toBe('X X');
  });

  it('never loops on a regex that can match nothing, and ignores the empty matches', () => {
    expect(change('xx y xxx', { query: 'x*', regex: true }, '-')).toBe('- y -');
  });

  it('leaves link targets alone but changes the words a link shows', () => {
    expect(change('Norman met [[Norman]] and [[norman|Norman]] and [[Norman#Bio|the Norman]].', { query: 'Norman' }, 'Bob')).toBe('Bob met [[Norman]] and [[norman|Bob]] and [[Norman#Bio|the Bob]].');
  });

  it('leaves code, frontmatter and author notes alone, and author notes only change when asked', () => {
    const prose = '---\ntitle: Norman\n---\nNorman `Norman` %% Norman %%\n```\nNorman\n```\nNorman';
    expect(change(prose, { query: 'Norman' }, 'Bob')).toBe('---\ntitle: Norman\n---\nBob `Norman` %% Norman %%\n```\nNorman\n```\nBob');
    expect(change(prose, { query: 'Norman', includeNotes: true }, 'Bob')).toBe('---\ntitle: Norman\n---\nBob `Norman` %% Bob %%\n```\nNorman\n```\nBob');
  });

  it('whole word means whole word, in any script', () => {
    expect(change('cat concatenate cat_x cat. 猫 über', { query: 'cat', wholeWord: true }, 'dog')).toBe('dog concatenate cat_x dog. 猫 über');
    expect(change('über überall', { query: 'über', wholeWord: true }, 'x')).toBe('x überall');
  });

  it('matches a query that spans lines, in LF and Windows (CRLF) documents alike', () => {
    expect(change('one\ntwo\nthree', { query: 'one\ntwo' }, '1 2')).toBe('1 2\nthree');
    expect(change('one\r\ntwo\r\nthree', { query: 'one\ntwo' }, '1 2')).toBe('1 2\r\nthree');
  });

  it('treats the replacement as plain text unless regex mode, where $& and $1 work', () => {
    expect(change('price', { query: 'price' }, 'cost $& $1 $$')).toBe('cost $& $1 $$');
    expect(change('price list', { query: '(pri)ce', regex: true }, '[$1|$&|$$|$9]')).toBe('[pri|price|$|$9] list');
  });

  it('folds case the way the language engine does: ß and ẞ are one letter, ss is not ß', () => {
    expect(change('STRAẞE straße strasse', { query: 'straße' }, 'x')).toBe('x x strasse');
    expect(change('Norman NORMAN norman', { query: 'norman', caseSensitive: true }, 'x')).toBe('Norman NORMAN x');
  });

  it('can keep capitalisation for a one-word replacement, and not for a phrase', () => {
    expect(change('Norman NORMAN norman', { query: 'norman' }, 'bob', { preserveCase: true })).toBe('Bob BOB bob');
    expect(change('Norman', { query: 'norman' }, 'old bob', { preserveCase: true })).toBe('old bob');
  });

  it('reports a bad regular expression instead of throwing', () => {
    const found = findMatches(vaultWith('x'), { ...base, query: '(', regex: true });
    expect(found.ok).toBe(false);
    expect(findMatches(vaultWith('x'), { ...base, query: '' }).ok).toBe(false);
  });

  it('searches and changes only the chosen places, and replaces only the chosen matches', () => {
    const v = vaultWith('mountain peak', (vv) => {
      vv.entities.norman = { ...vv.entities.norman, note: 'A mountain man.' };
      vv.changes.r = { id: 'r', entityId: 'norman', sceneId: 'a', op: 'revise', order: 1, note: 'Now on the mountain.' };
    });
    const all = findMatches(v, { ...base, query: 'mountain' });
    if (!all.ok) throw new Error();
    expect(all.matches.map((m) => m.field).sort()).toEqual(['entity-note', 'prose', 'revision-note']);
    const proseOnly = findMatches(v, { ...base, query: 'mountain', scope: { prose: true, entityNotes: false, revisions: false } });
    if (!proseOnly.ok) throw new Error();
    expect(proseOnly.matches).toHaveLength(1);

    const picked: Match[] = all.matches.filter((m) => m.field !== 'prose');
    const next = replaceMatches(v, picked, 'hill', { regex: false, preserveCase: false });
    expect(next.scenes.a.prose).toBe('mountain peak');
    expect(next.scenes).toBe(v.scenes); // untouched documents are the same objects
    expect(next.entities.norman.note).toBe('A hill man.');
    expect(next.changes.r.note).toBe('Now on the hill.');
    expect(v.entities.norman.note).toBe('A mountain man.'); // the original is not changed: undo restores it exactly
  });

  it('skips a match whose text has changed since it was found, and returns the same vault when nothing applies', () => {
    const v = vaultWith('mountain');
    const found = findMatches(v, { ...base, query: 'mountain' });
    if (!found.ok) throw new Error();
    const edited = vaultWith('hillside');
    expect(replaceMatches(edited, found.matches, 'x', { regex: false, preserveCase: false })).toBe(edited);
  });

  it('gives a line of context around each match', () => {
    const found = findMatches(vaultWith('first line\nthe grey mountains rise\nlast'), { ...base, query: 'grey mountains' });
    if (!found.ok) throw new Error();
    expect([found.matches[0].before, found.matches[0].text, found.matches[0].after]).toEqual(['the ', 'grey mountains', ' rise']);
  });
});
