// The timeline ruler: column ticks and numbers. Pointer down on it moves the playhead.

import { HEADER_W, RULER_H, RULER_LABEL_H, type TimelineModel } from './model';
import { AddTrackMenu } from './Toolbar';

export function Ruler({
  model,
  zoom,
  c0,
  c1,
  totalCols,
  onScrub,
  onContext,
}: {
  model: TimelineModel;
  zoom: number;
  c0: number;
  c1: number;
  totalCols: number;
  onScrub: (e: React.PointerEvent) => void;
  onContext: (e: React.MouseEvent) => void;
}) {
  // Label spacing: at least ~70px between labels, in nice steps.
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  const step = steps.find((s) => s * zoom >= 70) ?? 1000;
  const minor = steps.find((s) => s * zoom >= 10) ?? 1000;
  const ticks: React.ReactNode[] = [];
  const from = Math.max(0, Math.floor(c0 / minor) * minor);
  for (let c = from; c <= Math.min(c1, totalCols); c += minor) {
    const major = c % step === 0;
    ticks.push(<div key={c} className={`tl-tick ${major ? 'major' : ''}`} style={{ left: HEADER_W + c * zoom }} />);
    if (major) {
      ticks.push(
        <div key={`l${c}`} className="tl-tick-label" style={{ left: HEADER_W + c * zoom + 4 }}>
          {c + 1}
        </div>,
      );
    }
  }
  // Labels (dates, seasons…) sit on a second line, each running up to the next label: they are about time, not about the tick.
  const labels = model.labels;
  const labelEls = labels.flatMap((l, i) => {
    const next = labels[i + 1]?.col ?? Infinity;
    if (next < c0 || l.col > c1) return [];
    const width = Math.min(next - l.col, 400) * zoom - 6;
    if (width < 24) return [];
    return [
      <div key={`m${l.col}`} className="tl-moment-label" style={{ left: HEADER_W + l.col * zoom + 1, maxWidth: width }} title={`${l.text} — column ${l.col + 1}`} data-testid="tl-moment-label">
        {l.text}
      </div>,
    ];
  });
  return (
    <div className="tl-ruler" style={{ height: labels.length ? RULER_LABEL_H : RULER_H }} onPointerDown={onScrub} onContextMenu={onContext} data-testid="tl-ruler">
      <div className="tl-ruler-head" style={{ width: HEADER_W }} onPointerDown={(e) => e.stopPropagation()}>
        <AddTrackMenu />
      </div>
      {ticks}
      {labelEls}
    </div>
  );
}
