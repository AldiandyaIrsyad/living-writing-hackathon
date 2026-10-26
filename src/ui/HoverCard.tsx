// Global hover card for [[links]] — one delegated listener for editors and rendered markdown.

import { useEffect, useRef, useState } from 'react';
import { getResolver, useStore, useVault } from '../store/store';
import { PropLines } from './EntityState';
import { describeTime, followLink, resolveLinkInfo, type LinkInfo } from './follow';

interface Hover extends LinkInfo {
  rect: DOMRect;
}

export function HoverCard() {
  const vault = useVault();
  const [hover, setHover] = useState<Hover | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const current = useRef<Element | null>(null);

  useEffect(() => {
    const clearTimers = () => {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    const over = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target || !(target instanceof Element)) return;
      if (card.current?.contains(target)) {
        clearTimers();
        return;
      }
      const el = target.closest<HTMLElement>('[data-link-target]');
      if (!el) return;
      if (el === current.current) {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        return;
      }
      clearTimers();
      current.current = el;
      showTimer.current = setTimeout(() => {
        setHover({
          target: el.dataset.linkTarget!,
          timeRaw: el.dataset.linkTime,
          contextSceneId: el.closest<HTMLElement>('[data-context-scene]')?.dataset.contextScene,
          rect: el.getBoundingClientRect(),
        });
      }, 120);
    };
    const out = (e: MouseEvent) => {
      const to = e.relatedTarget as Element | null;
      if (to && (card.current?.contains(to) || (current.current && current.current.contains(to)))) return;
      if (showTimer.current) clearTimeout(showTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        current.current = null;
        setHover(null);
      }, 250);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setHover(null);
    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    document.addEventListener('keydown', key);
    const unsub = useStore.subscribe((s, p) => s.view !== p.view && setHover(null));
    return () => {
      clearTimers();
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseout', out);
      document.removeEventListener('keydown', key);
      unsub();
    };
  }, []);

  if (!hover) return null;
  const r = resolveLinkInfo(vault, hover);
  const top = hover.rect.bottom + 6 + 260 > window.innerHeight ? Math.max(8, hover.rect.top - 266) : hover.rect.bottom + 6;
  const left = Math.min(Math.max(8, hover.rect.left), window.innerWidth - 310);
  const close = () => {
    current.current = null;
    setHover(null);
  };

  let body: React.ReactNode;
  if (r.kind === 'entity' || r.kind === 'badtime') {
    const e = vault.entities[r.id];
    const type = vault.entityTypes[e.typeId];
    const at = r.kind === 'entity' ? r.at : { kind: 'latest' as const };
    const state = getResolver(vault).entityAt(e.id, at);
    const ctx = hover.contextSceneId ? vault.scenes[hover.contextSceneId] : undefined;
    const here = ctx && hover.timeRaw === undefined ? getResolver(vault).changesDuring(e.id, ctx.id) : [];
    const inScene = useStore.getState().view.kind === 'scene';
    body = (
      <>
        <div className="hc-title">
          {e.image ? (
            <img src={e.image} alt={state.name} style={{ width: 22, height: 22, borderRadius: 5, objectFit: 'cover' }} />
          ) : (
            <span className="dot" style={{ background: type?.color }} />
          )}
          {state.name}
          <span className="badge">{type?.name}</span>
        </div>
        <div className="hc-time" data-testid="hc-time">
          {r.kind === 'badtime' ? `Unknown scene “${r.timeRaw}” — showing latest` : describeTime(vault, at)}
        </div>
        <PropLines vault={vault} state={state} limit={8} />
        {here.length > 0 && (
          <div className="small muted" style={{ marginTop: 6 }}>
            Changes in this scene:{' '}
            {here.map((c) => (c.property ? `${c.property} → ${c.op === 'set' ? String(c.value && typeof c.value === 'object' && 'target' in c.value ? c.value.target : c.value) : c.op}` : c.op === 'revise' ? 'page revised' : c.op)).join(', ')}
          </div>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <button
            className="btn btn-sm"
            onClick={() => {
              close();
              followLink(hover.target, hover.timeRaw, hover.contextSceneId);
            }}
          >
            {inScene ? 'Quick edit (floating)' : 'Open'}
          </button>
          {inScene && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                close();
                useStore.getState().navigate({ kind: 'entity', id: r.id, at });
              }}
            >
              ⤢ Full page
            </button>
          )}
        </div>
      </>
    );
  } else if (r.kind === 'scene') {
    const s = vault.scenes[r.id];
    body = (
      <>
        <div className="hc-title">{s.title}</div>
        <div className="hc-time">
          {vault.stories[s.storyId]?.name}
          {s.chapterId ? ` · ${vault.chapters[s.chapterId]?.title}` : ''}
        </div>
        <div className="small muted">{s.prose.slice(0, 220) || 'Empty scene.'}</div>
        <div className="row" style={{ marginTop: 8 }}>
          <button
            className="btn btn-sm"
            onClick={() => {
              close();
              useStore.getState().navigate({ kind: 'scene', id: s.id });
            }}
          >
            Open
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <div className="hc-title">{r.target}</div>
        <div className="small muted">Nothing is called “{r.target}” yet.</div>
        <div className="row" style={{ marginTop: 8 }}>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => {
              close();
              followLink(r.target, hover.timeRaw, hover.contextSceneId);
            }}
          >
            Create “{r.target}”
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="hovercard" ref={card} data-testid="hovercard" style={{ top, left }} onMouseLeave={close}>
      {body}
    </div>
  );
}
