// Import a folder (or zip) of Markdown notes as entities. The report comes first; nothing is written until "Import".

import { useEffect, useMemo, useRef, useState } from 'react';
import { applyNotesImport, planNotesImport, type NoteFile } from '../core/notesImport';
import { useStore } from '../store/store';
import { flushEditors } from './editor/Editor';
import './impact.css';

export const OPEN_IMPORT_NOTES_EVENT = 'lw:import-notes';

/** Rows of a list drawn at most; the counts above them are always complete. */
const ROWS = 40;

/** Reads the notes of a picked folder. Other files are listed (so they can be reported as skipped) but not read. */
async function readFolder(list: FileList): Promise<NoteFile[]> {
  const files = Array.from(list);
  return Promise.all(
    files.map(async (file) => {
      const full = file.webkitRelativePath || file.name;
      const path = full.includes('/') ? full.slice(full.indexOf('/') + 1) : full; // without the picked folder's own name
      return { path, text: /\.md$/i.test(path) ? await file.text() : '' };
    }),
  );
}

async function readZip(file: File): Promise<NoteFile[]> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files).filter((e) => !e.dir);
  const out: NoteFile[] = [];
  for (const e of entries) out.push({ path: e.name, text: /\.md$/i.test(e.name) ? await e.async('string') : '' });
  // A zip of a folder usually has that folder as its only top-level entry; the types come from the folders inside it.
  const tops = new Set(out.map((f) => f.path.split('/')[0]));
  if (tops.size === 1 && out.every((f) => f.path.includes('/'))) return out.map((f) => ({ ...f, path: f.path.slice(f.path.indexOf('/') + 1) }));
  return out;
}

export function ImportNotesDialog() {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<NoteFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stubs, setStubs] = useState(true);
  const vault = useStore((s) => s.vault);
  const folderRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const show = () => {
      setFiles(null);
      setError(null);
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener(OPEN_IMPORT_NOTES_EVENT, show);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_IMPORT_NOTES_EVENT, show);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const plan = useMemo(() => (files ? planNotesImport(vault, files) : null), [vault, files]);
  if (!open) return null;

  const load = async (read: () => Promise<NoteFile[]>) => {
    try {
      setError(null);
      setFiles(await read());
    } catch (e) {
      setFiles(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const doImport = () => {
    if (!plan) return;
    flushEditors();
    const s = useStore.getState();
    // Planned against the vault as it was when the folder was read; plan again against what is there now.
    const fresh = planNotesImport(s.vault, files ?? []);
    s.commit(applyNotesImport(s.vault, fresh, { createStubs: stubs }), undefined, 'Import notes');
    const updated = fresh.notes.filter((n) => n.updates !== null).length;
    const empty = stubs ? fresh.unresolved.length : 0;
    s.toast('info', `Imported ${fresh.notes.length - updated} new and updated ${updated} existing pages${empty > 0 ? `, plus ${empty} empty ${empty === 1 ? 'page' : 'pages'} for links that led nowhere` : ''}. Undo puts everything back.`);
    setOpen(false);
  };

  const updates = plan?.notes.filter((n) => n.updates !== null).length ?? 0;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal impact-modal" role="dialog" aria-modal="true" aria-label="Import notes" data-testid="import-notes-dialog">
        <header className="impact-head">
          <h2 className="impact-heading">Import notes</h2>
          <p className="impact-lead">
            Each Markdown file becomes a page. The first folder name suggests its type (Characters → Character), the frontmatter gives properties,
            aliases and tags, and <code>[[links]]</code> work as they are.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-sm" onClick={() => folderRef.current?.click()} data-testid="import-notes-folder">
              Choose a folder…
            </button>
            <button className="btn btn-sm" onClick={() => zipRef.current?.click()}>
              Choose a .zip…
            </button>
            <input
              ref={folderRef}
              type="file"
              hidden
              multiple
              // @ts-expect-error webkitdirectory is not in the DOM typings but is supported by every current browser.
              webkitdirectory=""
              data-testid="import-notes-folder-input"
              onChange={(e) => {
                const list = e.target.files;
                if (list && list.length > 0) void load(() => readFolder(list));
                e.target.value = '';
              }}
            />
            <input
              ref={zipRef}
              type="file"
              accept=".zip"
              hidden
              data-testid="import-notes-zip-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void load(() => readZip(f));
                e.target.value = '';
              }}
            />
          </div>
          {error && (
            <p className="impact-lead" data-testid="import-notes-error">
              Could not read that: {error}
            </p>
          )}
        </header>

        {plan && (
          <>
            <ul className="impact-list" data-testid="import-notes-report">
              <li className="impact-row" data-testid="import-notes-summary">
                <strong>{plan.notes.length}</strong> notes: {plan.notes.length - updates} new pages, {updates} already exist and would be updated.
              </li>
              {plan.newTypes.length > 0 && <li className="impact-row">New types: {plan.newTypes.join(', ')}</li>}
              <li className="impact-row">
                Links: {plan.resolvedLinks} lead somewhere, {plan.unresolved.length} {plan.unresolved.length === 1 ? 'target leads' : 'targets lead'} nowhere
                {plan.unresolved.length > 0 && <span className="problem-hint"> ({plan.unresolved.slice(0, ROWS).join(', ')}{plan.unresolved.length > ROWS ? ', …' : ''})</span>}
              </li>
              {plan.skipped.length > 0 && (
                <li className="impact-row" data-testid="import-notes-skipped">
                  Skipped {plan.skipped.length}:{' '}
                  {plan.skipped
                    .slice(0, 8)
                    .map((s) => `${s.path} (${s.reason})`)
                    .join('; ')}
                  {plan.skipped.length > 8 ? '; …' : ''}
                </li>
              )}
            </ul>
            {plan.unresolved.length > 0 && (
              <label className="export-check" style={{ margin: '0 16px' }}>
                <input type="checkbox" checked={stubs} onChange={(e) => setStubs(e.target.checked)} data-testid="import-notes-stubs" />
                Add an empty page for each link that leads nowhere
              </label>
            )}
          </>
        )}

        <footer className="impact-foot">
          <span className="grow faint">{plan ? 'Nothing is written until you press Import. Undo reverses it in one step.' : ''}</span>
          <button className="btn btn-sm" onClick={() => setOpen(false)}>
            Close
          </button>
          <button className="btn btn-sm btn-primary" disabled={!plan || plan.notes.length === 0} onClick={doImport} data-testid="import-notes-apply">
            Import
          </button>
        </footer>
      </div>
    </div>
  );
}
