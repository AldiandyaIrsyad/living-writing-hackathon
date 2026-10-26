// Markdown editor on CodeMirror 6 — owns its document so typing never re-renders React.

import { typewriter } from './typewriter';
import { autocompletion, closeBrackets, completionKeymap, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, Facet, RangeSet, RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, placeholder as cmPlaceholder, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { useEffect, useRef } from 'react';
import { findAuthorNotesOutsideCode, findEntity, findScene, parseLinks } from '../../core/links';
import type { AuthorNote } from '../../core/notes';
import { installPreset, TYPE_PRESETS, type TypePreset } from '../../core/presets';
import type { Id, Vault } from '../../core/types';
import { addEntity, sortedTypes } from '../../store/actions';
import { useStore } from '../../store/store';
import { followLink } from '../follow';
import { fileToImageMarkdown } from '../imageUpload';
import '../notes/notes.css';
import { selectionBubble } from './bubble';
import { toggleAuthorNote, toggleInline } from './format';
import { livePreview } from './livePreview';

/** Ask the editor to rebuild its link decorations (an entity or scene was created or renamed). */
export const refreshLinks = StateEffect.define<null>();

/**
 * Which scene a position in the document belongs to, for editors that show several scenes at once (a chapter).
 * Links resolve "as of" that scene. Without it the whole document is the one scene given as `contextSceneId`.
 */
export const sceneContext = Facet.define<(state: EditorState, pos: number) => string | undefined, ((state: EditorState, pos: number) => string | undefined) | undefined>({
  combine: (values) => values[0],
});

const TAG_RE = /(^|\s)#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;
const NOTE_DECO = Decoration.mark({ class: 'cm-author-note' });
/** Most entity types offered as "Create … as <Type>" in the [[ completion. */
const MAX_CREATE_TYPES = 6;

/** Small chip standing in for a note while notes are collapsed. Clicking it reveals the note. */
class NoteMarker extends WidgetType {
  constructor(readonly note: AuthorNote) {
    super();
  }

  eq(other: NoteMarker): boolean {
    return other.note.start === this.note.start && other.note.end === this.note.end && other.note.text === this.note.text;
  }

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-note-marker';
    el.setAttribute('data-testid', 'note-marker');
    el.setAttribute('title', this.note.text);
    el.setAttribute('aria-label', `Author note: ${this.note.text}`);
    el.textContent = '💬';
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => {
      e.preventDefault();
      // Putting the cursor inside the note is what reveals it; it folds away again when the cursor leaves.
      view.dispatch({ selection: { anchor: this.note.start + 1 }, scrollIntoView: true });
      view.focus();
    });
    return el;
  }
}

/** Event asking an editor to select and show a range of its scene's text (see AuthorNotesPanel). */
/** Detail of `lw:insert-text`: text to put at the caret of the editor being written in (replacing a selection). */
export interface InsertTextDetail {
  text: string;
  targetEditorId?: string;
}

/** The editor the writer was last in, so a command run from the palette lands where they were typing. */
let lastFocused: EditorView | null = null;

export interface RevealTextDetail {
  sceneId: string;
  from: number;
  to: number;
}

interface Built {
  decorations: DecorationSet;
  /** The collapsed note markers only: the cursor skips over them as one unit. */
  atomic: DecorationSet;
  noteCount: number;
}

