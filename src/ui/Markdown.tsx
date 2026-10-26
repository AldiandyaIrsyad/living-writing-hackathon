// Rendered markdown with time-aware [[links]] and embeds.

import { useMemo } from 'react';
import { findEntity, findScene, resolveLinkTime, type ParsedLink } from '../core/links';
import { renderMarkdown, type RenderContext } from '../core/markdown';
import { formatValue } from '../core/resolve';
import type { Id, Vault } from '../core/types';
import { getResolver, useStore, useVault } from '../store/store';
import { describeTime, followLink } from './follow';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function makeRenderContext(vault: Vault, contextSceneId?: Id, depth = 0): RenderContext {
  return {
    depth,
    resolveLink(link: ParsedLink) {
      const e = findEntity(vault, link.target);
      if (e) return { resolved: true, kind: 'entity', id: e.id, display: link.alias ?? e.name };
      const s = findScene(vault, link.target);
      if (s) return { resolved: true, kind: 'scene', id: s.id, display: link.alias ?? s.title };
      return { resolved: false };
    },
    renderEmbed(link: ParsedLink, d: number) {
      const e = findEntity(vault, link.target);
      if (e) {
        const at = resolveLinkTime(vault, link.time, contextSceneId) ?? { kind: 'latest' };
        const state = getResolver(vault).entityAt(e.id, at);
        const props = Object.entries(state.props)
          .map(([k, p]) => `<div class="prop-line"><span class="k">${esc(k)}</span>: <span class="v">${esc(formatValue(p.value))}</span></div>`)
          .join('');
        const note = renderMarkdown(state.note, makeRenderContext(vault, contextSceneId, d)).html;
        return `<div class="embed-title"><strong>${esc(state.name)}</strong> <span class="faint small">${esc(describeTime(vault, at))}</span></div>${props}${note}`;
      }
      const s = findScene(vault, link.target);
      if (s) return `<div class="embed-title"><strong>${esc(s.title)}</strong></div>${renderMarkdown(s.prose, makeRenderContext(vault, s.id, d)).html}`;
      return '';
    },
  };
}

export function Markdown({ text, contextSceneId, testId }: { text: string; contextSceneId?: Id; testId?: string }) {
  const vault = useVault();
  const html = useMemo(() => renderMarkdown(text, makeRenderContext(vault, contextSceneId)).html, [text, vault, contextSceneId]);
  return (
    <div
      className="prose markdown"
      data-testid={testId}
      data-context-scene={contextSceneId}
      dangerouslySetInnerHTML={{ __html: html || '<p class="faint">Nothing written yet.</p>' }}
      onClick={(e) => {
        const el = e.target as HTMLElement;
        const link = el.closest<HTMLElement>('[data-link-target]');
        if (link) {
          e.preventDefault();
          followLink(link.dataset.linkTarget!, link.dataset.linkTime, contextSceneId);
          return;
        }
        const tag = el.closest<HTMLElement>('[data-tag]');
        if (tag) {
          e.preventDefault();
          useStore.getState().navigate({ kind: 'tag', tag: tag.dataset.tag! });
        }
      }}
    />
  );
}
