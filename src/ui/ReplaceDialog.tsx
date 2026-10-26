// Find and replace across the vault: prose, entity pages and page revisions. Matches are listed with a checkbox each;
// "Replace" applies exactly the checked ones as a single undo step. Link targets, code and frontmatter are never changed.

import { useEffect, useMemo, useState } from 'react';
import { findMatches, replaceMatches, type FindOptions, type Match } from '../core/replace';
import { update, useStore } from '../store/store';
import './impact.css';

export const OPEN_REPLACE_EVENT = 'lw:replace';

/** Rows drawn; every match is still found and can be replaced. */
const ROWS = 200;

export function ReplaceDialog() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [preserveCase, setPreserveCase] = useState(false);
  const [scope, setScope] = useState({ prose: true, entityNotes: true, revisions: true });
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const vault = useStore((s) => s.vault);

  useEffect(() => {
    const show = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener(OPEN_REPLACE_EVENT, show);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_REPLACE_EVENT, show);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const found = useMemo(() => {
    if (!open || query === '') return null;
    const opts: FindOptions = { query, regex, caseSensitive, wholeWord, includeNotes, scope };
    return findMatches(vault, opts);
  }, [open, vault, query, regex, caseSensitive, wholeWord, includeNotes, scope]);
  if (!open) return null;

  const matches: Match[] = found?.ok ? found.matches : [];
  const chosen = matches.filter((m) => !unchecked.has(m.key));
  const toggle = (key: string) => {
    const next = new Set(unchecked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setUnchecked(next);
  };
  const apply = () => {
    update((v) => replaceMatches(v, chosen, replacement, { regex, preserveCase }));
    useStore.getState().toast('info', `Replaced ${chosen.length} match${chosen.length === 1 ? '' : 'es'}. Undo puts them back.`);
    setUnchecked(new Set());
  };
  const flag = (label: string, checked: boolean, set: (b: boolean) => void, testId: string) => (
    <label className="export-check">
      <input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} data-testid={testId} />
      {label}
    </label>
  );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal impact-modal" role="dialog" aria-modal="true" aria-label="Find and replace" data-testid="replace-dialog">
        <header className="impact-head">
          <h2 className="impact-heading">Find and replace</h2>
          <div className="replace-fields">
            <input
              className="input"
              placeholder="Find"
              aria-label="Find"
              data-testid="replace-find"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setUnchecked(new Set());
              }}
              autoFocus
            />
            <input className="input" placeholder="Replace with" aria-label="Replace with" data-testid="replace-with" value={replacement} onChange={(e) => setReplacement(e.target.value)} />
          </div>
          <div className="replace-flags">
            {flag('Regular expression', regex, setRegex, 'replace-regex')}
            {flag('Match case', caseSensitive, setCaseSensitive, 'replace-case')}
            {flag('Whole word', wholeWord, setWholeWord, 'replace-word')}
            {flag('Keep capitals (one word)', preserveCase, setPreserveCase, 'replace-keepcase')}
            {flag('Author notes too', includeNotes, setIncludeNotes, 'replace-notes')}
          </div>
          <div className="replace-flags">
            {flag('Scenes', scope.prose, (b) => setScope({ ...scope, prose: b }), 'replace-scope-prose')}
            {flag('Entity pages', scope.entityNotes, (b) => setScope({ ...scope, entityNotes: b }), 'replace-scope-pages')}
            {flag('Page revisions', scope.revisions, (b) => setScope({ ...scope, revisions: b }), 'replace-scope-revisions')}
          </div>
          <p className="impact-lead">Link targets, code and frontmatter are never changed. The words a link shows are.</p>
          {found && !found.ok && (
            <p className="impact-lead" data-testid="replace-error">
              {found.error}
            </p>
          )}
        </header>
        <ul className="impact-list" data-testid="replace-list">
          {matches.slice(0, ROWS).map((m) => (
            <li key={m.key} className="impact-row" data-testid="replace-row">
              <label className="replace-row">
                <input type="checkbox" checked={!unchecked.has(m.key)} onChange={() => toggle(m.key)} />
                <span>
                  <strong>{m.where}</strong>
                  <span className="problem-hint">
                    {' '}
                    …{m.before}
                    <mark>{m.text}</mark>
                    {m.after}…
                  </span>
                </span>
              </label>
            </li>
          ))}
          {matches.length > ROWS && <li className="impact-more faint">and {matches.length - ROWS} more (all are replaced unless unchecked above)</li>}
        </ul>
        <footer className="impact-foot">
          <span className="grow faint" data-testid="replace-count">
            {found?.ok ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : ''}
          </span>
          <button className="btn btn-sm" onClick={() => setOpen(false)}>
            Close
          </button>
          <button className="btn btn-sm btn-primary" disabled={chosen.length === 0} onClick={apply} data-testid="replace-apply">
            Replace {chosen.length || ''}
          </button>
        </footer>
      </div>
    </div>
  );
}