function buildDecorations(view: EditorView): Built {
  const { state } = view;
  const { vault, showNotesInEditor } = useStore.getState();
  const text = state.doc.toString();
  const ranges: { from: number; to: number; deco: Decoration }[] = [];
  const collapsed: { from: number; to: number; deco: Decoration }[] = [];
  // Author notes are notes: links and tags inside them are not decorated as links.
  const notes = findAuthorNotesOutsideCode(text);
  for (const n of notes) {
    // A note is shown when notes are shown, or while the cursor (or a selection) is inside it.
    const editing = state.selection.ranges.some((r) => r.from < n.end && r.to > n.start);
    if (showNotesInEditor || editing) {
      ranges.push({ from: n.start, to: n.end, deco: NOTE_DECO });
    } else {
      const deco = Decoration.replace({ widget: new NoteMarker(n) });
      ranges.push({ from: n.start, to: n.end, deco });
      collapsed.push({ from: n.start, to: n.end, deco });
    }
  }
  const links = parseLinks(text);
  const contextAt = state.facet(sceneContext);
  for (const l of links) {
    const resolved = !!(findEntity(vault, l.target) ?? findScene(vault, l.target));
    const attributes: Record<string, string> = { 'data-link-target': l.target, 'data-link-raw': l.raw };
    const context = contextAt?.(state, l.start);
    if (context !== undefined) attributes['data-context-scene'] = context;
    if (l.timeRaw !== undefined) attributes['data-link-time'] = l.timeRaw;
    ranges.push({
      from: l.start,
      to: l.end,
      deco: Decoration.mark({ class: resolved ? 'cm-wikilink' : 'cm-wikilink unresolved', attributes }),
    });
  }
  for (const m of text.matchAll(TAG_RE)) {
    const from = m.index + m[1].length;
    const to = from + 1 + m[2].length;
    if (links.some((l) => from < l.end && to > l.start)) continue;
    if (notes.some((n) => from < n.end && to > n.start)) continue;
    ranges.push({ from, to, deco: Decoration.mark({ class: 'cm-tag', attributes: { 'data-tag': m[2] } }) });
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const b = new RangeSetBuilder<Decoration>();
  for (const r of ranges) b.add(r.from, r.to, r.deco);
  const a = new RangeSetBuilder<Decoration>();
  for (const r of collapsed) a.add(r.from, r.to, r.deco);
  return { decorations: b.finish(), atomic: a.finish(), noteCount: notes.length };
}

/** Mod-Shift-/ : show or collapse the author notes in the editor (also the toggle in the scene header). */
function toggleNotesShown(): boolean {
  const s = useStore.getState();
  s.setShowNotesInEditor(!s.showNotesInEditor);
  return true;
}

const linkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;
    noteCount: number;
    constructor(view: EditorView) {
      const built = buildDecorations(view);
      this.decorations = built.decorations;
      this.atomic = built.atomic;
      this.noteCount = built.noteCount;
    }
    update(u: ViewUpdate) {
      const refresh = u.docChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshLinks)));
      // Notes that are not shown depend on the cursor, so a moved selection can change them too.
      if (refresh || (u.selectionSet && this.noteCount > 0)) {
        const built = buildDecorations(u.view);
        this.decorations = built.decorations;
        this.atomic = built.atomic;
        this.noteCount = built.noteCount;
      }
    }
  },
  { decorations: (p) => p.decorations },
);

const atomicNotes = EditorView.atomicRanges.of((view) => view.plugin(linkPlugin)?.atomic ?? RangeSet.empty);

/** Completion entries that create the typed name as a new entity. Shown when nothing matches it exactly. */
interface CreateTarget {
  name: string;
  typeId?: Id;
  preset?: TypePreset;
}

function createTargets(vault: Vault): CreateTarget[] {
  const rank = (name: string, icon?: string) => {
    const lower = name.toLowerCase();
    if (lower === 'character' || lower === 'person' || icon === 'user') return 0;
    if (lower === 'place' || lower === 'location' || icon === 'map-pin') return 1;
    if (lower === 'object' || lower === 'item' || icon === 'box') return 2;
    if (lower === 'faction' || lower === 'group' || icon === 'flag') return 3;
    return 4;
  };
  const types = [...sortedTypes(vault)]
    .sort((a, b) => rank(a.name, a.icon) - rank(b.name, b.icon) || a.name.localeCompare(b.name))
    .slice(0, MAX_CREATE_TYPES);
  if (types.length > 0) return types.map((t) => ({ name: t.name, typeId: t.id }));
  const character = TYPE_PRESETS.find((p) => p.key === 'person');
  return character ? [{ name: character.name, preset: character }] : [];
}

/**
 * Creates the entity (installing the suggested Person type first when the vault has no types),
 * then replaces the typed text by `[[name]]` and keeps the cursor in the editor past `]]`.
 */
