// One story track of the timeline: its header, chapter and arc bands, scene clips and the drop marker.

import { changeWhere } from '../../core/anchor';
import { formatValue } from '../../core/resolve';
import { STATUS_LABELS } from '../../core/status';
import type { Entity, Id, Vault } from '../../core/types';
import type { Relation } from '../../core/timeline';
import { useStore, useVault } from '../../store/store';
import { HEADER_W, METRICS, partTitle, shortLabel, trackHeight, keyframeInForce, type ClipModel, type Keyframe, type Span, type TrackModel } from './model';

/** Clips narrower than this (px) are slim coloured slivers: no title, no meta, no insert button. */
const NARROW_CLIP_PX = 64;
/** Thin edge zones (px) on a stretched clip's left and right: "before" and "after". Between them: "during". */
const EDGE_PX = 12;
/** Share of a clip's width that is an edge zone: the whole rule for one-column clips, a cap for stretched ones. */
const EDGE_SHARE = 0.2;

/** Where a dragged block would land, shown as a marker in the target's track. */
export interface Hint {
  sceneId: Id;
  relation: Relation;
  /** Column of the marker. */
  col: number;
  label: string;
}

/** What was right-clicked in a track. */
export type LaneContext = { kind: 'clip'; clip: ClipModel } | { kind: 'span'; span: Span; level: 'chapter' | 'arc' } | { kind: 'lane'; clientX: number };

export function relationKey(r: Relation): string {
  return typeof r === 'object' ? 'during' : r;
}

export function hintKey(h: Hint | null): string {
  return h ? `${h.sceneId}|${relationKey(h.relation)}|${h.col}` : '';
}

/**
 * The drop for a pointer over a clip. Thin edge zones on either side are before / after. A one-column clip's
 * middle is the same time; a stretched clip's middle is a "during" target for each column it covers (k = 0..span-1).
 */
function dropFor(e: React.DragEvent, el: HTMLElement, sceneId: Id, col: number, span: number, zoom: number): Hint {
  const r = el.getBoundingClientRect();
  const x = e.clientX - r.left;
  // A one-column clip is split by share (its middle is "same time"); a stretched clip gets thin edges so most of it is "during".
  const edge = span <= 1 ? r.width * EDGE_SHARE : Math.min(EDGE_PX, r.width * EDGE_SHARE);
  if (x < edge) return { sceneId, relation: 'before', col, label: 'before' };
  if (x > r.width - edge) return { sceneId, relation: 'after', col: col + span, label: 'after' };
  if (span <= 1) return { sceneId, relation: 'same', col, label: 'same time' };
  // The clip's left edge sits 2px inside its column, so the column under the pointer is floor((px + 2) / zoom).
  const k = Math.min(span - 1, Math.max(0, Math.floor((x + 2) / zoom)));
  return { sceneId, relation: { during: k }, col: col + k, label: `during · col ${k + 1}/${span}` };
}

export interface TrackProps {
  track: TrackModel;
  zoom: number;
  width: number;
  visible: (from: number, to: number) => boolean;
  selected: Set<Id>;
  hint: Hint | null;
  resizing: { sceneId: Id; span: number } | null;
  onResizeStart: (clip: ClipModel, e: React.PointerEvent) => void;
  flash: Id | null;
  involved: Set<Id> | null;
  changeCount: Map<Id, number>;
  activeSceneId: Id | null;
  playhead: number;
  onClip: (clip: ClipModel, e: React.MouseEvent) => void;
  onDragStartClip: (clip: ClipModel, e: React.DragEvent) => void;
  onDragEnd: () => void;
  onHint: (h: Hint | null) => void;
  onDropClip: (clip: ClipModel, relation: Relation, e: React.DragEvent) => void;
  onDropLane: (clientX: number, e: React.DragEvent) => void;
  onInsertAfter: (clip: ClipModel) => void;
  onInsertAtColumn: (clientX: number) => void;
  onSpan: (span: Span) => void;
  onContext: (target: LaneContext, e: React.MouseEvent) => void;
  onStoryDragStart: (e: React.DragEvent) => void;
  onNewSceneAtEnd: () => void;
}

