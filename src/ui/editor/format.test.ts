import { markdown } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { blockActive, blockSpec, inlineActive, inlineSpec, type BlockKind, type InlineKind } from './format';

/** `‹` and `›` mark the selection in the fixture; a single `|` is a caret. The result is shown the same way. */
function stateOf(marked: string): EditorState {
  const open = marked.indexOf('‹');
  const close = marked.indexOf('›');
  if (open >= 0) {
    const text = marked.replace('‹', '').replace('›', '');
    return EditorState.create({ doc: text, selection: EditorSelection.single(open, close - 1), extensions: [markdown()] });
  }
  const caret = marked.indexOf('|');
  return EditorState.create({ doc: marked.replace('|', ''), selection: EditorSelection.cursor(caret), extensions: [markdown()] });
}

function show(state: EditorState, spec: TransactionSpec | null): string {
  if (!spec) return 'NOOP';
  const next = state.update(spec).state;
  const { from, to } = next.selection.main;
  const text = next.doc.toString();
  return from === to ? text.slice(0, from) + '|' + text.slice(from) : text.slice(0, from) + '‹' + text.slice(from, to) + '›' + text.slice(to);
}

const inline = (marked: string, kind: InlineKind) => {
  const s = stateOf(marked);
  return show(s, inlineSpec(s, kind));
};
const block = (marked: string, kind: BlockKind) => {
  const s = stateOf(marked);
  return show(s, blockSpec(s, kind));
};

describe('inline formatting', () => {
  it.each([
    ['bold', 'a ‹word› b', 'a **‹word›** b'],
    ['italic', 'a ‹word› b', 'a *‹word›* b'],
    ['strike', 'a ‹word› b', 'a ~~‹word›~~ b'],
    ['code', 'a ‹word› b', 'a `‹word›` b'],
    ['link', 'met ‹Mara› today', 'met [[‹Mara›]] today'],
  ] as const)('wraps the selection in %s markers and keeps it selected', (kind, before, after) => {
    expect(inline(before, kind)).toBe(after);
  });

  it('is a round trip: applying twice gives the original text and selection', () => {
    for (const kind of ['bold', 'italic', 'strike', 'code', 'link'] as const) {
      const once = stateOf(inline('a ‹word› b', kind));
      expect(show(once, inlineSpec(once, kind))).toBe('a ‹word› b');
    }
  });

  it('unwraps when the markers are inside the selection', () => {
    expect(inline('a ‹**word**› b', 'bold')).toBe('a ‹word› b');
  });

  it('keeps trailing and leading spaces outside the markers', () => {
    expect(inline('a‹ word ›b', 'bold')).toBe('a **‹word›** b');
  });

  it('wraps each line of a multi-line selection on its own, skipping blank lines', () => {
    expect(inline('‹one\n\ntwo›', 'italic')).toBe('*‹one*\n\n*two›*');
  });

  it('puts a caret between the markers when nothing is selected, and removes empty markers again', () => {
    expect(inline('a |b', 'bold')).toBe('a **|**b');
    expect(inline('a **|**b', 'bold')).toBe('a |b');
  });

  it('does nothing when only whitespace is selected', () => {
    expect(inline('a‹ ›b', 'bold')).toBe('NOOP');
  });

  describe('bold and italic share the * character', () => {
    it('italicises bold text instead of mistaking its ** for italic markers', () => {
      expect(inline('‹**word**›', 'italic')).toBe('*‹**word**›*');
      expect(inline('**‹word›**', 'italic')).toBe('***‹word›***');
    });

    it('takes italic off bold+italic text, leaving the bold', () => {
      expect(inline('***‹word›***', 'italic')).toBe('**‹word›**');
      expect(inline('***‹word›***', 'bold')).toBe('*‹word›*');
    });

    it('reports which of the two is on', () => {
      const bold = stateOf('**‹word›**');
      expect(inlineActive(bold, 'bold')).toBe(true);
      expect(inlineActive(bold, 'italic')).toBe(false);
    });
  });
});

describe('block formatting', () => {
  it.each([
    ['h2', 'one', '## one'],
    ['h3', 'one', '### one'],
    ['quote', 'one', '> one'],
    ['list', 'one', '- one'],
  ] as const)('%s: adds the prefix, and a second press takes it off', (kind, line, prefixed) => {
    expect(block(`‹${line}›`, kind)).toBe(`${prefixed.slice(0, -line.length)}‹${line}›`);
    expect(block(`‹${prefixed}›`, kind)).toBe(`‹${line}›`);
  });

  it('switches heading level instead of stacking prefixes', () => {
    expect(block('‹## one›', 'h3')).toBe('‹### one›');
  });

  it('never touches a "# " line, which is a scene heading in a chapter', () => {
    expect(block('‹# Scene›', 'h2')).toBe('NOOP');
    expect(block('‹# Scene\ntext›', 'h2')).toBe('‹# Scene\n## text›');
  });

  it('prefixes every non-blank line it touches and turns off only when all have it', () => {
    expect(block('‹one\n\ntwo›', 'list')).toBe('- ‹one\n\n- two›');
    expect(block('‹- one\ntwo›', 'list')).toBe('‹- one\n- two›');
  });

  it('keeps a caret in the same place relative to the text', () => {
    expect(block('on|e', 'quote')).toBe('> on|e');
    expect(block('|one', 'quote')).toBe('> |one');
  });

  it('reports whether the selected lines already have the prefix', () => {
    expect(blockActive(stateOf('‹> one›'), 'quote')).toBe(true);
    expect(blockActive(stateOf('‹one›'), 'quote')).toBe(false);
  });
});
