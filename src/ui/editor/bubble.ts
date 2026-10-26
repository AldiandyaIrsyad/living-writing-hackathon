// Floating formatting toolbar: appears above a text selection once the mouse is released, and runs the same commands
// as the keyboard shortcuts (see format.ts).

import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, showTooltip, type Tooltip, type TooltipView } from '@codemirror/view';
import { findEntity, parseLinks } from '../../core/links';
import { addChange, parseQuickCommit } from '../../store/actions';
import { sceneCast } from '../../store/cast';
import { useStore } from '../../store/store';
import { sceneContext } from './Editor';
import { blockActive, inlineActive, toggleAuthorNote, toggleBlock, toggleInline, type BlockKind, type InlineKind } from './format';

const setDragging = StateEffect.define<boolean>();
const setFocused = StateEffect.define<boolean>();

function flag(effect: typeof setDragging) {
  return StateField.define<boolean>({
    create: () => false,
    update(value, tr) {
      for (const e of tr.effects) if (e.is(effect)) return e.value;
      return value;
    },
  });
}
const dragging = flag(setDragging);
const focused = flag(setFocused);

interface Action {
  label: string;
  title: string;
  className?: string;
  run: (view: EditorView) => boolean;
  active?: (state: EditorState) => boolean;
}

const inline = (kind: InlineKind, label: string, title: string, className?: string): Action => ({
  label,
  title,
  className,
  run: (v) => toggleInline(v, kind),
  active: (s) => inlineActive(s, kind),
});
const block = (kind: BlockKind, label: string, title: string): Action => ({
  label,
  title,
  run: (v) => toggleBlock(v, kind),
  active: (s) => blockActive(s, kind),
});

