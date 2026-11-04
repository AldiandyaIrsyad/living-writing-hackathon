// Shared film parts: caption strip, paper title card, reticle lock-on, click mark, flash cut.
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from 'remotion';
import { C, EASE, FONT, SpeedBlur, mix, ramp } from './look';

const clamp = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };

/** Narration caption (≥56px): a paper label with a yellow "here" square, bottom or top centre. */
export const Caption: React.FC<{ text: string; from: number; to: number; at?: 'bottom' | 'top' }> = ({ text, from, to, at = 'bottom' }) => {
  const frame = useCurrentFrame();
  const inT = ramp(frame, from, 10, EASE.enter);
  const outT = 1 - ramp(frame, to - 8, 8, EASE.swift);
  const o = Math.min(inT, outT);
  if (o <= 0) return null;
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, [at]: 58, display: 'flex', justifyContent: 'center', pointerEvents: 'none',
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 26, maxWidth: 1640, padding: '20px 38px 24px 32px',
        background: C.paper, border: `1px solid ${C.rule}`, borderRadius: 2,
        opacity: o, transform: `translateY(${(1 - inT) * (at === 'bottom' ? 14 : -14)}px)`,
      }}>
        <span style={{ flex: 'none', width: 20, height: 20, background: C.yellow, transform: 'translateY(-4px)' }} />
        <span style={{ fontFamily: FONT.sans, fontSize: 56, lineHeight: 1.2, fontWeight: 500, color: C.ink, letterSpacing: '-0.01em', textWrap: 'balance' }}>{text}</span>
      </div>
    </div>
  );
};

/** Paper title card between acts (paper-title-card, re-skinned): serif statement, italic accent word
 *  with a here-yellow underline, act label above. Word timings as in the demo. */
