// Editors for freeform property values.

import { useEffect, useId, useState } from 'react';
import { isLink, type PropValue, type Props, type ScalarValue } from '../core/types';
import { useStore, useVault } from '../store/store';

export type ValueKind = 'text' | 'number' | 'boolean' | 'link' | 'list';

export function kindOf(v: PropValue | undefined): ValueKind {
  if (Array.isArray(v)) return 'list';
  if (isLink(v)) return 'link';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'text';
}

function scalarToText(v: ScalarValue): string {
  return isLink(v) ? `[[${v.target}]]` : String(v);
}

function textToScalar(s: string): ScalarValue {
  const t = s.trim();
  const m = /^\[\[([^\]]+)\]\]$/.exec(t);
  if (m) return { kind: 'link', target: m[1].trim() };
  return t;
}

export function valueToText(v: PropValue | undefined): string {
  if (v === undefined) return '';
  if (Array.isArray(v)) return v.map(scalarToText).join(', ');
  if (isLink(v)) return v.target;
  return String(v);
}

export function textToValue(kind: ValueKind, s: string): PropValue {
  switch (kind) {
    case 'number': {
      const n = Number(s);
      return Number.isFinite(n) ? n : 0;
    }
    case 'boolean':
      return s === 'true';
    case 'link':
      return { kind: 'link', target: s.replace(/^\[\[|\]\]$/g, '').trim() };
    case 'list':
      return s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .map(textToScalar);
    default:
      return s;
  }
}

/** Datalist with all entity names — attach with `list={id}` on an input. */
export function EntityDatalist({ id }: { id: string }) {
  const vault = useVault();
  return (
    <datalist id={id}>
      {Object.values(vault.entities).map((e) => (
        <option key={e.id} value={e.name} />
      ))}
    </datalist>
  );
}

export function ValueInput({
  value,
  onChange,
  testId,
}: {
  value: PropValue | undefined;
  onChange: (v: PropValue) => void;
  testId?: string;
}) {
  const [kind, setKind] = useState<ValueKind>(kindOf(value));
  const [text, setText] = useState(valueToText(value));
  const listId = useId();
  // A refused retcon leaves the value as it was, so the field must show it again instead of what was typed.
  const refused = useStore((s) => s.proposalsRefused);
  useEffect(() => {
    setKind(kindOf(value));
    setText(valueToText(value));
  }, [value, refused]);

  const commit = (k: ValueKind, t: string) => onChange(textToValue(k, t));

  return (
    <div className="row grow" data-testid={testId}>
      <select
        className="select small"
        value={kind}
        aria-label="Value type"
        onChange={(e) => {
          const k = e.target.value as ValueKind;
          setKind(k);
          commit(k, k === 'boolean' ? 'true' : text);
        }}
      >
        <option value="text">text</option>
        <option value="number">number</option>
        <option value="boolean">yes/no</option>
        <option value="link">link</option>
        <option value="list">list</option>
      </select>
      {kind === 'boolean' ? (
        <select className="select grow" value={String(value === true)} onChange={(e) => commit(kind, e.target.value)} aria-label="Value">
          <option value="true">yes</option>
          <option value="false">no</option>
        </select>
      ) : (
        <>
          <input
            className="input grow"
            aria-label="Value"
            value={text}
            type={kind === 'number' ? 'number' : 'text'}
            list={kind === 'link' ? listId : undefined}
            placeholder={kind === 'list' ? 'a, b, [[Entity]]' : kind === 'link' ? 'Entity name' : ''}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => text !== valueToText(value) && commit(kind, text)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(kind, text);
            }}
          />
          {kind === 'link' && <EntityDatalist id={listId} />}
        </>
      )}
    </div>
  );
}

/** Key/value table editor for a Props object. */
export function PropsEditor({ props, onChange, testId }: { props: Props; onChange: (p: Props) => void; testId?: string }) {
  const [newKey, setNewKey] = useState('');
  const entries = Object.entries(props);
  const add = () => {
    const k = newKey.trim();
    if (!k || k in props) return;
    onChange({ ...props, [k]: '' });
    setNewKey('');
  };
  return (
    <div className="stack" data-testid={testId}>
      <table className="props">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} data-prop={k}>
              <th>{k}</th>
              <td>
                <div className="row">
                  <ValueInput value={v} onChange={(nv) => onChange({ ...props, [k]: nv })} />
                  <button
                    className="btn btn-ghost btn-sm"
                    title={`Remove ${k}`}
                    aria-label={`Remove ${k}`}
                    onClick={() => {
                      const next = { ...props };
                      delete next[k];
                      onChange(next);
                    }}
                  >
                    ×
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {!entries.length && (
            <tr>
              <td colSpan={2} className="muted small">
                No properties yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="row">
        <input
          className="input"
          placeholder="New property (e.g. status)"
          aria-label="New property name"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn btn-sm" onClick={add} disabled={!newKey.trim()}>
          Add property
        </button>
      </div>
    </div>
  );
}
