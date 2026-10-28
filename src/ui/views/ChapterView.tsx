// A chapter as one document: its scenes in reading order, each starting at a `# Heading`. Typing a new `# Heading`
// makes a scene, deleting one merges it upward. The scene under the cursor is the open scene (cast, timeline…).

import { EditorView } from '@codemirror/view';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { applyChapterPlan, chapterScenes, composeChapter, parseChapterText, reconcile } from '../../core/chapterDoc';
import { insertScene } from '../../core/timeline';
import type { Id, Scene } from '../../core/types';
import { formatCount, readingMinutes, sceneWordCount } from '../../core/wordcount';
import { addChapterAfter, chaptersOfStory, updateChapter } from '../../store/actions';
import { flushEditors, update, useStore, useVault } from '../../store/store';
import { anchorsOf, chapterExtensions, sceneAtPos, sceneStart, setAnchors } from '../editor/chapterExtensions';
import { Editor, refreshLinks, sceneContext, type InsertTextDetail } from '../editor/Editor';
import { pickImageFile } from '../imageUpload';
import { Markdown } from '../Markdown';
import { SceneBar } from './SceneBar';
import './scene.css';

interface ChapterViewProps {
  chapterId: Id;
  /** The open scene: the editor scrolls to it when it changes from outside (sidebar, timeline, Ctrl+K). */
  activeSceneId: Id;
}

