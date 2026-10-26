// Formatting commands for the markdown editor: wrap the selection in inline markers, toggle a block prefix on the
// touched lines, and wrap it in an author note. Pure functions of an EditorState (so they run without a DOM), plus
// thin `(view) => boolean` wrappers for keymaps and the bubble toolbar.

import { EditorSelection, type ChangeSpec, type EditorState, type SelectionRange, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { findAuthorNotesOutsideCode } from '../../core/links';

export type InlineKind = 'bold' | 'italic' | 'strike' | 'code' | 'link';
export type BlockKind = 'h2' | 'h3' | 'quote' | 'list';

const INLINE: Record<InlineKind, readonly [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  strike: ['~~', '~~'],
  code: ['`', '`'],
  link: ['[[', ']]'],
};

interface Span {
  from: number;
  to: number;
}

/**
 * The pieces of a range that get their own markers: one per non-blank line, trimmed, because `**word **` is not
 * bold. An empty range is itself one empty piece (the caret).
 */
function piecesOf(state: EditorState, range: SelectionRange): Span[] {
  if (range.empty) return [{ from: range.from, to: range.to }];
  const out: Span[] = [];
  let pos = range.from;
  while (pos <= range.to) {
    const line = state.doc.lineAt(pos);
    const from = Math.max(line.from, range.from);
    const to = Math.min(line.to, range.to);
    const text = state.sliceDoc(from, to);
    const lead = text.length - text.trimStart().length;
    if (lead < text.length) out.push({ from: from + lead, to: to - (text.length - text.trimEnd().length) });
    pos = line.to + 1;
  }
  return out;
}

/** How many `*` sit in a row around a marker: `**x**` is 2 at each end, `***x***` is 3. */
function starRun(state: EditorState, marker: Span): number {
  let from = marker.from;
  let to = marker.to;
  while (from > 0 && state.sliceDoc(from - 1, from) === '*') from--;
  while (to < state.doc.length && state.sliceDoc(to, to + 1) === '*') to++;
  return to - from;
}

/**
 * The two marker spans to delete when `piece` is already wrapped in `open`/`close`, or null. The markers may sit
 * just outside the piece (a word inside `**word**`) or be part of it (`**word**` selected whole).
 */
function wrappedBy(state: EditorState, piece: Span, open: string, close: string): [Span, Span] | null {
  const end = state.doc.length;
  const outside =
    state.sliceDoc(Math.max(0, piece.from - open.length), piece.from) === open && state.sliceDoc(piece.to, Math.min(end, piece.to + close.length)) === close;
  let left: Span;
  let right: Span;
  if (outside) {
    left = { from: piece.from - open.length, to: piece.from };
    right = { from: piece.to, to: piece.to + close.length };
  } else if (
    piece.to - piece.from >= open.length + close.length &&
    state.sliceDoc(piece.from, piece.from + open.length) === open &&
    state.sliceDoc(piece.to - close.length, piece.to) === close
  ) {
    left = { from: piece.from, to: piece.from + open.length };
    right = { from: piece.to - close.length, to: piece.to };
  } else {
    return null;
  }
  // `*` is both italic (one) and bold (two): italic needs an odd run, bold at least two.
  if (open === close && open[0] === '*') {
    const run = Math.min(starRun(state, left), starRun(state, right));
    if (open.length === 1 ? run % 2 === 0 : run < 2) return null;
  }
  return [left, right];
}

/** Whether the main selection is already wrapped in this kind of marker (the bubble lights the button). */
export function inlineActive(state: EditorState, kind: InlineKind): boolean {
  const [open, close] = INLINE[kind];
  const pieces = piecesOf(state, state.selection.main);
  return pieces.length > 0 && pieces.every((p) => wrappedBy(state, p, open, close) !== null);
}

/** Toggles bold/italic/…: wraps every selected line in the markers, or takes them off when all are wrapped. */
export function inlineSpec(state: EditorState, kind: InlineKind): TransactionSpec | null {
  const [open, close] = INLINE[kind];
  const all = state.selection.ranges.flatMap((r) => piecesOf(state, r));
  if (all.length === 0) return null;
  const unwrap = all.every((p) => wrappedBy(state, p, open, close) !== null);
  const result = state.changeByRange((range) => {
    const pieces = piecesOf(state, range);
    if (pieces.length === 0) return { range };
    if (!unwrap && range.empty) {
      return { changes: { from: range.from, insert: open + close }, range: EditorSelection.cursor(range.from + open.length) };
    }
    const changes: ChangeSpec[] = [];
    for (const p of pieces) {
      const markers = unwrap ? wrappedBy(state, p, open, close) : null;
      if (markers) changes.push({ from: markers[0].from, to: markers[0].to }, { from: markers[1].from, to: markers[1].to });
      else changes.push({ from: p.from, insert: open }, { from: p.to, insert: close });
    }
    const cs = state.changes(changes);
    return { changes: cs, range: EditorSelection.range(cs.mapPos(pieces[0].from, 1), cs.mapPos(pieces[pieces.length - 1].to, -1)) };
  });
  return { ...result, scrollIntoView: true, userEvent: 'input.format' };
}

interface BlockDef {
  /** Any prefix of this family a line may already have (replaced when switching, e.g. H2 to H3). */
  family: RegExp;
  /** The prefix that means "this kind is on". */
  same: RegExp;
  prefix: string;
  /** Lines never touched: `# ` is a scene heading in a chapter, so a heading button must leave it be. */
  skip?: RegExp;
}

const BLOCKS: Record<BlockKind, BlockDef> = {
  h2: { family: /^#{2,6} /, same: /^## /, prefix: '## ', skip: /^# / },
  h3: { family: /^#{2,6} /, same: /^### /, prefix: '### ', skip: /^# / },
  quote: { family: /^> ?/, same: /^> ?/, prefix: '> ' },
  list: { family: /^[-*+] /, same: /^[-*+] /, prefix: '- ' },
};

/** The non-blank lines the selection touches that a block kind may change. */
function blockLines(state: EditorState, kind: BlockKind, ranges: readonly SelectionRange[]) {
  const def = BLOCKS[kind];
  const seen = new Set<number>();
  const out = [];
  for (const r of ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      if (line.text.trim() !== '' && !(def.skip && def.skip.test(line.text))) out.push(line);
    }
  }
  return out;
}

export function blockActive(state: EditorState, kind: BlockKind): boolean {
  const lines = blockLines(state, kind, [state.selection.main]);
  return lines.length > 0 && lines.every((l) => BLOCKS[kind].same.test(l.text));
}

/** Toggles a heading/quote/list prefix on every touched line: set it, switch to it, or remove it when all have it. */
export function blockSpec(state: EditorState, kind: BlockKind): TransactionSpec | null {
  const def = BLOCKS[kind];
  const lines = blockLines(state, kind, state.selection.ranges);
  if (lines.length === 0) return null;
  const off = lines.every((l) => def.same.test(l.text));
  const changes: ChangeSpec[] = [];
  for (const line of lines) {
    const existing = def.family.exec(line.text);
    if (off) changes.push({ from: line.from, to: line.from + existing![0].length });
    else if (!existing) changes.push({ from: line.from, insert: def.prefix });
    else if (!def.same.test(line.text)) changes.push({ from: line.from, to: line.from + existing[0].length, insert: def.prefix });
  }
  const cs = state.changes(changes);
  return { changes: cs, selection: state.selection.map(cs, 1), scrollIntoView: true, userEvent: 'input.format' };
}

export function toggleInline(view: EditorView, kind: InlineKind): boolean {
  const spec = inlineSpec(view.state, kind);
  if (spec) view.dispatch(spec);
  return true;
}

export function toggleBlock(view: EditorView, kind: BlockKind): boolean {
  const spec = blockSpec(view.state, kind);
  if (spec) view.dispatch(spec);
  return true;
}

/**
 * Ctrl+/ : wraps the selection in a note, inserts a note at the end of the line (or at the start of an
 * empty line) with the cursor inside, or unwraps the note the selection/cursor is in.
 */
export function toggleAuthorNote(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  const notes = findAuthorNotesOutsideCode(state.doc.toString());
  const current = notes.find((n) => (sel.empty ? sel.from > n.start && sel.from < n.end : sel.from >= n.start && sel.to <= n.end));
  if (current) {
    view.dispatch({
      changes: { from: current.start, to: current.end, insert: current.text },
      selection: { anchor: current.start, head: current.start + current.text.length },
      userEvent: 'input',
    });
    return true;
  }
  if (sel.empty) {
    const line = state.doc.lineAt(sel.from);
    if (line.text.trim() === '') {
      view.dispatch({
        changes: { from: line.from, insert: '// ' },
        selection: { anchor: line.from + 3 },
        userEvent: 'input',
      });
    } else {
      view.dispatch({
        changes: { from: line.to, insert: ' // ' },
        selection: { anchor: line.to + 4 },
        userEvent: 'input',
      });
    }
    return true;
  }
  const selected = state.sliceDoc(sel.from, sel.to);
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: `%% ${selected} %%` },
    selection: { anchor: sel.from + 3, head: sel.from + 3 + selected.length },
    userEvent: 'input',
  });
  return true;
}
