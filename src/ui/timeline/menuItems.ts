// What a right-click on the timeline offers, by what was clicked. Three kinds of thing live here, and each has its own verbs:
//   a scene (open, add next to it, make room around it, delete),
//   a chapter or arc bar (open, hop between its parts, add to it),
//   time itself, which is the empty lane or the ruler (add a scene here, insert a gap, close an empty column).

import { buildGraph } from '../../core/graph';
import { addStandaloneMilestone, deleteStandaloneMilestone, updateStandaloneMilestone } from '../../core/labels';
import { insertColumn, removeColumn, deleteScene, type Relation } from '../../core/timeline';
import type { Id } from '../../core/types';
import { useStore } from '../../store/store';
import type { MenuItem } from './ContextMenu';
import { targetForColumn, type ClipModel, type Span, type TimelineModel, type TrackModel } from './model';

export type MenuTarget =
  | { kind: 'clip'; clip: ClipModel }
  | { kind: 'span'; span: Span; level: 'chapter' | 'arc' }
  | { kind: 'lane'; col: number }
  | { kind: 'ruler'; col: number };

export interface MenuDeps {
  model: TimelineModel;
  /** The track clicked; null on the ruler. */
  track: TrackModel | null;
  selected: Set<Id>;
  setSelected: (s: Set<Id>) => void;
  /** Create a scene next to a target (or floating) and open it. */
  insertAt: (storyId: Id, relation: Relation | null, targetSceneId: Id | null, chapterId?: Id) => void;
}

const sep: MenuItem = { kind: 'sep' };

/** Insert a gap before `col`; says so when there is nowhere to put one. */
export function addGap(col: number): void {
  const s = useStore.getState();
  const next = insertColumn(s.vault, col);
  if (next === s.vault) s.toast('info', 'There is nothing to move there: no scene is placed at or after that column.');
  else s.commit(next);
}

export function buildMenu(target: MenuTarget, d: MenuDeps): MenuItem[] {
  const s = useStore.getState();
  const vault = s.vault;
  const track = d.track;

  /** "Insert gap before/after" for a column; the item is disabled when it would move nothing. */
  const gap = (col: number, label: string, hint: string): MenuItem => ({
    kind: 'item',
    label,
    hint,
    disabled: insertColumn(vault, col) === vault,
    onSelect: () => addGap(col),
  });
  const close = (col: number): MenuItem[] => {
    const next = removeColumn(vault, col);
    return next === vault ? [] : [{ kind: 'item', label: `Remove empty column ${col + 1}`, hint: 'Close the gap: everything after it moves one column left', onSelect: () => useStore.getState().commit(next) }];
  };
  const newHere = (col: number): MenuItem[] => {
    if (!track) return [];
    const t = targetForColumn(vault, d.model, col);
    return [{ kind: 'item', label: `New scene in column ${col + 1}`, onSelect: () => d.insertAt(track.story.id, t?.relation ?? null, t?.sceneId ?? null) }];
  };

  if (target.kind === 'clip' && track) {
    const { clip } = target;
    const sc = clip.scene;
    const picked = d.selected.has(sc.id);
    return [
      { kind: 'item', label: 'Open scene', onSelect: () => (s.navigate({ kind: 'scene', id: sc.id }), s.setPlayhead(clip.col)) },
      sep,
      { kind: 'title', label: 'Add' },
      { kind: 'item', label: 'New scene before', onSelect: () => d.insertAt(track.story.id, 'before', sc.id) },
      { kind: 'item', label: 'New scene after', onSelect: () => d.insertAt(track.story.id, 'after', sc.id) },
      { kind: 'item', label: 'New scene at the same time', onSelect: () => d.insertAt(track.story.id, 'same', sc.id) },
      sep,
      { kind: 'title', label: 'Make room' },
      gap(clip.col, 'Insert gap before this scene', 'Everything from this scene on moves one column right, in every story'),
      gap(clip.col + clip.span, 'Insert gap after this scene', 'Everything after this scene moves one column right, in every story'),
      sep,
      {
        kind: 'item',
        label: picked ? 'Deselect' : 'Select (to drag several)',
        onSelect: () => {
          const next = new Set(d.selected);
          if (picked) next.delete(sc.id);
          else next.add(sc.id);
          d.setSelected(next);
        },
      },
      {
        kind: 'item',
        label: 'Delete scene…',
        danger: true,
        onSelect: () => {
          if (window.confirm(`Delete scene “${sc.title}”?`)) useStore.getState().commit(deleteScene(useStore.getState().vault, sc.id));
        },
      },
    ];
  }

  if (target.kind === 'span' && track) {
    const { span, level } = target;
    const same = (level === 'chapter' ? track.chapters : track.arcs).filter((p) => p.id === span.id);
    const prev = same[span.part - 1];
    const next = same[span.part + 1];
    const first = track.clips.find((c) => c.col === span.from);
    const hop = (p: Span) => () => {
      const st = useStore.getState();
      st.revealColumn(p.from, p.from);
    };
    const out: MenuItem[] = [{ kind: 'item', label: level === 'chapter' ? 'Open chapter' : 'Open arc', disabled: !first, onSelect: () => first && (s.setPlayhead(span.from), s.navigate({ kind: 'scene', id: first.scene.id })) }];
    out.push({
      kind: 'item',
      label: level === 'chapter' ? 'Zoom to chapter' : 'Zoom to arc',
      hint: span.parts > 1 ? 'Frames this part only' : undefined,
      onSelect: () => window.dispatchEvent(new CustomEvent('lw:timeline-zoom-range', { detail: { from: span.from, to: span.to } })),
    });
    if (span.parts > 1) {
      out.push(sep, { kind: 'title', label: `Part ${span.part + 1} of ${span.parts}` });
      out.push({ kind: 'item', label: '‹ Go to the previous part', disabled: !prev, onSelect: prev ? hop(prev) : () => {} });
      out.push({ kind: 'item', label: 'Go to the next part ›', disabled: !next, onSelect: next ? hop(next) : () => {} });
    }
    if (level === 'chapter') {
      const mine = track.clips.filter((c) => c.scene.chapterId === span.id);
      const last = [...mine].sort((a, b) => b.col + b.span - (a.col + a.span))[0];
      out.push(sep, { kind: 'item', label: 'New scene at the end of this chapter', disabled: !last, onSelect: () => last && d.insertAt(track.story.id, 'after', last.scene.id, span.id) });
    }
    return out;
  }

  if (target.kind === 'lane') {
    const { col } = target;
    return [
      ...newHere(col),
      {
        kind: 'item',
        label: 'Add milestone label / concrete date…',
        hint: 'Pin an event bookmark or guaranteed date without creating a scene',
        onSelect: () => promptMilestoneAtColumn(col, d.model),
      },
      ...milestoneEditItems(col),
      sep,
      { kind: 'title', label: `Make room · column ${col + 1}` },
      gap(col, 'Insert gap here', 'Column here and everything after it moves one column right, in every story'),
      ...close(col),
    ];
  }

  if (target.kind === 'ruler') {
    const { col } = target;
    return [
      { kind: 'title', label: `Column ${col + 1}` },
      {
        kind: 'item',
        label: 'Add milestone label / concrete date…',
        hint: 'Pin an event bookmark or guaranteed date on the timeline',
        onSelect: () => promptMilestoneAtColumn(col, d.model),
      },
      ...milestoneEditItems(col),
      sep,
      gap(col, 'Insert gap before this column', 'This column and everything after it move one column right, in every story'),
      gap(col + 1, 'Insert gap after this column', 'Everything after this column moves one column right, in every story'),
      ...close(col),
    ];
  }
  return [];
}

