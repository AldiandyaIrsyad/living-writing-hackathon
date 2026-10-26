// Manuscript export dialog. Closed by default; opened by dispatching the window event
// `lw:export-manuscript` (optional detail: { storyId }). Options on the left, live preview on the right.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildManuscript, manuscriptFileName, toHTML, toMarkdown, toPlainText } from '../../core/manuscript';
import type { ManuscriptOptions } from '../../core/manuscript';
import type { Chapter, Id, Vault } from '../../core/types';
import { arcsOfStory, chaptersOfStory, sortedStories } from '../../store/actions';
import { useStore, useVault } from '../../store/store';
import './export.css';

export const EXPORT_EVENT = 'lw:export-manuscript';

interface ExportRequest {
  storyId?: Id;
}

type ExportFormat = 'md' | 'html' | 'txt';
type SceneSeparator = ManuscriptOptions['sceneSeparator'];

const MIME: Record<ExportFormat, string> = {
  md: 'text/markdown;charset=utf-8',
  html: 'text/html;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
};

export function ExportDialog() {
  const [request, setRequest] = useState<{ seq: number; storyId: Id | null } | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<ExportRequest | undefined>).detail;
      setRequest((prev) => ({ seq: (prev?.seq ?? 0) + 1, storyId: detail?.storyId ?? null }));
    };
    window.addEventListener(EXPORT_EVENT, onOpen);
    return () => window.removeEventListener(EXPORT_EVENT, onOpen);
  }, []);

  const close = useCallback(() => setRequest(null), []);

  if (request === null) return null;
  // Keyed by open request so every opening starts from fresh state.
  return <ExportModal key={request.seq} initialStoryId={request.storyId} onClose={close} />;
}

/** The story to export: the picked one if it still exists, else the current story, else the first. */
function resolveStory(vault: Vault, picked: Id | null, current: Id | null): Id | null {
  for (const id of [picked, current]) {
    if (id !== null && vault.stories[id] !== undefined) return id;
  }
  return sortedStories(vault)[0]?.id ?? null;
}

/** Indices (inclusive) of the chosen range; defaults cover the whole story. Empty story gives [0, -1]. */
function rangeIndices(chapters: Chapter[], from: Id | null, to: Id | null): [number, number] {
  if (chapters.length === 0) return [0, -1];
  const last = chapters.length - 1;
  const at = (id: Id | null, fallback: number): number => {
    const i = chapters.findIndex((c) => c.id === id);
    return i < 0 ? fallback : i;
  };
  const a = at(from, 0);
  const b = at(to, last);
  return [Math.min(a, b), Math.max(a, b)];
}

function chapterLabel(chapter: Chapter, vault: Vault): string {
  const arc = chapter.arcId !== undefined ? vault.arcs[chapter.arcId] : undefined;
  const name = chapter.title.trim() || 'Untitled chapter';
  return arc !== undefined && arc.storyId === chapter.storyId ? `${arc.title} · ${name}` : name;
}

function saveBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface ExportModalProps {
  initialStoryId: Id | null;
  onClose: () => void;
}