function createFromCompletion(view: EditorView, from: number, to: number, name: string, target: CreateTarget, closeAfter: string, skipAfter: number): void {
  const store = useStore.getState();
  let next = store.vault;
  let typeId = target.typeId;
  if (typeId === undefined && target.preset) {
    const installed = installPreset(next, target.preset);
    next = installed.vault;
    typeId = installed.id;
  }
  if (typeId === undefined) return;
  const typeName = next.entityTypes[typeId]?.name ?? target.name;
  const added = addEntity(next, { name, typeId });
  const insert = `${name}${closeAfter}`;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length + skipAfter }, userEvent: 'input' });
  view.focus();
  store.commit(added.vault);
  store.toast('info', `Created ${name} (${typeName})`);
}

function wikiCompletion(ctx: CompletionContext): CompletionResult | null {
  const before = ctx.matchBefore(/!?\[\[[^\]\n]*/);
  if (!before) return null;
  const inner = before.text.replace(/^!?\[\[/, '');
  if (inner.includes('|')) return null;
  const vault = useStore.getState().vault;
  const hasClosing = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === ']]';
  const closeAfter = hasClosing ? '' : ']]';
  const skipAfter = hasClosing ? 2 : 0;
  const at = inner.indexOf('@');
  const mk = (label: string, detail: string, type: string): Completion => ({
    label,
    detail,
    type,
    apply: (view, _c, from, to) => {
      const insert = label + closeAfter;
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length + skipAfter } });
    },
  });
  if (at >= 0) {
    const options: Completion[] = [mk('latest', 'latest state', 'keyword')];
    for (const s of Object.values(vault.scenes)) {
      options.push(mk(s.title, 'at scene', 'event'), mk(`before:${s.title}`, 'just before', 'event'), mk(`after:${s.title}`, 'just after', 'event'));
    }
    return { from: before.from + before.text.indexOf('[[') + 2 + at + 1, options, validFor: /^[^\]\n|]*$/ };
  }
  const options: Completion[] = [];
  for (const e of Object.values(vault.entities)) {
    const type = vault.entityTypes[e.typeId]?.name ?? 'entity';
    options.push(mk(e.name, type, 'variable'));
    for (const a of e.aliases) options.push({ ...mk(a, `alias of ${e.name}`, 'variable') });
  }
  for (const s of Object.values(vault.scenes)) options.push(mk(s.title, 'scene', 'text'));
  const typed = inner.trim();
  if (typed !== '' && !findEntity(vault, typed) && !findScene(vault, typed)) {
    createTargets(vault).forEach((target, idx) => {
      options.push({
        label: `Create “${typed}” as ${target.name}`,
        detail: `new ${target.name}`,
        type: 'create',
        boost: -10 - idx,
        apply: (view, _c, applyFrom, applyTo) => createFromCompletion(view, applyFrom, applyTo, typed, target, closeAfter, skipAfter),
      });
    });
  }
  return { from: before.from + before.text.indexOf('[[') + 2, options, validFor: /^[^\]\n|@#]*$/ };
}

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.55em', fontWeight: '700' },
  { tag: t.heading2, fontSize: '1.3em', fontWeight: '700' },
  { tag: t.heading3, fontSize: '1.12em', fontWeight: '700' },
  { tag: t.heading, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.9em' },
  { tag: t.quote, color: 'var(--fg-muted)', fontStyle: 'italic' },
  { tag: t.url, color: 'var(--link)' },
  { tag: [t.processingInstruction, t.meta], color: 'var(--fg-faint)' },
]);

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--fg)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { fontFamily: 'var(--font-prose)', fontSize: '17px', lineHeight: '1.7', caretColor: 'var(--accent)', padding: '8px 0 120px' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-soft) !important' },
  '.cm-placeholder': { color: 'var(--fg-faint)' },
  '.cm-tooltip': { backgroundColor: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: 'var(--shadow)' },
  '.cm-tooltip-autocomplete > ul > li': { fontFamily: 'var(--font-ui)', fontSize: '13px', padding: '2px 8px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent-soft)', color: 'var(--fg)' },
  '.cm-completionDetail': { color: 'var(--fg-muted)', marginLeft: '8px', fontStyle: 'normal' },
});