export function Track(p: TrackProps) {
  const { track, zoom } = p;
  const m = METRICS;
  const color = track.story.color;
  const h = trackHeight(track);
  const navigate = useStore((s) => s.navigate);
  const toggleHidden = useStore((s) => s.toggleStoryHidden);
  let y = m.pad;
  const arcTop = y;
  if (track.arcs.length) y += m.arcBand + 3;
  const chTop = y;
  if (track.chapters.length) y += m.chapterBand + 3;
  const clipTop = y;
  // The drop marker, when the pointer is over a clip of this track.
  const marker = p.hint && track.clips.some((c) => c.scene.id === p.hint!.sceneId) ? p.hint : null;

  return (
    <div className="tl-track" style={{ height: h, ['--story' as string]: color }} data-testid="tl-track" data-story={track.story.name}>
      <div
        className="tl-track-head"
        style={{ width: HEADER_W }}
        draggable
        onDragStart={p.onStoryDragStart}
        onDragEnd={p.onDragEnd}
        data-testid="tl-story"
        data-story={track.story.name}
        title="Drag onto a scene to move the whole story"
      >
        <div className="tl-track-color" />
        <div className="grow tl-track-text">
          <a href="#" className="tl-track-name" onClick={(e) => (e.preventDefault(), navigate({ kind: 'story', id: track.story.id }))}>
            {track.story.name}
          </a>
          <div className="tl-track-meta">
            {track.clips.length} scenes{track.chapters.length ? ` · ${track.chapters.length} ch` : ''}
            {track.arcs.length ? ` · ${track.arcs.length} arcs` : ''}
          </div>
        </div>
        <button
          className="tl-icon"
          title="Remove from timeline (the story is kept — re-add it with + Track)"
          onClick={() => toggleHidden(track.story.id)}
          aria-label={`Remove ${track.story.name} from timeline`}
          data-testid="tl-track-remove"
        >
          ✕
        </button>
        <button className="tl-icon" title="New scene at the end of this story" onClick={p.onNewSceneAtEnd} data-testid="tl-story-add-scene">
          +
        </button>
      </div>
      <div
        className="tl-lane"
        style={{ width: p.width, ['--col' as string]: `${zoom}px` }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          if ((e.target as HTMLElement).closest('.tl-clip')) return;
          e.preventDefault();
          p.onDropLane(e.clientX, e);
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('.tl-clip, .tl-span')) return;
          p.onInsertAtColumn(e.clientX);
        }}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('.tl-clip, .tl-span')) return;
          p.onContext({ kind: 'lane', clientX: e.clientX }, e);
        }}
      >
        {track.arcs
          .filter((a) => p.visible(a.from, a.to))
          .map((a) => (
            <SpanBlock key={`${a.id}:${a.part}`} span={a} kind="arc" top={arcTop} height={m.arcBand} zoom={zoom} onClick={() => p.onSpan(a)} onContext={(e) => p.onContext({ kind: 'span', span: a, level: 'arc' }, e)} />
          ))}
        {track.chapters
          .filter((c) => p.visible(c.from, c.to))
          .map((c) => (
            <SpanBlock
              key={`${c.id}:${c.part}`}
              span={c}
              kind="chapter"
              top={chTop}
              height={m.chapterBand}
              zoom={zoom}
              onClick={() => p.onSpan(c)}
              onContext={(e) => p.onContext({ kind: 'span', span: c, level: 'chapter' }, e)}
            />
          ))}
        {track.clips
          .filter((c) => p.visible(c.col, c.col + c.span))
          .map((clip) => (
            <Clip key={clip.scene.id} clip={clip} top={clipTop + clip.stack * (m.clipH + m.gap)} height={m.clipH} {...p} />
          ))}
        {marker && (
          <div className={`tl-drop tl-drop-${relationKey(marker.relation)}`} style={{ left: marker.col * zoom }} data-testid="tl-drop" data-relation={relationKey(marker.relation)}>
            <span className="tl-drop-label">{marker.label}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function SpanBlock({
  span,
  kind,
  top,
  height,
  zoom,
  onClick,
  onContext,
}: {
  span: Span;
  kind: 'arc' | 'chapter';
  top: number;
  height: number;
  zoom: number;
  onClick: () => void;
  onContext: (e: React.MouseEvent) => void;
}) {
  const width = (span.to - span.from) * zoom - 2;
  const text = partTitle(span, span.title);
  const label = width > Math.max(48, text.length * 6.5) ? text : partTitle(span, shortLabel(span.title));
  const parts = span.parts > 1 ? ` — part ${span.part + 1} of ${span.parts}` : '';
  return (
    <div
      className={`tl-span tl-${kind}${span.parts > 1 ? ' split' : ''}${span.part > 0 ? ' cont-before' : ''}${span.part < span.parts - 1 ? ' cont-after' : ''}`}
      style={{ left: span.from * zoom + 1, width: Math.max(2, width), top, height }}
      onClick={onClick}
      onContextMenu={onContext}
      onDoubleClick={() => window.dispatchEvent(new CustomEvent('lw:timeline-zoom-range', { detail: { from: span.from, to: span.to } }))}
      title={`${span.title}${parts} — ${span.count} scene${span.count === 1 ? '' : 's'}`}
      data-testid={`tl-${kind}`}
      data-title={span.title}
      data-part={span.part}
      data-parts={span.parts}
    >
      {width > 14 && <span className="tl-span-label">{label}</span>}
    </div>
  );
}

function Clip({ clip, top, height, zoom, ...p }: { clip: ClipModel; top: number; height: number } & TrackProps) {
  const s = clip.scene;
  const vault = useVault();
  // While being stretched, the clip shows the span the pointer has reached.
  const span = p.resizing?.sceneId === s.id ? p.resizing.span : clip.span;
  const isHint = p.hint?.sceneId === s.id;
  const live = clip.col <= p.playhead && p.playhead < clip.col + span;
  const n = p.changeCount.get(s.id) ?? 0;
  const ch = s.chapterId ? vault.chapters[s.chapterId] : undefined;
  const narrow = zoom < NARROW_CLIP_PX;
  const cls = [
    'tl-clip',
    narrow ? 'narrow' : '',
    clip.floating ? 'floating' : '',
    p.selected.has(s.id) ? 'selected' : '',
    p.activeSceneId === s.id ? 'active' : '',
    live ? 'live' : '',
    p.involved && !p.involved.has(s.id) ? 'dim' : '',
    p.involved?.has(s.id) ? 'involved' : '',
    isHint ? `hint-${relationKey(p.hint!.relation)}` : '',
    p.flash === s.id ? 'flash' : '',
    p.resizing?.sceneId === s.id ? 'resizing' : '',
  ].join(' ');
  return (
    <div
      className={cls}
      style={{ left: clip.col * zoom + 2, width: Math.max(3, span * zoom - 4), top, height }}
      draggable
      data-testid="tl-scene"
      data-scene={s.title}
      data-column={clip.col}
      data-span={span}
      title={narrow ? s.title : undefined}
      onClick={(e) => p.onClip(clip, e)}
      onContextMenu={(e) => p.onContext({ kind: 'clip', clip }, e)}
      onDragStart={(e) => p.onDragStartClip(clip, e)}
      onDragEnd={p.onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        p.onHint(dropFor(e, e.currentTarget, s.id, clip.col, span, zoom));
      }}
      onDragLeave={() => isHint && p.onHint(null)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        p.onDropClip(clip, dropFor(e, e.currentTarget, s.id, clip.col, span, zoom).relation, e);
      }}
    >
      {!narrow && (
        <>
          <div className="tl-clip-title">
            {s.status && <span className={`status-dot status-${s.status}`} data-testid="clip-status" title={STATUS_LABELS[s.status]} />}
            {s.title}
          </div>
          <div className="tl-clip-meta">
            {ch && <span>{ch.title}</span>}
            <span title="Reading order">#{s.order + 1}</span>
            {n > 0 && (
              <span className="tl-delta" title={`${n} state change${n === 1 ? '' : 's'}`}>
                Δ{n}
              </span>
            )}
            {clip.floating && <span className="tl-float">floating</span>}
            {span > 1 && <span title="How many columns this scene spans">{span} cols</span>}
          </div>
          <button
            className="tl-insert"
            title="New scene right after this one"
            data-testid="tl-insert-after"
            onClick={(e) => {
              e.stopPropagation();
              p.onInsertAfter(clip);
            }}
          >
            +
          </button>
        </>
      )}
      {/* Mouse-down is cancelled so the browser does not start a native drag of the clip from its edge. */}
      <div
        className="tl-clip-resize"
        data-testid="tl-clip-resize"
        title="Drag to stretch this scene over more columns (Esc cancels)"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          p.onResizeStart(clip, e);
        }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

/** Height (px) of a character's or wiki page's row. */
export const CAST_H = 28;

/** What a keyframe stands for, one line per change: where it was made and what it did. */
function keyTitle(vault: Vault, k: Keyframe): string {
  return k.changes
    .map((c) => {
      const what = c.message ?? (c.op === 'set' ? `${c.property} → ${formatValue(c.value)}` : c.op === 'revise' ? 'page revised' : c.property ? `${c.property} ${c.op}` : c.op);
      return `${changeWhere(vault, c)}: ${what}${c.agent ? ` (by ${c.agent})` : ''}`;
    })
    .join('\n');
}

/**
 * A character's or wiki page's row: a keyframe where each of its changes takes effect. The playhead sees the new state
 * from that column on, so clicking a keyframe puts the playhead there. Keyframes the agent wrote are filled in.
 */
export function CastTrack({ entity, keyframes, zoom, width, visible, playhead }: { entity: Entity; keyframes: Keyframe[]; zoom: number; width: number; visible: (from: number, to: number) => boolean; playhead: number }) {
  const vault = useVault();
  const navigate = useStore((s) => s.navigate);
  const toggle = useStore((s) => s.toggleCastTrack);
  const setPlayhead = useStore((s) => s.setPlayhead);
  const color = vault.entityTypes[entity.typeId]?.color ?? '#888';
  const current = keyframeInForce(keyframes, playhead);
  const first = keyframes[0]?.col ?? 0;
  const last = keyframes[keyframes.length - 1]?.col ?? 0;
  return (
    <div className="tl-track tl-cast" style={{ height: CAST_H, ['--story' as string]: color }} data-testid="tl-cast" data-entity={entity.name}>
      <div className="tl-track-head tl-cast-head" style={{ width: HEADER_W }}>
        <div className="tl-track-color" />
        <div className="grow tl-track-text">
          <a href="#" className="tl-track-name" onClick={(e) => (e.preventDefault(), navigate({ kind: 'entity', id: entity.id }))}>
            {entity.name}
          </a>
        </div>
        <button className="tl-icon" title="Take off the timeline (the page is kept)" onClick={() => toggle(entity.id)} aria-label={`Remove ${entity.name} from timeline`} data-testid="tl-cast-remove">
          ✕
        </button>
      </div>
      <div className="tl-lane" style={{ width, ['--col' as string]: `${zoom}px` }}>
        {last > first && <div className="tl-cast-line" style={{ left: first * zoom, width: (last - first) * zoom }} />}
        {keyframes
          .filter((k) => visible(k.col, k.col))
          .map((k) => {
            const byAgent = k.changes.filter((c) => c.agent).length;
            const who = byAgent === 0 ? '' : byAgent === k.changes.length ? 'agent' : 'mixed';
            return (
              <button
                key={k.col}
                className={`tl-key ${who} ${current === k.col ? 'current' : ''}`}
                style={{ left: k.col * zoom }}
                title={keyTitle(vault, k)}
                aria-label={`${entity.name}: ${k.changes.length} change${k.changes.length === 1 ? '' : 's'} at column ${k.col + 1}`}
                onClick={() => setPlayhead(k.col)}
                data-testid="tl-key"
                data-column={k.col}
              />
            );
          })}
      </div>
    </div>
  );
}