export function ChapterView({ chapterId, activeSceneId }: ChapterViewProps) {
  const vault = useVault();
  const chapter = vault.chapters[chapterId];
  const story = chapter ? vault.stories[chapter.storyId] : undefined;
  const navigate = useStore((s) => s.navigate);
  const showNotes = useStore((s) => s.showNotesInEditor);
  const [preview, setPreview] = useState(false);
  const addScene = useRef<(() => void) | null>(null);
  const scenes = useMemo(() => chapterScenes(vault, chapterId), [vault, chapterId]);
  const words = useMemo(() => scenes.reduce((n, s) => n + sceneWordCount(s), 0), [scenes]);
  const [title, setTitle] = useState(chapter?.title ?? '');
  const [prevTitle, setPrevTitle] = useState(chapter?.title ?? '');
  if (chapter && chapter.title !== prevTitle) {
    setPrevTitle(chapter.title);
    setTitle(chapter.title);
  }
  if (!chapter) return <div className="empty">This chapter no longer exists.</div>;

  const commitTitle = () => title !== chapter.title && update((v) => updateChapter(v, chapterId, { title }));

  return (
    <div className="scene-layout">
      <div className="view">
        <div className="view-narrow">
          <div className="stack" style={{ marginBottom: 12 }}>
            <div className="row small muted wrap">
              <span className="dot" style={{ background: story?.color }} />
              <a href="#" onClick={(e) => (e.preventDefault(), story && navigate({ kind: 'story', id: story.id }))}>
                {story?.name}
              </a>
              <span className="grow" />
              <span className="faint" data-testid="chapter-words" title="Words in this chapter and estimated reading time">
                {scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'} · {formatCount(words)} {words === 1 ? 'word' : 'words'}
                {words > 0 && ` · ${readingMinutes(words)} min`}
              </span>
              <button className="btn btn-sm btn-ghost" onClick={() => addScene.current?.()} disabled={preview} title="Add a scene at the end of the chapter (a new # heading)" data-testid="chapter-add-scene">
                + Scene
              </button>
              <button
                className="btn btn-sm btn-ghost"
                disabled={preview}
                data-testid="chapter-insert-image"
                title="Upload or insert an image at the cursor (you can also paste or drag-and-drop images directly into the editor)"
                onClick={() => {
                  void pickImageFile().then((img) => {
                    if (!img) return;
                    window.dispatchEvent(
                      new CustomEvent<InsertTextDetail>('lw:insert-text', {
                        detail: { text: `${img.markdown}\n`, targetEditorId: 'manuscript-editor' },
                      }),
                    );
                  });
                }}
              >
                + Image
              </button>
              <button className={`btn btn-sm ${preview ? '' : 'active'}`} onClick={() => setPreview(false)}>
                Write
              </button>
              <button className={`btn btn-sm ${preview ? 'active' : ''}`} onClick={() => setPreview(true)} data-testid="toggle-preview">
                Preview
              </button>
              <button
                className={`btn btn-sm ${showNotes ? 'active' : ''}`}
                onClick={() => useStore.getState().setShowNotesInEditor(!showNotes)}
                data-testid="toggle-notes"
                title="Show author notes in the editor, or collapse them to markers (Ctrl+Shift+/)"
              >
                {showNotes ? 'Notes: shown' : 'Notes: hidden'}
              </button>
            </div>
            <input
              className="view-title"
              aria-label="Chapter title"
              data-testid="chapter-title"
              value={title}
              placeholder="Untitled chapter"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            />
            {showNotes && (
              <textarea
                className="input small chapter-note"
                rows={2}
                aria-label="Chapter notes"
                data-testid="chapter-note"
                placeholder="Chapter notes, for you and the story agent (it reads them with every scene here): “Set in late autumn, 2026.” “Mira lies all chapter.”"
                defaultValue={chapter.note ?? ''}
                key={`${chapterId}:${chapter.note ?? ''}`}
                onBlur={(e) => e.target.value.trim() !== (chapter.note ?? '') && update((v) => updateChapter(v, chapterId, { note: e.target.value.trim() || undefined }))}
              />
            )}
          </div>
          {vault.scenes[activeSceneId] && <SceneBar scene={vault.scenes[activeSceneId]} withMore />}
          {preview ? <ChapterPreview scenes={scenes} /> : <ChapterEditor chapterId={chapterId} activeSceneId={activeSceneId} addScene={addScene} />}
          <ChapterFooterNav chapterId={chapterId} />
        </div>
      </div>
    </div>
  );
}

/** Reader-style bottom bar: the previous chapter on the left, the next on the right; past the last chapter, "Next chapter" starts one. */
function ChapterFooterNav({ chapterId }: { chapterId: Id }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const chapter = vault.chapters[chapterId];
  const chapters = useMemo(() => (chapter ? chaptersOfStory(vault, chapter.storyId) : []), [vault, chapter]);
  if (!chapter) return null;
  const idx = chapters.findIndex((c) => c.id === chapterId);
  const prev = idx > 0 ? chapters[idx - 1] : null;
  const next = idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1] : null;

  const openChapter = (targetChapterId: Id, dir: 'prev' | 'next') => {
    flushEditors();
    const st = useStore.getState();
    const list = chapterScenes(st.vault, targetChapterId);
    if (list.length > 0) {
      st.navigate({ kind: 'scene', id: list[0].id });
      return;
    }
    // Empty chapter: create its first scene and open it
    const curScenes = chapterScenes(st.vault, chapterId);
    const anchorScene = dir === 'prev' ? curScenes[0] : curScenes[curScenes.length - 1];
    const rel = anchorScene ? (dir === 'prev' ? 'before' : 'after') : null;
    const ins = insertScene(st.vault, { storyId: chapter.storyId, title: 'New scene', chapterId: targetChapterId }, rel, anchorScene?.id ?? null);
    st.commit(ins.vault);
    st.navigate({ kind: 'scene', id: ins.sceneId });
  };

  /** After the last chapter, "Next chapter" starts one: its first scene follows this chapter's last. */
  const createNextChapter = () => {
    flushEditors();
    const st = useStore.getState();
    const last = chapterScenes(st.vault, chapterId).at(-1);
    const made = addChapterAfter(st.vault, chapter.storyId, chapterId, 'after', last?.id ?? null);
    st.commit(made.vault, undefined, `Create ${made.vault.chapters[made.chapterId].title}`);
    navigate({ kind: 'scene', id: made.sceneId });
  };

  return (
    <nav className="chapter-footer-nav" aria-label="Chapter navigation" data-testid="chapter-footer-nav">
      <div className="chapter-nav-side">
        {prev ? (
          <button type="button" className="btn btn-sm chapter-nav-btn" data-testid="chapter-prev" onClick={() => openChapter(prev.id, 'prev')} title={prev.title || 'Untitled chapter'}>
            ← Previous chapter
          </button>
        ) : (
          <span className="faint small">First chapter</span>
        )}
      </div>

      <span className="faint small">
        Chapter {idx + 1} of {chapters.length}
      </span>

      <div className="chapter-nav-side chapter-nav-right">
        <button
          type="button"
          className="btn btn-sm chapter-nav-btn"
          data-testid="chapter-next"
          onClick={() => (next ? openChapter(next.id, 'next') : createNextChapter())}
          title={next ? next.title || 'Untitled chapter' : 'Start the next chapter'}
        >
          Next chapter →
        </button>
      </div>
    </nav>
  );
}