function ExportModal({ initialStoryId, onClose }: ExportModalProps) {
  const vault = useVault();
  const currentStoryId = useStore((s) => s.currentStoryId);
  const dialogRef = useRef<HTMLDivElement>(null);

  const [storyPick, setStoryPick] = useState<Id | null>(initialStoryId);
  const [fromPick, setFromPick] = useState<Id | null>(null);
  const [toPick, setToPick] = useState<Id | null>(null);
  const [includeUnchaptered, setIncludeUnchaptered] = useState(true);
  const [format, setFormat] = useState<ExportFormat>('md');
  const [chapterHeadings, setChapterHeadings] = useState(true);
  const [sceneSeparator, setSceneSeparator] = useState<SceneSeparator>('titles');
  const [keepNotes, setKeepNotes] = useState(false);
  const [onlyDone, setOnlyDone] = useState(false);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');

  const storyId = resolveStory(vault, storyPick, currentStoryId);
  const stories = sortedStories(vault);
  const chapters = useMemo(
    () => (storyId !== null ? chaptersOfStory(vault, storyId) : []),
    [vault, storyId],
  );
  const [lo, hi] = rangeIndices(chapters, fromPick, toPick);
  const selected = chapters.slice(lo, hi + 1);
  const arcs = storyId !== null ? arcsOfStory(vault, storyId) : [];
  const storyName = storyId !== null ? (vault.stories[storyId]?.name ?? '') : '';

  const output = useMemo(() => {
    if (storyId === null) return null;
    const opts: ManuscriptOptions = {
      storyId,
      chapterIds: chapters.slice(lo, hi + 1).map((c) => c.id),
      includeUnchaptered,
      sceneSeparator,
      chapterHeadings,
      keepNotes,
      onlyDone,
      title: title.trim() || undefined,
      author: author.trim() || undefined,
    };
    const m = buildManuscript(vault, opts);
    const text =
      format === 'md' ? toMarkdown(m, opts) : format === 'txt' ? toPlainText(m, opts) : toHTML(m, opts);
    return { m, text, fileName: manuscriptFileName(m, format) };
  }, [vault, storyId, chapters, lo, hi, includeUnchaptered, sceneSeparator, chapterHeadings, keepNotes, onlyDone, title, author, format]);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('select')?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pickStory = (id: Id) => {
    setStoryPick(id);
    setFromPick(null);
    setToPick(null);
    setTitle('');
  };

  const pickFrom = (id: Id) => {
    setFromPick(id);
    if (chapters.findIndex((c) => c.id === id) > hi) setToPick(id);
  };

  const pickTo = (id: Id) => {
    setToPick(id);
    if (chapters.findIndex((c) => c.id === id) < lo) setFromPick(id);
  };

  const selectRange = (ids: Chapter[]) => {
    if (ids.length === 0) return;
    setFromPick(ids[0].id);
    setToPick(ids[ids.length - 1].id);
  };

  const arcChapters = (arcId: Id) => chapters.filter((c) => c.arcId === arcId);
  const isSelected = (list: Chapter[]) =>
    list.length > 0 && list.length === selected.length && list.every((c, i) => c.id === selected[i].id);

  const download = () => {
    if (!output || output.m.chapters.length === 0) return;
    saveBlob(output.fileName, new Blob([output.text], { type: MIME[format] }));
    useStore.getState().toast('info', `Saved ${output.fileName}`);
  };

  const openPrintView = () => {
    if (!output || format !== 'html') return;
    const url = URL.createObjectURL(new Blob([output.text], { type: MIME.html }));
    const win = window.open(url, '_blank');
    if (!win) useStore.getState().toast('error', 'The browser blocked the print view. Allow pop-ups and try again.');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const realChapterCount = output ? output.m.chapters.filter((c) => c.id !== null).length : 0;
  const nothingToExport = output === null || output.m.chapters.length === 0;

  return (
    <div
      className="modal-backdrop export-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal export-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-heading"
        data-testid="export-dialog"
      >
        <header className="export-head">
          <h2 id="export-heading" className="export-heading">
            Export manuscript
          </h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close export">
            Close
          </button>
        </header>

        {storyId === null ? (
          <div className="empty">Create a story first, then export it here.</div>
        ) : (
          <div className="export-body">
            <div className="export-options">
              <section className="export-section">
                <label className="export-field">
                  <span className="export-label">Story</span>
                  <select
                    className="select"
                    data-testid="export-story"
                    value={storyId}
                    onChange={(e) => pickStory(e.target.value)}
                  >
                    {stories.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              <section className="export-section">
                <div className="export-label">Range</div>
                <div className="export-quick">
                  <button
                    type="button"
                    className={`btn btn-sm${isSelected(chapters) ? ' active' : ''}`}
                    data-testid="export-range-all"
                    disabled={chapters.length === 0}
                    onClick={() => selectRange(chapters)}
                  >
                    Whole story
                  </button>
                  {arcs.map((arc) => {
                    const list = arcChapters(arc.id);
                    return (
                      <button
                        key={arc.id}
                        type="button"
                        className={`btn btn-sm${list.length > 0 && isSelected(list) ? ' active' : ''}`}
                        data-testid={`export-arc-${arc.id}`}
                        disabled={list.length === 0}
                        onClick={() => selectRange(list)}
                      >
                        {arc.title}
                      </button>
                    );
                  })}
                </div>
                <div className="export-range">
                  <label className="export-field">
                    <span className="export-label">From chapter</span>
                    <select
                      className="select"
                      data-testid="export-from"
                      disabled={chapters.length === 0}
                      value={chapters[lo]?.id ?? ''}
                      onChange={(e) => pickFrom(e.target.value)}
                    >
                      {chapters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {chapterLabel(c, vault)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="export-field">
                    <span className="export-label">To chapter</span>
                    <select
                      className="select"
                      data-testid="export-to"
                      disabled={chapters.length === 0}
                      value={chapters[hi]?.id ?? ''}
                      onChange={(e) => pickTo(e.target.value)}
                    >
                      {chapters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {chapterLabel(c, vault)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {chapters.length === 0 && (
                  <p className="export-hint">This story has no chapters yet. Only scenes without a chapter can be exported.</p>
                )}
                <label className="export-check">
                  <input
                    type="checkbox"
                    data-testid="export-include-unchaptered"
                    checked={includeUnchaptered}
                    onChange={(e) => setIncludeUnchaptered(e.target.checked)}
                  />
                  Include scenes without a chapter
                </label>
              </section>

              <section className="export-section">
                <div className="export-label">Format</div>
                <div className="export-formats" role="radiogroup" aria-label="Format">
                  <label className="export-radio">
                    <input
                      type="radio"
                      name="export-format"
                      value="md"
                      checked={format === 'md'}
                      onChange={() => setFormat('md')}
                      data-testid="export-format-md"
                    />
                    Markdown
                  </label>
                  <label className="export-radio">
                    <input
                      type="radio"
                      name="export-format"
                      value="html"
                      checked={format === 'html'}
                      onChange={() => setFormat('html')}
                      data-testid="export-format-html"
                    />
                    HTML (print-ready)
                  </label>
                  <label className="export-radio">
                    <input
                      type="radio"
                      name="export-format"
                      value="txt"
                      checked={format === 'txt'}
                      onChange={() => setFormat('txt')}
                      data-testid="export-format-txt"
                    />
                    Plain text
                  </label>
                </div>
              </section>

              <section className="export-section">
                <div className="export-label">Layout</div>
                <label className="export-check">
                  <input
                    type="checkbox"
                    data-testid="export-chapter-headings"
                    checked={chapterHeadings}
                    onChange={(e) => setChapterHeadings(e.target.checked)}
                  />
                  Chapter headings
                </label>
                <label className="export-field">
                  <span className="export-label">Scene separator</span>
                  <select
                    className="select"
                    data-testid="export-separator"
                    value={sceneSeparator}
                    onChange={(e) => setSceneSeparator(e.target.value as SceneSeparator)}
                  >
                    <option value="titles">Scene titles</option>
                    <option value="breaks">Scene breaks (* * *)</option>
                    <option value="none">None</option>
                  </select>
                </label>
                <label className="export-check">
                  <input
                    type="checkbox"
                    data-testid="export-keep-notes"
                    checked={keepNotes}
                    onChange={(e) => setKeepNotes(e.target.checked)}
                  />
                  Keep author notes
                </label>
                <label className="export-check">
                  <input type="checkbox" data-testid="export-only-done" checked={onlyDone} onChange={(e) => setOnlyDone(e.target.checked)} />
                  Only scenes marked done
                </label>
              </section>

              <section className="export-section">
                <label className="export-field">
                  <span className="export-label">Title</span>
                  <input
                    className="input"
                    data-testid="export-title"
                    value={title}
                    placeholder={storyName}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label className="export-field">
                  <span className="export-label">Author</span>
                  <input
                    className="input"
                    data-testid="export-author"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                  />
                </label>
              </section>
            </div>

            <div className="export-preview-pane">
              <div className="export-preview-head">
                <span className="export-label">Preview</span>
                {output && (
                  <span className="export-stats" data-testid="export-stats">
                    {output.m.wordCount.toLocaleString()} words · {realChapterCount}{' '}
                    {realChapterCount === 1 ? 'chapter' : 'chapters'}
                  </span>
                )}
              </div>
              {output && format === 'html' ? (
                <iframe
                  className="export-frame"
                  title="Manuscript preview"
                  data-testid="export-preview"
                  sandbox=""
                  srcDoc={output.text}
                />
              ) : (
                <pre className="export-pre" data-testid="export-preview">
                  {output?.text ?? ''}
                </pre>
              )}
            </div>
          </div>
        )}

        {storyId !== null && (
          <footer className="export-foot">
            <span className="export-file">{output?.fileName ?? ''}</span>
            <div className="export-actions">
              {format === 'html' && (
                <button
                  type="button"
                  className="btn"
                  data-testid="export-print"
                  disabled={nothingToExport}
                  onClick={openPrintView}
                >
                  Open print view
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                data-testid="export-download"
                disabled={nothingToExport}
                onClick={download}
              >
                Download
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
