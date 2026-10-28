// Live preview: the markdown markers (`#`, `**`, `>`, `[text](url)`…) are hidden, and shown again only on the line(s)
// the cursor or selection is on. The document text never changes; this is decoration only.

import { syntaxTree } from '@codemirror/language';
import { IMAGE_REF } from '../../core/markdown';
import { Facet, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';

/** Where a stored picture (`![caption](img:ID)`) comes from: the editor is given the vault's image store. */
export type ImageLookup = (id: string) => { src: string; ai?: boolean } | undefined;
export const imageLookup = Facet.define<ImageLookup, ImageLookup>({ combine: (all) => all[0] ?? (() => undefined) });

type LiveKind = 'hide' | 'bullet' | 'quote-line' | 'link';

export interface LiveMark {
  from: number;
  to: number;
  kind: LiveKind;
}

interface Span {
  from: number;
  to: number;
}

/**
 * What to hide or restyle. `active` are the spans (whole lines) whose markers stay visible; `within` limits the
 * work to the part of the document on screen.
 */
export function liveMarks(state: EditorState, active: readonly Span[], within: readonly Span[] = [{ from: 0, to: state.doc.length }]): LiveMark[] {
  const out: LiveMark[] = [];
  const isActive = (pos: number) => active.some((a) => pos >= a.from && pos <= a.to);
  const hide = (from: number, to: number) => {
    if (!isActive(from)) out.push({ from, to, kind: 'hide' });
  };
  const spaceAfter = (pos: number) => (state.sliceDoc(pos, pos + 1) === ' ' ? 1 : 0);
  const quoted = new Set<number>();
  for (const span of within) {
    syntaxTree(state).iterate({
      from: span.from,
      to: span.to,
      enter: (node) => {
        const parent = node.node.parent;
        switch (node.name) {
          case 'HeaderMark':
            // Only the leading `#`s of `# Title`; a setext underline or a closing `#` stays as written.
            if (parent?.name.startsWith('ATXHeading') && node.from === state.doc.lineAt(node.from).from) hide(node.from, node.to + spaceAfter(node.to));
            break;
          case 'EmphasisMark':
          case 'StrikethroughMark':
            hide(node.from, node.to);
            break;
          case 'CodeMark':
            if (parent?.name === 'InlineCode') hide(node.from, node.to);
            break;
          case 'QuoteMark':
            hide(node.from, node.to + spaceAfter(node.to));
            break;
          case 'Blockquote':
            for (let n = state.doc.lineAt(node.from).number; n <= state.doc.lineAt(node.to).number; n++) {
              const at = state.doc.line(n).from;
              if (!quoted.has(at)) {
                quoted.add(at);
                out.push({ from: at, to: at, kind: 'quote-line' });
              }
            }
            break;
          case 'ListMark':
            if (parent?.parent?.name === 'BulletList' && !isActive(node.from)) out.push({ from: node.from, to: node.to, kind: 'bullet' });
            break;
          case 'Link':
            // `[[wikilinks]]` have no URL part and keep their own styling.
            if (node.node.getChild('URL')) out.push({ from: node.from, to: node.to, kind: 'link' });
            break;
          case 'LinkMark':
          case 'URL':
          case 'LinkTitle':
            if (parent?.name === 'Link' && parent.getChild('URL')) hide(node.from, node.to);
            break;
        }
      },
    });
  }
  return out;
}

class Bullet extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-bullet';
    el.textContent = '•';
    return el;
  }
}

class InlineImageWidget extends WidgetType {
  constructor(
    readonly alt: string,
    readonly src: string,
    readonly ai = false,
  ) {
    super();
  }
  eq(other: InlineImageWidget): boolean {
    return this.alt === other.alt && this.src === other.src && this.ai === other.ai;
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-inline-image-wrap';
    wrap.setAttribute('data-testid', 'cm-inline-image');

    const img = document.createElement('img');
    img.className = 'cm-inline-image';
    img.src = this.src;
    img.alt = this.alt;
    img.title = this.alt ? `${this.alt} (click to edit caption)` : 'Click to edit image caption';
    img.addEventListener('click', (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(wrap);
      view.dispatch({ selection: { anchor: pos + 2 }, scrollIntoView: true });
      view.focus();
    });
    if (this.ai) {
      const mark = document.createElement('span');
      mark.className = 'ai-mark';
      mark.append(img);
      wrap.append(mark);
    } else {
      wrap.append(img);
    }

    if (this.alt) {
      const cap = document.createElement('span');
      cap.className = 'cm-inline-image-caption';
      cap.textContent = this.alt;
      wrap.append(cap);
    }
    return wrap;
  }
}

