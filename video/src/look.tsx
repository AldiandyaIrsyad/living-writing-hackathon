// Living Writing film: design tokens (DESIGN.md "the timetable") and motion helpers.
// Motion helpers are copied from video-shotcraft demos/_fixtures/Polish.tsx (bezier, EASE, ramp,
// mix, velocity, SpeedBlur) with their tuned values unchanged. Everything is a pure function of
// the frame: no Date.now, no Math.random.
import React from 'react';
import { spring } from 'remotion';

export const C = {
  paper: '#fbfaf5',
  sunk: '#f2f0e8',
  ink: '#16181c',
  muted: '#5b5f66',
  faint: '#8f9298',
  rule: '#d9d6ca',
  yellow: '#ffd100',
  yellowSoft: '#ffe566',
  red: '#d52b1e',
  night: '#121316',
};

export const FONT = {
  sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export const bezier = (x1: number, y1: number, x2: number, y2: number) => {
  if (x1 === y1 && x2 === y2) return (t: number) => clamp01(t);
  const ax = 1 - 3 * x2 + 3 * x1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 1 - 3 * y2 + 3 * y1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  const solve = (x: number) => {
    let u = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(u) - x;
      if (Math.abs(err) < 1e-7) return u;
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0, hi = 1;
    u = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(u);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = u; else hi = u;
      u = (lo + hi) / 2;
    }
    return u;
  };
  return (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : sy(solve(t)));
};

export const EASE = {
  snappy: bezier(0.16, 1, 0.3, 1),
  out: bezier(0.22, 1, 0.36, 1),
  smooth: bezier(0.65, 0, 0.35, 1),
  swift: bezier(0.4, 0, 0.2, 1),
  exit: bezier(0.7, 0, 0.84, 0),
  overshoot: bezier(0.34, 1.45, 0.64, 1),
  camera: bezier(0.33, 0, 0.15, 1), // brand camera move
  enter: bezier(0, 0, 0.2, 1), // brand entrance
  linear: (t: number) => clamp01(t),
};

export const ramp = (frame: number, start: number, dur: number, ease: (t: number) => number = EASE.snappy) =>
  ease(clamp01((frame - start) / Math.max(1e-6, dur)));

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export const velocity = (f: (frame: number) => number, frame: number) => f(frame + 0.5) - f(frame - 0.5);

export const springAt = (frame: number, start: number, cfg: { damping?: number; stiffness?: number; mass?: number } = {}) =>
  spring({ frame: frame - start, fps: 30, config: { damping: cfg.damping ?? 18, stiffness: cfg.stiffness ?? 170, mass: cfg.mass ?? 1 } });

/** Directional motion blur along the velocity (px/frame); no filter when nearly still. */
export const SpeedBlur: React.FC<{
  vx: number; vy?: number; amount?: number; max?: number; children: React.ReactNode;
}> = ({ vx, vy = 0, amount = 0.45, max = 36, children }) => {
  const rid = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  const sd = Math.min(max, Math.hypot(vx, vy) * amount);
  const fill: React.CSSProperties = { position: 'absolute', inset: 0 };
  if (sd < 0.35) return <div style={fill}>{children}</div>;
  const deg = (Math.atan2(vy, vx) * 180) / Math.PI;
  const id = `sb-${rid}`;
  return (
    <div style={fill}>
      <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
        <filter id={id} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation={`${sd.toFixed(2)} 0`} edgeMode="none" />
        </filter>
      </svg>
      <div style={{ ...fill, transform: `rotate(${deg}deg)`, filter: `url(#${id})` }}>
        <div style={{ ...fill, transform: `rotate(${-deg}deg)` }}>{children}</div>
      </div>
    </div>
  );
};
