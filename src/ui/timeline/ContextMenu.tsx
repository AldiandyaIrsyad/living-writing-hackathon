// A small right-click menu for the timeline: opens at the pointer, closes on Esc, outside click, scroll or resize.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type MenuItem =
  | { kind: 'item'; label: string; hint?: string; disabled?: boolean; danger?: boolean; onSelect: () => void }
  | { kind: 'title'; label: string }
  | { kind: 'sep' };

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const actions = items.flatMap((it, i) => (it.kind === 'item' && !it.disabled ? [i] : []));
  const [active, setActive] = useState<number | null>(null);

  // Keep the menu on screen: flip to the other side of the pointer when it would run off an edge.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, x + width > window.innerWidth - 8 ? x - width : x),
      top: Math.max(8, y + height > window.innerHeight - 8 ? y - height : y),
    });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((cur) => {
          const at = cur === null ? -1 : actions.indexOf(cur);
          const next = at === -1 ? (step === 1 ? 0 : actions.length - 1) : (at + step + actions.length) % actions.length;
          return actions[next] ?? null;
        });
      } else if (e.key === 'Enter' && active !== null) {
        e.preventDefault();
        const it = items[active];
        if (it.kind === 'item') {
          onClose();
          it.onSelect();
        }
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    window.addEventListener('wheel', close, { passive: true, capture: true });
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('wheel', close, true);
    };
  });

  return createPortal(
    <div ref={ref} className="tl-ctx" role="menu" style={pos} data-testid="tl-context-menu" onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it.kind === 'sep' ? (
          <div key={i} className="tl-pop-sep" role="separator" />
        ) : it.kind === 'title' ? (
          <div key={i} className="tl-pop-title">
            {it.label}
          </div>
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`tl-ctx-item${it.danger ? ' danger' : ''}${active === i ? ' active' : ''}`}
            disabled={it.disabled}
            title={it.hint}
            data-testid="tl-context-item"
            onMouseEnter={() => !it.disabled && setActive(i)}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
          >
            {it.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