function milestoneEditItems(col: number): MenuItem[] {
  const s = useStore.getState();
  const graph = buildGraph(s.vault);
  const moments = Object.values(s.vault.moments).filter(
    (m) => graph.layerOf(m.id) === col && ((m.labels && m.labels.length > 0) || m.concrete || m.label || m.timeSkip),
  );
  if (moments.length === 0) return [];
  const items: MenuItem[] = [];
  for (const m of moments) {
    const summary = [...(m.labels ?? []), m.concrete ?? m.label, m.timeSkip].filter(Boolean).join(' · ');
    items.push({
      kind: 'item',
      label: `Edit milestone “${summary}”…`,
      onSelect: () => {
        const curLabel = (m.labels ?? []).join(', ');
        const curConcrete = m.concrete ?? m.label ?? '';
        const nextLabel = window.prompt('Milestone label(s) (comma-separated, or blank to clear):', curLabel);
        if (nextLabel === null) return;
        const nextConcrete = window.prompt('Concrete date (or blank to clear):', curConcrete);
        if (nextConcrete === null) return;
        const r = updateStandaloneMilestone(useStore.getState().vault, m.id, {
          labels: nextLabel.split(',').map((x) => x.trim()).filter(Boolean),
          concrete: nextConcrete,
        });
        if (!r.ok) {
          useStore.getState().toast('error', r.error);
          return;
        }
        useStore.getState().commit(r.vault);
      },
    });
    items.push({
      kind: 'item',
      label: `Delete milestone “${summary}”`,
      danger: true,
      onSelect: () => {
        const st = useStore.getState();
        st.commit(deleteStandaloneMilestone(st.vault, m.id));
        st.toast('info', `Removed milestone “${summary}”`);
      },
    });
  }
  return items;
}

function promptMilestoneAtColumn(col: number, model: TimelineModel): void {
  const s = useStore.getState();
  const label = window.prompt('Milestone label (e.g. The Death of Hero Nora):', '')?.trim();
  const concrete = window.prompt('Concrete date (optional, e.g. Autumn, 2026 or 2026-10-25):', '')?.trim();
  if (!label && !concrete) return;
  const t = targetForColumn(s.vault, model, col);
  const targetMomentId = t ? s.vault.scenes[t.sceneId]?.momentId : undefined;
  if (t?.relation === 'same' && targetMomentId && s.vault.moments[targetMomentId]) {
    const cur = s.vault.moments[targetMomentId];
    const nextLabels = label ? [...new Set([...(cur.labels ?? []), label])] : cur.labels;
    const r = updateStandaloneMilestone(s.vault, targetMomentId, {
      labels: nextLabels,
      ...(concrete ? { concrete } : {}),
    });
    if (!r.ok) {
      s.toast('error', r.error);
      return;
    }
    s.commit(r.vault);
    s.toast('info', `Added milestone ${[label && `“${label}”`, concrete].filter(Boolean).join(' · ')}`);
    return;
  }
  const r = addStandaloneMilestone(s.vault, {
    label: label || undefined,
    concrete: concrete || undefined,
    beforeMomentId: t?.relation === 'before' ? targetMomentId : undefined,
    afterMomentId: t?.relation === 'after' ? targetMomentId : undefined,
  });
  if (!r.ok) {
    s.toast('error', r.error);
    return;
  }
  s.commit(r.vault);
  s.toast('info', `Added milestone ${[label && `“${label}”`, concrete].filter(Boolean).join(' · ')}`);
}