export interface EditorProps {
  value: string;
  onChange: (text: string) => void;
  /** Scene whose moment gives `[[links]]` their time context. */
  contextSceneId?: string;
  placeholder?: string;
  testId?: string;
  /** Optional identifier so targeted `lw:insert-text` events only insert into this editor. */
  editorId?: string;
  /** Extra CodeMirror extensions, fixed for the life of the editor. */
  extensions?: Extension[];
  /** Called with the view once it exists, and with null when it is destroyed. */
  onView?: (view: EditorView | null) => void;
  /** Maps an offset inside a scene's prose to an offset in this document (null: the scene is not in it). */
  locate?: (sceneId: string, pos: number) => number | null;
}

export function Editor({ value, onChange, contextSceneId, placeholder, testId, editorId, extensions, onView, locate }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const emitted = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctxRef = useRef(contextSceneId);
  const locateRef = useRef(locate);
  const editorIdRef = useRef(editorId);

  useEffect(() => {
    onChangeRef.current = onChange;
    ctxRef.current = contextSceneId;
    locateRef.current = locate;
    editorIdRef.current = editorId;
  });

  useEffect(() => {
    const flush = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const view = viewRef.current;
      if (!view) return;
      const text = view.state.doc.toString();
      if (text !== emitted.current) {
        emitted.current = text;
        onChangeRef.current(text);
      }
    };
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: emitted.current,
        extensions: [
          history(),
          keymap.of([
            { key: 'Mod-/', run: toggleAuthorNote },
            { key: 'Mod-Shift-/', run: toggleNotesShown },
            { key: 'Mod-Shift-?', run: toggleNotesShown },
            { key: 'Mod-b', run: (v) => toggleInline(v, 'bold') },
            { key: 'Mod-i', run: (v) => toggleInline(v, 'italic') },
            { key: 'Mod-Shift-x', run: (v) => toggleInline(v, 'strike') },
            { key: 'Mod-e', run: (v) => toggleInline(v, 'code') },
            ...completionKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          markdown(),
          syntaxHighlighting(highlight),
          livePreview,
          selectionBubble,
          EditorView.lineWrapping,
          closeBrackets(),
          autocompletion({ override: [wikiCompletion], icons: false }),
          linkPlugin,
          typewriter,
          atomicNotes,
          theme,
          cmPlaceholder(placeholder ?? 'Start writing… use [[ to link'),
          ...(extensions ?? []),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            if (u.transactions.some((tr) => tr.isUserEvent('input') || tr.isUserEvent('delete'))) {
              window.dispatchEvent(new Event('lw:typing'));
            }
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(flush, 250);
          }),
          EditorView.domEventHandlers({
            focus: (_e, v) => {
              lastFocused = v;
            },
            blur: () => {
              flush();
              window.dispatchEvent(new Event('lw:editor-blur'));
            },
            mousedown: (e) => {
              if (e.button !== 0 || (!e.ctrlKey && !e.metaKey)) return false;
              const el = (e.target as HTMLElement).closest<HTMLElement>('[data-link-target]');
              if (!el) return false;
              e.preventDefault();
              flush();
              followLink(el.dataset.linkTarget!, el.dataset.linkTime, el.dataset.contextScene ?? ctxRef.current);
              return true;
            },
            click: (e, v) => {
              if (e.button !== 0 || e.ctrlKey || e.metaKey) return false;
              const el = (e.target as HTMLElement).closest<HTMLElement>('[data-link-target]');
              if (!el || !v.state.selection.main.empty) return false;
              // Never auto-create an unresolved entity on a plain click (the author may just be placing the caret to fix a typo).
              if (el.classList.contains('unresolved')) return false;
              const activeScene = el.dataset.contextScene ?? ctxRef.current;
              // Only open the non-disruptive Floating Wiki on plain click when writing inside a scene;
              // in EntityView notes (no scene context), require Ctrl/Cmd+Click so plain click edits text.
              if (!activeScene && useStore.getState().view.kind !== 'scene') return false;
              flush();
              followLink(el.dataset.linkTarget!, el.dataset.linkTime, activeScene);
              return false;
            },
            paste: (e, v) => {
              const items = Array.from(e.clipboardData?.items ?? []);
              const imgItem = items.find((item) => item.type.startsWith('image/'));
              const file = imgItem?.getAsFile();
              if (!file) return false;
              e.preventDefault();
              void fileToImageMarkdown(file).then((processed) => {
                if (!v.dom.isConnected) return;
                const { from, to } = v.state.selection.main;
                const insert = `${processed.markdown}\n`;
                v.dispatch({
                  changes: { from, to, insert },
                  selection: { anchor: from + insert.length },
                  userEvent: 'input.paste',
                  scrollIntoView: true,
                });
              });
              return true;
            },
            drop: (e, v) => {
              const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
              if (files.length === 0) return false;
              e.preventDefault();
              const rawDropPos = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head;
              void Promise.all(files.map((f) => fileToImageMarkdown(f))).then((results) => {
                if (!v.dom.isConnected) return;
                const dropPos = Math.min(rawDropPos, v.state.doc.length);
                const insert = results.map((r) => r.markdown).join('\n\n') + '\n';
                v.dispatch({
                  changes: { from: dropPos, to: dropPos, insert },
                  selection: { anchor: dropPos + insert.length },
                  userEvent: 'input.drop',
                  scrollIntoView: true,
                });
                v.focus();
              });
              return true;
            },
          }),
        ],
      }),
    });
    viewRef.current = view;
    onView?.(view);
    // Re-decorate links when entities/scenes are created or renamed.
    // Also re-decorates when notes are shown or collapsed (showNotesInEditor).
    const unsub = useStore.subscribe((s, prev) => {
      if (s.vault.entities !== prev.vault.entities || s.vault.scenes !== prev.vault.scenes || s.showNotesInEditor !== prev.showNotesInEditor) {
        view.dispatch({ effects: refreshLinks.of(null) });
      }
    });
    window.addEventListener('lw:flush-editors', flush);
    const onReveal = (e: Event) => {
      const d = (e as CustomEvent<RevealTextDetail>).detail;
      const current = viewRef.current;
      if (!d || !current) return;
      const offset = locateRef.current ? locateRef.current(d.sceneId, 0) : d.sceneId === ctxRef.current ? 0 : null;
      if (offset === null) return;
      const len = current.state.doc.length;
      const from = Math.min(d.from + offset, len);
      const to = Math.min(d.to + offset, len);
      current.dispatch({
        selection: { anchor: from, head: to },
        effects: EditorView.scrollIntoView(from, { y: 'center' }),
      });
      current.focus();
    };
    window.addEventListener('lw:reveal-text', onReveal);
    const onInsert = (e: Event) => {
      const d = (e as CustomEvent<InsertTextDetail>).detail;
      const current = viewRef.current;
      if (!d || !current) return;
      if (d.targetEditorId !== undefined) {
        if (editorIdRef.current !== d.targetEditorId) return;
      } else if (lastFocused !== null && lastFocused !== current && lastFocused.dom.isConnected) {
        return;
      }
      const { from, to } = current.state.selection.main;
      current.dispatch({ changes: { from, to, insert: d.text }, selection: { anchor: from + d.text.length }, userEvent: 'input.paste', scrollIntoView: true });
      current.focus();
    };
    window.addEventListener('lw:insert-text', onInsert);
    return () => {
      window.removeEventListener('lw:insert-text', onInsert);
      flush();
      unsub();
      window.removeEventListener('lw:flush-editors', flush);
      window.removeEventListener('lw:reveal-text', onReveal);
      view.destroy();
      viewRef.current = null;
      onView?.(null);
    };
    // The editor is created once per mount; parents key it by document id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External changes (undo, rename, import) replace the document.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === emitted.current) return;
    if (view.state.doc.toString() === value) {
      emitted.current = value;
      return;
    }
    emitted.current = value;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  return <div className="editor" ref={host} data-testid={testId} data-context-scene={contextSceneId} />;
}

/** Ask every mounted editor to push pending text into the store (before export, reload…). */
export function flushEditors(): void {
  window.dispatchEvent(new Event('lw:flush-editors'));
}
