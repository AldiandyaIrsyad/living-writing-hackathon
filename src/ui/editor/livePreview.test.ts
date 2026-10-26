import { markdown } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { liveMarks } from './livePreview';

/** The text each hidden/restyled span covers, for a document whose lines containing `cursorAt` are being edited. */
function marks(doc: string, cursorAt?: string) {
  const state = EditorState.create({ doc, extensions: [markdown()] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const active = cursorAt === undefined ? [] : [state.doc.lineAt(doc.indexOf(cursorAt))].map((l) => ({ from: l.from, to: l.to }));
  return liveMarks(state, active)
    .sort((a, b) => a.from - b.from)
    .map((m) => `${m.kind}:${doc.slice(m.from, m.to)}`);
}

describe('live preview markers', () => {
  it('hides the markers of every line the cursor is not on', () => {
    expect(marks('# Title\n\nsome **bold** and *it* text')).toEqual(['hide:# ', 'hide:**', 'hide:**', 'hide:*', 'hide:*']);
  });

  it('shows the markers again on the line being edited, and only there', () => {
    expect(marks('# Title\n\nsome **bold** text', 'some')).toEqual(['hide:# ']);
    expect(marks('# Title\n\nsome **bold** text', 'Title')).toEqual(['hide:**', 'hide:**']);
  });

  it('hides quote marks but keeps the quote styled on every quoted line', () => {
    expect(marks('> one\n> two')).toEqual(['quote-line:', 'hide:> ', 'quote-line:', 'hide:> ']);
    expect(marks('> one\n> two', 'one')).toEqual(['quote-line:', 'quote-line:', 'hide:> ']);
  });

  it('draws bullets for "-" and "*" lists but leaves numbers alone', () => {
    expect(marks('- one\n* two\n1. three')).toEqual(['bullet:-', 'bullet:*']);
  });

  it('hides the brackets and address of a markdown link, not a [[wikilink]]', () => {
    expect(marks('see [the map](http://x.y "t") now')).toEqual(['link:[the map](http://x.y "t")', 'hide:[', 'hide:]', 'hide:(', 'hide:http://x.y', 'hide:"t"', 'hide:)']);
    expect(marks('see [[Mara]] now')).toEqual([]);
  });

  it('leaves code fences, setext underlines, escaped stars and closing hashes as written', () => {
    expect(marks('```\n**not bold**\n```')).toEqual([]);
    expect(marks('Title\n=====')).toEqual([]);
    expect(marks('2 \\* 3 \\* 4')).toEqual([]);
    expect(marks('## Title ##')).toEqual(['hide:## ']);
  });

  it('hides the backticks of inline code', () => {
    expect(marks('use `npm test` here')).toEqual(['hide:`', 'hide:`']);
  });
});