const GROUPS: Action[][] = [
  [
    inline('bold', 'B', 'Bold (Ctrl+B)', 'cm-bubble-bold'),
    inline('italic', 'I', 'Italic (Ctrl+I)', 'cm-bubble-italic'),
    inline('strike', 'S', 'Strikethrough (Ctrl+Shift+X)', 'cm-bubble-strike'),
    inline('code', '<>', 'Code (Ctrl+E)', 'cm-bubble-code'),
  ],
  [block('h2', 'H2', 'Heading'), block('h3', 'H3', 'Subheading'), block('quote', '❝', 'Quote'), block('list', '•', 'Bulleted list')],
  [
    inline('link', '[[ ]]', 'Link to an entity or scene', 'cm-bubble-code'),
    { label: '💬', title: 'Author note (Ctrl+/)', run: toggleAuthorNote },
    { label: 'Δ', title: 'Record selection as commit on scene', run: commitFromSelection },
  ],
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Turns the selected prose text into a scene commit on the mentioned entity (or the scene's first cast member). */
function commitFromSelection(view: EditorView): boolean {
  const sel = view.state.selection.main;
  if (sel.empty) return false;
  const text = view.state.sliceDoc(sel.from, sel.to).trim();
  if (!text) return false;
  const s = useStore.getState();
  const contextAt = view.state.facet(sceneContext);
  const targetSceneId = contextAt?.(view.state, sel.from) ?? (s.view.kind === 'scene' ? s.view.id : undefined);
  if (!targetSceneId) {
    s.toast('info', 'Open a scene to record a commit from selected prose.');
    return true;
  }
  const scene = s.vault.scenes[targetSceneId];
  if (!scene) return false;

  // Prefer an [[entity]] linked inside the selection, then any entity name/alias appearing as a whole word, then open floating wiki or first cast member.
  let entityId = parseLinks(text)
    .map((l) => findEntity(s.vault, l.target)?.id)
    .find((id): id is string => Boolean(id));
  if (!entityId) {
    entityId = Object.values(s.vault.entities).find((e) => {
      const names = [e.name, ...e.aliases].filter(Boolean);
      return names.some((n) => new RegExp(`\\b${escapeRegExp(n)}\\b`, 'i').test(text));
    })?.id;
  }
  if (!entityId) {
    const cast = sceneCast(s.vault, scene);
    entityId = cast[0]?.entityId ?? s.floatingEntity?.entityId;
  }
  if (!entityId) {
    s.toast('info', 'Link or mention an [[entity]] in the selection (or add them to the scene cast) to record a commit.');
    return true;
  }
  const parsed = parseQuickCommit(text);
  if (!parsed) return false;
  const r = addChange(s.vault, {
    sceneId: scene.id,
    entityId,
    op: parsed.op,
    property: parsed.property,
    value: parsed.value,
    ...(parsed.message ? { message: parsed.message } : {}),
  });
  s.commit(r.vault);
  const entityName = s.vault.entities[entityId]?.name ?? 'entity';
  s.toast('info', `Recorded commit on ${entityName}: “${parsed.message ?? text}”`);
  return true;
}

/** One shared factory: CodeMirror keeps the toolbar's DOM between selections and only moves it. */
function createBubble(view: EditorView): TooltipView {
  const dom = document.createElement('div');
  dom.className = 'cm-bubble';
  dom.setAttribute('role', 'toolbar');
  dom.setAttribute('aria-label', 'Formatting');
  const buttons: [Action, HTMLButtonElement][] = [];
  GROUPS.forEach((group, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'cm-bubble-sep';
      dom.append(sep);
    }
    for (const action of group) {
      const button = document.createElement('button');
      button.type = 'button';
      button.tabIndex = -1;
      button.textContent = action.label;
      button.title = action.title;
      button.setAttribute('aria-label', action.title);
      if (action.className) button.classList.add(action.className);
      // mousedown, not click: keep the editor focused and the selection intact.
      button.addEventListener('mousedown', (e) => {
        e.preventDefault();
        action.run(view);
      });
      buttons.push([action, button]);
      dom.append(button);
    }
  });
  const sync = (state: EditorState) => {
    for (const [action, button] of buttons) button.classList.toggle('active', action.active?.(state) ?? false);
  };
  sync(view.state);
  return { dom, update: (u) => (u.docChanged || u.selectionSet) && sync(u.state) };
}

const bubble = showTooltip.compute(['selection', dragging, focused], (state): Tooltip | null => {
  const sel = state.selection.main;
  if (sel.empty || !state.field(focused) || state.field(dragging)) return null;
  return { pos: sel.from, above: true, strictSide: true, arrow: false, create: createBubble };
});

const theme = EditorView.baseTheme({
  '.cm-tooltip.cm-bubble': { display: 'flex', alignItems: 'center', gap: '1px', padding: '3px', fontFamily: 'var(--font-ui)' },
  '.cm-bubble button': {
    minWidth: '28px',
    height: '28px',
    padding: '0 6px',
    border: 'none',
    borderRadius: '5px',
    background: 'transparent',
    color: 'var(--fg)',
    fontSize: '13px',
    cursor: 'pointer',
  },
  '.cm-bubble button:hover': { backgroundColor: 'var(--accent-soft)' },
  '.cm-bubble button.active': { backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' },
  '.cm-bubble-bold': { fontWeight: '700' },
  '.cm-bubble-italic': { fontStyle: 'italic' },
  '.cm-bubble-strike': { textDecoration: 'line-through' },
  '.cm-bubble-code': { fontFamily: 'var(--font-mono)', fontSize: '12px' },
  '.cm-bubble-sep': { width: '1px', height: '18px', margin: '0 4px', background: 'var(--border)' },
});

export const selectionBubble: Extension = [
  dragging,
  focused,
  bubble,
  theme,
  EditorView.focusChangeEffect.of((_state, isFocused) => setFocused.of(isFocused)),
  EditorView.domEventHandlers({
    // Wait for the mouse to be released so the toolbar does not chase a drag selection.
    mousedown: (e, view) => {
      if (e.button !== 0) return false;
      view.dispatch({ effects: setDragging.of(true) });
      const up = () => {
        window.removeEventListener('mouseup', up);
        if (view.dom.isConnected) view.dispatch({ effects: setDragging.of(false) });
      };
      window.addEventListener('mouseup', up);
      return false;
    },
  }),
];
