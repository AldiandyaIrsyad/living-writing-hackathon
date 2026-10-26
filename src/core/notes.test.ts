import { describe, it, expect } from 'vitest';
import { findAuthorNotes, stripAuthorNotes, stripNotes, inAuthorNote } from './notes';

describe('findAuthorNotes', () => {
  it('finds an inline %% note with its exact range and trimmed text', () => {
    expect(findAuthorNotes('a %% x %% b')).toEqual([{ start: 2, end: 9, text: 'x', syntax: 'percent' }]);
  });

  it('finds an inline HTML comment note', () => {
    const text = 'a <!-- y --> b';
    expect(findAuthorNotes(text)).toEqual([{ start: 2, end: 12, text: 'y', syntax: 'html' }]);
    expect(text.slice(2, 12)).toBe('<!-- y -->');
  });

  it('finds a note spanning several lines, keeping inner newlines out of the trimmed text', () => {
    const text = 'before\n%% line one\nline two %%\nafter';
    const [n] = findAuthorNotes(text);
    expect(n.syntax).toBe('percent');
    expect(n.text).toBe('line one\nline two');
    expect(text.slice(n.start, n.end)).toBe('%% line one\nline two %%');
  });

  it('finds a multi-line HTML comment', () => {
    const text = '<!--\nTODO: reorder\nthis scene\n-->';
    const notes = findAuthorNotes(text);
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('TODO: reorder\nthis scene');
    expect(notes[0].syntax).toBe('html');
  });

  it('finds several notes per line, in order, of both syntaxes', () => {
    const text = '%% a %% and <!-- b --> and %% c %%';
    const notes = findAuthorNotes(text);
    expect(notes.map((n) => n.text)).toEqual(['a', 'b', 'c']);
    expect(notes.map((n) => n.syntax)).toEqual(['percent', 'html', 'percent']);
    expect(notes[0].end).toBeLessThanOrEqual(notes[1].start);
    expect(notes[1].end).toBeLessThanOrEqual(notes[2].start);
  });

  it('ignores an unclosed %% marker', () => {
    expect(findAuthorNotes('start %% never closed')).toEqual([]);
  });

  it('ignores an unclosed HTML comment', () => {
    expect(findAuthorNotes('start <!-- never closed')).toEqual([]);
  });

  it('ignores a closing HTML comment marker with no opener', () => {
    expect(findAuthorNotes('plain --> text')).toEqual([]);
  });

  it('finds empty notes, with empty text', () => {
    expect(findAuthorNotes('%%%%')).toEqual([{ start: 0, end: 4, text: '', syntax: 'percent' }]);
    expect(findAuthorNotes('x <!---->')).toEqual([{ start: 2, end: 9, text: '', syntax: 'html' }]);
    expect(findAuthorNotes('%%  %%')[0].text).toBe('');
  });

  it('keeps `%%` inside an HTML comment as part of that comment', () => {
    const notes = findAuthorNotes('<!-- 50%% off -->');
    expect(notes).toEqual([{ start: 0, end: 17, text: '50%% off', syntax: 'html' }]);
  });

  it('returns no notes for text without markers', () => {
    expect(findAuthorNotes('')).toEqual([]);
    expect(findAuthorNotes('Plain prose with a [[link]] and #tag.')).toEqual([]);
  });
});

describe('stripAuthorNotes', () => {
  it('returns text without notes unchanged', () => {
    const text = 'Line one.\n\n  Indented   line with spaces.  \n';
    expect(stripAuthorNotes(text)).toBe(text);
  });

  it('removes a note that occupies its own line, including the line break', () => {
    expect(stripAuthorNotes('Para one.\n%% todo %%\nPara two.')).toBe('Para one.\nPara two.');
  });

  it('removes a whole-line note that is the last line of the text', () => {
    expect(stripAuthorNotes('a\n%% x %%')).toBe('a\n');
  });

  it('removes a multi-line note occupying its own lines', () => {
    expect(stripAuthorNotes('a\n%% x\ny\n%%\nb')).toBe('a\nb');
  });

  it('removes a whole-line note but keeps the surrounding blank line', () => {
    expect(stripAuthorNotes('a\n\n<!-- later -->\n\nb')).toBe('a\n\n\nb');
  });

  it('collapses the double space around an inline note', () => {
    expect(stripAuthorNotes('a %% x %% b')).toBe('a b');
    expect(stripAuthorNotes('a  %% x %%  b')).toBe('a b');
  });

  it('joins text directly when an inline note has no spaces around it', () => {
    expect(stripAuthorNotes('a%%x%%b')).toBe('ab');
  });

  it('drops the spaces after a note at the start of a line', () => {
    expect(stripAuthorNotes('%% x %% b')).toBe('b');
  });

  it('drops the spaces before a note at the end of a line', () => {
    expect(stripAuthorNotes('a %% x %%\nb')).toBe('a\nb');
  });

  it('handles two inline notes on one line', () => {
    expect(stripAuthorNotes('a %% x %% b %% y %% c')).toBe('a b c');
  });

  it('collapses an inline note that spans lines', () => {
    expect(stripAuthorNotes('x %% a\nb %% y')).toBe('x y');
  });

  it('keeps paragraph breaks after an end-of-line note', () => {
    expect(stripAuthorNotes('a %% x %%\n\nb')).toBe('a\n\nb');
  });

  it('removes only the notes given to stripNotes', () => {
    const text = '%% keep? %% one %% two %%';
    const notes = findAuthorNotes(text);
    expect(stripNotes(text, [notes[1]])).toBe('%% keep? %% one');
  });
});