export const TitleCard: React.FC<{ words: { text: string; accent?: boolean }[]; n: number; label: string; duration: number }> = ({ words, n, label, duration }) => {
  const frame = useCurrentFrame();
  const fadeOut = interpolate(frame, [duration - 8, duration], [1, 0], clamp);
  const underline = interpolate(frame, [16, 34], [0, 1], { ...clamp, easing: Easing.bezier(0.3, 0, 0.2, 1) });
  const labT = interpolate(frame, [0, 10], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ backgroundColor: C.paper, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', opacity: fadeOut }}>
        <div style={{
          fontFamily: FONT.sans, fontSize: 34, fontWeight: 700, letterSpacing: '0.2em', color: C.muted,
          textTransform: 'uppercase', marginBottom: 46, opacity: labT, display: 'flex', gap: 22, justifyContent: 'center', alignItems: 'center',
        }}>
          <span style={{ color: C.ink }}>{n}</span>
          <span style={{ width: 44, height: 2, background: C.rule }} />
          <span>{label}</span>
        </div>
        <div style={{
          fontFamily: FONT.serif, fontSize: 116, fontWeight: 400, lineHeight: 1.14, color: C.ink, letterSpacing: '-0.012em',
          display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: '0.26em', maxWidth: 1600,
        }}>
          {words.map((w, i) => {
            const delay = 4 + i * 4;
            const t = interpolate(frame, [delay, delay + 9], [0, 1], { ...clamp, easing: Easing.bezier(0.2, 0.75, 0.3, 1) });
            return (
              <span key={i} style={{
                opacity: t, transform: `scale(${1.28 - 0.28 * t})`, filter: `blur(${(1 - t) * 7}px)`,
                display: 'inline-block', position: 'relative', fontStyle: w.accent ? 'italic' : 'normal',
              }}>
                {w.accent && (
                  <span style={{
                    position: 'absolute', left: -6, right: -6, bottom: 14, height: 22, background: C.yellow, zIndex: -1,
                    transform: `scaleX(${underline})`, transformOrigin: '0 50%',
                  }} />
                )}
                <span style={{ position: 'relative' }}>{w.text}</span>
              </span>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** Reticle lock-on (fui-hud-moves · reticle-lock-on): corner brackets fly in from the lower right,
 *  overshoot-shrink and bite onto a screen-space rect, the rest of the frame dims a little, a label pops.
 *  Timings from the demo, relative to `start`. */
export const Reticle: React.FC<{
  start: number; rect: { x: number; y: number; w: number; h: number }; label: string; color?: string; pad?: number;
}> = ({ start, rect, label, color = C.ink, pad = 16 }) => {
  const f = useCurrentFrame() - start;
  if (f < 14) return null;
  const FLY_IN = 14, FLY_END = 24, SHRINK0 = 20, UNDER = 40, LOCK_END = 46, LABEL0 = 48, LABEL_END = 58;
  const flyAt = (fr: number) => {
    const t = interpolate(fr, [FLY_IN, FLY_END], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp });
    return { x: (1 - t) * 1100, y: (1 - t) * 620 };
  };
  const shrink = f < UNDER ? mix(2.2, 0.94, ramp(f, SHRINK0, UNDER - SHRINK0, EASE.swift)) : mix(0.94, 1, ramp(f, UNDER, LOCK_END - UNDER, EASE.out));
  const fly = flyAt(f), fly0 = flyAt(f - 0.5), fly1 = flyAt(f + 0.5);
  const bite = interpolate(f, [LOCK_END, LOCK_END + 1, LOCK_END + 5], [0, 1, 0], clamp);
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  const hw = (rect.w / 2 + pad) * shrink - 6 * bite;
  const hh = (rect.h / 2 + pad) * shrink - 6 * bite;
  const focus = interpolate(f, [LOCK_END - 2, LOCK_END + 10], [0, 1], { easing: Easing.out(Easing.cubic), ...clamp });
  const labelT = interpolate(f, [LABEL0, LABEL_END], [0, 1], { easing: Easing.out(Easing.back(1.8)), ...clamp });
  const op = interpolate(f, [FLY_IN, FLY_IN + 3], [0, 1], clamp);
  const ARM = 58, TH = 5;
  const corners = [
    { x: cx - hw, y: cy - hh, sx: 1, sy: 1 }, { x: cx + hw, y: cy - hh, sx: -1, sy: 1 },
    { x: cx - hw, y: cy + hh, sx: 1, sy: -1 }, { x: cx + hw, y: cy + hh, sx: -1, sy: -1 },
  ];
  const bar = (w: number, h: number, under: boolean): React.CSSProperties => ({
    position: 'absolute', left: under ? -2 : 0, top: under ? -2 : 0, width: w + (under ? 4 : 0), height: h + (under ? 4 : 0),
    borderRadius: 2, background: under ? C.paper : color,
  });
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {focus > 0 && (
        <div style={{
          position: 'absolute', left: rect.x - 4, top: rect.y - 4, width: rect.w + 8, height: rect.h + 8, borderRadius: 2,
          boxShadow: `0 0 0 3000px rgba(22,24,28,${(0.1 * focus).toFixed(3)})`,
        }} />
      )}
      <SpeedBlur vx={fly1.x - fly0.x} vy={fly1.y - fly0.y} amount={0.3} max={22}>
        <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${fly.x}px, ${fly.y}px)`, opacity: op }}>
          {corners.map((c, i) => (
            <div key={i} style={{ position: 'absolute', left: c.x, top: c.y, transform: `scale(${c.sx}, ${c.sy})`, transformOrigin: '0 0' }}>
              <div style={bar(ARM, TH, true)} /><div style={bar(TH, ARM, true)} />
              <div style={bar(ARM, TH, false)} /><div style={bar(TH, ARM, false)} />
            </div>
          ))}
          {[0, 1].map((k) => (
            <div key={k} style={{
              position: 'absolute', left: cx - (k ? 1.5 : 14), top: cy - (k ? 14 : 1.5), width: k ? 3 : 28, height: k ? 28 : 3,
              background: color, opacity: 0.8 * (1 - focus),
            }} />
          ))}
        </div>
      </SpeedBlur>
      {f >= LABEL0 && (
        <div style={{
          position: 'absolute', left: cx - hw + 2, top: cy - hh - 74, transform: `scale(${labelT})`, transformOrigin: '0 100%',
          opacity: Math.min(1, labelT * 1.5), display: 'flex', alignItems: 'center', gap: 14, whiteSpace: 'nowrap',
          background: C.night, color: '#fff', fontFamily: FONT.sans, padding: '10px 18px 10px 14px', borderRadius: 2,
        }}>
          <div style={{ width: 14, height: 14, background: color === C.ink ? C.yellow : color }} />
          <span style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.01em' }}>{label}</span>
        </div>
      )}
    </AbsoluteFill>
  );
};

/** A click: an ink outline that springs out from the control and fades (page space). */
export const Press: React.FC<{ at: number; x: number; y: number; w: number; h: number }> = ({ at, x, y, w, h }) => {
  const f = useCurrentFrame() - at;
  if (f < 0 || f > 14) return null;
  const t = ramp(f, 0, 14, EASE.out);
  const g = 2 + 7 * t;
  return (
    <>
      <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, background: 'rgba(22,24,28,0.12)', opacity: 1 - ramp(f, 2, 8, EASE.linear), borderRadius: 2 }} />
      <div style={{
        position: 'absolute', left: x - g, top: y - g, width: w + 2 * g, height: h + 2 * g,
        border: `2px solid ${C.ink}`, borderRadius: 3, opacity: 1 - t,
      }} />
    </>
  );
};

/** Bright-field cut in paper white. */
export const FlashCut: React.FC<{ at: number; duration?: number }> = ({ at, duration = 10 }) => {
  const f = useCurrentFrame() - at;
  const o = interpolate(f, [0, duration * 0.4, duration], [0, 0.85, 0], clamp);
  if (o <= 0) return null;
  return (
    <AbsoluteFill style={{
      pointerEvents: 'none', opacity: o,
      background: 'radial-gradient(ellipse at 50% 45%, rgba(251,250,245,0.98), rgba(251,250,245,0.6) 55%, rgba(251,250,245,0.2) 80%)',
    }} />
  );
};