class CompactDataUrlWidget extends WidgetType {
  constructor(readonly byteLen: number) {
    super();
  }
  eq(other: CompactDataUrlWidget): boolean {
    return this.byteLen === other.byteLen;
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-mdlink';
    el.textContent = `embedded-image (${Math.max(1, Math.round((this.byteLen * 0.75) / 1024))} KB)`;
    return el;
  }
}

const IMAGE_MD_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

const HIDE = Decoration.replace({});
const BULLET = Decoration.replace({ widget: new Bullet() });
const QUOTE_LINE = Decoration.line({ class: 'cm-quote-line' });
const LINK = Decoration.mark({ class: 'cm-mdlink' });

function build(view: EditorView): DecorationSet {
  const { state } = view;
  // Without focus nothing is being edited, so every marker is hidden.
  const active = view.hasFocus
    ? state.selection.ranges.map((r) => ({ from: state.doc.lineAt(r.from).from, to: state.doc.lineAt(r.to).to }))
    : [];
  const isActive = (pos: number) => active.some((a) => pos >= a.from && pos <= a.to);
  const decos = liveMarks(state, active, view.visibleRanges).map((m) => {
    switch (m.kind) {
      case 'hide':
        return HIDE.range(m.from, m.to);
      case 'bullet':
        return BULLET.range(m.from, m.to);
      case 'quote-line':
        return QUOTE_LINE.range(m.from);
      case 'link':
        return LINK.range(m.from, m.to);
    }
  });
  // Render `![alt](url)` as an inline image widget when the cursor is not on that line.
  // When the cursor IS on that line and the URL is a long `data:` URI, collapse the base64 payload
  // so 50KB of base64 text never explodes across the editor while editing the caption.
  const seenImagePositions = new Set<number>();
  for (const span of view.visibleRanges) {
    const lineFrom = state.doc.lineAt(span.from).from;
    const lineTo = state.doc.lineAt(span.to).to;
    const slice = state.sliceDoc(lineFrom, lineTo);
    for (const match of slice.matchAll(IMAGE_MD_RE)) {
      const from = lineFrom + (match.index ?? 0);
      if (seenImagePositions.has(from)) continue;
      seenImagePositions.add(from);
      const to = from + match[0].length;
      const alt = match[1] ?? '';
      const raw = match[2] ?? '';
      if (!raw) continue;
      if (isActive(from)) {
        if (raw.startsWith('data:') && raw.length > 64) {
          const urlStart = from + 4 + alt.length;
          const urlEnd = to - 1;
          if (urlEnd > urlStart) {
            decos.push(Decoration.replace({ widget: new CompactDataUrlWidget(raw.length) }).range(urlStart, urlEnd));
          }
        }
        continue;
      }
      let src = raw;
      let ai = false;
      if (raw.startsWith(IMAGE_REF)) {
        const stored = state.facet(imageLookup)(raw.slice(IMAGE_REF.length));
        if (!stored) continue; // an unknown id stays as text rather than a broken picture
        ({ src, ai = false } = stored);
      }
      decos.push(Decoration.replace({ widget: new InlineImageWidget(alt, src, ai) }).range(from, to));
    }
  }
  return Decoration.set(decos, true);
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (p) => p.decorations },
);

const theme = EditorView.theme({
  '.cm-line.cm-quote-line': { borderLeft: '3px solid var(--border)', paddingLeft: '14px' },
  '.cm-bullet': { color: 'var(--fg-muted)' },
  '.cm-mdlink': { color: 'var(--link)', textDecoration: 'underline' },
  '.cm-inline-image-wrap': {
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '4px',
    margin: '6px 0',
    maxWidth: '100%',
  },
  '.cm-inline-image': {
    maxWidth: 'min(100%, 540px)',
    maxHeight: '360px',
    borderRadius: '8px',
    border: '1px solid var(--border)',
    objectFit: 'contain',
    cursor: 'pointer',
    background: 'var(--bg-sunk)',
  },
  '.cm-inline-image-caption': {
    fontSize: '12px',
    color: 'var(--fg-muted)',
    fontStyle: 'italic',
  },
});

export const livePreview: Extension = [plugin, theme];