function ChapterPreview({ scenes }: { scenes: Scene[] }) {
  return (
    <div data-testid="scene-preview">
      {scenes.map((s, i) => (
        <section key={s.id} className={i === 0 ? undefined : 'chapter-scene'} data-scene={s.title}>
          <Markdown text={`${s.title ? `# ${s.title}\n\n` : ''}${s.prose}`} contextSceneId={s.id} />
        </section>
      ))}
    </div>
  );
}

/** Same scenes, same text, same order: the editor already shows them. */
function sameScenes(a: Scene[], b: Scene[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

function ChapterEditor({ chapterId, activeSceneId, addScene }: { chapterId: Id; activeSceneId: Id; addScene: MutableRefObject<(() => void) | null> }) {
  const vault = useVault();
  const scenes = useMemo(() => chapterScenes(vault, chapterId), [vault, chapterId]);
  const [initial] = useState(() => composeChapter(scenes));
  const viewRef = useRef<EditorView | null>(null);
  /** The chapter's scenes as the editor knows them: anything else in the vault is a change from elsewhere. */
  const synced = useRef(scenes);
  const followRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    /** Makes the scene under the cursor the open scene (cast, timeline highlight, tab). */
    followRef.current = () => {
      const view = viewRef.current;
      if (!view) return;
      const id = sceneAtPos(view.state, view.state.selection.main.head);
      const st = useStore.getState();
      const open = st.view;
      if (!id || open.kind !== 'scene' || open.id === id || !st.vault.scenes[id]) return;
      // Only while the open scene belongs to this chapter (or was just merged away): not after navigating elsewhere.
      const current = st.vault.scenes[open.id];
      if (current && current.chapterId !== chapterId) return;
      st.navigate({ kind: 'scene', id });
    };
  }, [chapterId]);

  const extensions = useMemo(
    () => [
      ...chapterExtensions,
      sceneContext.of((state, pos) => sceneAtPos(state, pos)),
      EditorView.updateListener.of((u) => {
        if (u.selectionSet) followRef.current();
      }),
    ],
    [],
  );

  /** The editor's text becomes scenes: new headings are new scenes, deleted ones merge upward. */
  const onChange = (text: string) => {
    const view = viewRef.current;
    if (!view) return;
    const st = useStore.getState();
    const current = chapterScenes(st.vault, chapterId);
    const parsed = parseChapterText(text);
    const plan = reconcile(text, current, anchorsOf(view.state));
    const res = applyChapterPlan(st.vault, chapterId, plan);
    synced.current = chapterScenes(res.vault, chapterId);
    if (res.vault !== st.vault) st.commit(res.vault, `chapter:${chapterId}`);
    const anchors = plan.sections.map((_, i) => (parsed[i]?.hasHeading === false ? { id: res.ids[i], pos: 0, lead: true } : { id: res.ids[i], pos: parsed[i]?.from ?? 0 }));
    view.dispatch({ effects: [setAnchors.of(anchors), refreshLinks.of(null)] });
    if (res.diverged) replaceText(view, synced.current);
    followRef.current();
  };

  useEffect(() => {
    addScene.current = () => {
      const view = viewRef.current;
      if (!view) return;
      const len = view.state.doc.length;
      const gap = len === 0 || view.state.sliceDoc(Math.max(0, len - 2)) === '\n\n' ? '' : '\n\n';
      const insert = `${gap}# New scene\n\n`;
      view.dispatch({ changes: { from: len, insert }, selection: { anchor: len + insert.length }, effects: EditorView.scrollIntoView(len + insert.length, { y: 'center' }), userEvent: 'input' });
      view.focus();
    };
    return () => {
      addScene.current = null;
    };
  }, [addScene]);

  // A change from elsewhere (undo, a scene moved to another chapter, a link rewritten by a rename) replaces the text.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || sameScenes(scenes, synced.current)) return;
    synced.current = scenes;
    replaceText(view, scenes);
  }, [scenes]);

  // Opening a scene from outside scrolls to it.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (sceneAtPos(view.state, view.state.selection.main.head) === activeSceneId) return;
    const start = sceneStart(view.state, activeSceneId);
    if (start === undefined) return;
    const line = view.state.doc.lineAt(start);
    view.dispatch({ selection: { anchor: line.to }, effects: EditorView.scrollIntoView(start, { y: 'start', yMargin: 24 }) });
  }, [activeSceneId]);

  /** Offset of a scene's prose in the document, for "show this note" requests. */
  const locate = (sceneId: Id, pos: number): number | null => {
    const view = viewRef.current;
    if (!view) return null;
    const start = sceneStart(view.state, sceneId);
    if (start === undefined) return null;
    const section = parseChapterText(view.state.doc.toString()).find((s) => s.from === start);
    return section ? section.proseFrom + pos : null;
  };

  return (
    <Editor
      key={chapterId}
      value={initial.text}
      contextSceneId={activeSceneId}
      testId="scene-editor"
      editorId="manuscript-editor"
      extensions={extensions}
      locate={locate}
      onChange={onChange}
      onView={(view) => {
        viewRef.current = view;
        if (!view) return;
        view.dispatch({ effects: [setAnchors.of(initial.anchors), refreshLinks.of(null)] });
        const start = sceneStart(view.state, activeSceneId);
        if (start !== undefined && start > 0) view.dispatch({ effects: EditorView.scrollIntoView(start, { y: 'start', yMargin: 24 }) });
      }}
    />
  );
}

/** Replaces the whole document with the scenes' text, keeping the cursor where it was as far as it fits. */
function replaceText(view: EditorView, scenes: Scene[]): void {
  const composed = composeChapter(scenes);
  const head = Math.min(view.state.selection.main.head, composed.text.length);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: composed.text },
    selection: { anchor: head },
    effects: [setAnchors.of(composed.anchors), refreshLinks.of(null)],
  });
}
