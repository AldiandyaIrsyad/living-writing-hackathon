// CodeMirror pieces for the chapter editor: an anchor on each scene's heading that follows edits, and a divider
// above every scene heading.

import { MapMode, RangeSetBuilder, StateEffect, StateField, type EditorState } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { parseChapterText, type Anchor } from '../../core/chapterDoc';
import type { Id } from '../../core/types';

/** Replaces the anchors (after the document was written to the vault, or replaced). */
export const setAnchors = StateEffect.define<Anchor[]>();

/**
 * Where each scene's heading starts. An anchor sticks to the `#` after it: it moves with edits before it and
 * becomes null when that character is deleted, which is how a deleted heading is noticed.
 */
export const anchorField = StateField.define<Anchor[]>({
  create: () => [],
  update(anchors, tr) {
    for (const e of tr.effects) if (e.is(setAnchors)) return e.value;
    if (!tr.docChanged) return anchors;
    return anchors.map((a) => {
      if (a.pos === null) return a;
      // The lead scene's anchor stays at the start of the document; a heading's sticks to its `#`.
      if (a.lead) return { ...a, pos: tr.changes.mapPos(a.pos, -1) };
      return { id: a.id, pos: tr.changes.mapPos(a.pos, 1, MapMode.TrackAfter) };
    });
  },
});

export function anchorsOf(state: EditorState): Anchor[] {
  return state.field(anchorField, false) ?? [];
}

/** The scene a position belongs to: the one whose heading is the last at or before it (the first scene above all). */
export function sceneAtPos(state: EditorState, pos: number): Id | undefined {
  const anchors = anchorsOf(state);
  let best: Anchor | undefined;
  for (const a of anchors) {
    if (a.pos !== null && a.pos <= pos && (best === undefined || a.pos >= (best.pos ?? 0))) best = a;
  }
  return (best ?? anchors.find((a) => a.pos !== null))?.id;
}

/** Where a scene's heading line starts, or undefined when it has no anchor. */
export function sceneStart(state: EditorState, id: Id): number | undefined {
  return anchorsOf(state).find((a) => a.id === id)?.pos ?? undefined;
}

/** A rule above each scene heading but the first. A block widget, because CodeMirror measures lines by their own height: margins or padding on the heading line would throw clicks off by a line. */
class SceneDivider extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cm-scene-divider';
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
  get estimatedHeight(): number {
    return 40;
  }
}

const DIVIDER = Decoration.widget({ widget: new SceneDivider(), block: true, side: -1 });

function dividers(text: string): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const sec of parseChapterText(text)) if (sec.hasHeading && sec.from > 0) b.add(sec.from, sec.from, DIVIDER);
  return b.finish();
}

const sceneDividers = StateField.define<DecorationSet>({
  create: (state) => dividers(state.doc.toString()),
  update: (value, tr) => (tr.docChanged ? dividers(tr.state.doc.toString()) : value),
  provide: (f) => EditorView.decorations.from(f),
});

const sceneTheme = EditorView.baseTheme({
  '.cm-scene-divider': { height: '40px', display: 'flex', alignItems: 'center' },
  '.cm-scene-divider::before': { content: '""', flex: '1', height: '1px', background: 'var(--border)' },
});

/** Everything a chapter editor needs besides the shared markdown editor. */
export const chapterExtensions = [anchorField, sceneDividers, sceneTheme];