describe('inAuthorNote', () => {
  const text = 'ab %% x %% cd <!-- y -->';
  const notes = findAuthorNotes(text);

  it('is true for positions inside a note, including its opening marker', () => {
    expect(inAuthorNote(notes, 3)).toBe(true);
    expect(inAuthorNote(notes, 7)).toBe(true);
    expect(inAuthorNote(notes, 16)).toBe(true);
  });

  it('is false at the exclusive end and outside notes', () => {
    expect(inAuthorNote(notes, 2)).toBe(false);
    expect(inAuthorNote(notes, 9)).toBe(true);
    expect(inAuthorNote(notes, 10)).toBe(false);
    expect(inAuthorNote(notes, 0)).toBe(false);
    expect(inAuthorNote(notes, text.length)).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(inAuthorNote([], 3)).toBe(false);
  });
});

describe('// line notes', () => {
  it('runs from the // at the start of a line to the end of that line', () => {
    expect(findAuthorNotes('// todo\nnext')).toEqual([{ start: 0, end: 7, text: 'todo', syntax: 'line' }]);
  });

  it('starts at a // preceded by whitespace in the middle of a line', () => {
    const text = 'Line one. // fix this\nLine two';
    expect(findAuthorNotes(text)).toEqual([{ start: 10, end: 21, text: 'fix this', syntax: 'line' }]);
    expect(text.slice(10, 21)).toBe('// fix this');
  });

  it('accepts an indented // at the start of a line', () => {
    expect(findAuthorNotes('a\n    // x')[0]).toMatchObject({ start: 6, text: 'x', syntax: 'line' });
  });

  it('is not a note when the // follows a non-space character, so URLs are not notes', () => {
    expect(findAuthorNotes('see https://example.com/a for maps')).toEqual([]);
    expect(findAuthorNotes('file:///tmp/x and http://x')).toEqual([]);
    expect(findAuthorNotes('a//b and (//cdn)')).toEqual([]);
  });

  it('is a note only after the URL when a real // comes later on the line', () => {
    const notes = findAuthorNotes('https://x.com // check the link');
    expect(notes.map((n) => [n.text, n.syntax])).toEqual([['check the link', 'line']]);
  });

  it('keeps a bare // as an empty note', () => {
    expect(findAuthorNotes('//')).toEqual([{ start: 0, end: 2, text: '', syntax: 'line' }]);
  });

  it('treats a // inside a %% note as content of that note', () => {
    expect(findAuthorNotes('%% a // b %%')).toEqual([{ start: 0, end: 12, text: 'a // b', syntax: 'percent' }]);
  });

  it('treats a // inside an HTML comment as content of that comment', () => {
    expect(findAuthorNotes('<!-- x // y -->')).toEqual([{ start: 0, end: 15, text: 'x // y', syntax: 'html' }]);
  });

  it('treats %% after a // on the same line as part of the line note', () => {
    const notes = findAuthorNotes('// a %% b\nc %% d %%');
    expect(notes.map((n) => [n.text, n.syntax])).toEqual([
      ['a %% b', 'line'],
      ['d', 'percent'],
    ]);
  });

  it('lets a line note end at the line break, so the next line is prose', () => {
    const notes = findAuthorNotes('// one\ntwo %% three %%');
    expect(notes[0]).toMatchObject({ text: 'one', end: 6 });
    expect(notes[1]).toMatchObject({ text: 'three', syntax: 'percent' });
  });

  it('finds a // note after an unclosed %% marker, since the marker is not a note', () => {
    expect(findAuthorNotes('start %% open // x')).toEqual([{ start: 14, end: 18, text: 'x', syntax: 'line' }]);
  });
});

describe('stripAuthorNotes with // notes', () => {
  it('removes a whole-line // note including its line break', () => {
    expect(stripAuthorNotes('Para one.\n// todo\nPara two.')).toBe('Para one.\nPara two.');
  });

  it('removes an indented whole-line // note', () => {
    expect(stripAuthorNotes('a\n   // indented\nb')).toBe('a\nb');
  });

  it('removes a whole-line // note at the end of the text', () => {
    expect(stripAuthorNotes('a\n// last')).toBe('a\n');
  });

  it('removes a trailing // note and the spaces before it', () => {
    expect(stripAuthorNotes('Line one. // fix this\nLine two')).toBe('Line one.\nLine two');
    expect(stripAuthorNotes('a // x')).toBe('a');
  });

  it('keeps paragraph breaks after a trailing // note', () => {
    expect(stripAuthorNotes('a // x\n\nb')).toBe('a\n\nb');
  });

  it('leaves URLs alone', () => {
    const text = 'See https://example.com/page for more.';
    expect(stripAuthorNotes(text)).toBe(text);
    expect(stripAuthorNotes('http://x.com // note')).toBe('http://x.com');
  });

  it('keeps a // inside a %% note in the note, and removes the note whole', () => {
    expect(stripAuthorNotes('a %% b // c %% d')).toBe('a d');
  });
});
