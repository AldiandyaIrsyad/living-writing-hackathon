// S01 cold open (typewriter-moves · error-retype), S02 wordmark (letterspace-materialize),
// S03 the whole desk (overhead-camera-moves · tilt-reveal). Timings follow the demo sources.
import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { C, EASE, FONT, SpeedBlur, bezier, mix, ramp } from '../look';

// ───────────── S01 · typewriter, error → retype ─────────────
export const WRONG = 're-read chapters 1–30';
export const RIGHT = 'just write.';
export const TYPE0 = 14;
const TYPE_END = TYPE0 + WRONG.length * 2; // 2f per char
export const DEL0 = TYPE_END + 16; // 16f hesitation
export const DEL_END = DEL0 + WRONG.length * 1.5; // 1.5f per char
const RE_END = DEL_END + RIGHT.length * 1.5;

const typedAt = (f: number) => {
  if (f < TYPE0) return '';
  if (f < DEL0) return WRONG.slice(0, Math.min(WRONG.length, Math.floor((f - TYPE0) / 2) + 1));
  if (f < DEL_END) return WRONG.slice(0, WRONG.length - Math.floor((f - DEL0) / 1.5) - 1);
  return RIGHT.slice(0, Math.min(RIGHT.length, Math.floor((f - DEL_END) / 1.5) + 1));
};

export const ColdOpen: React.FC = () => {
  const f = useCurrentFrame();
  const text = typedAt(f);
  // cursor: solid while typing; 4f half-period blinks in the hesitation; two 10f blinks after the retype, then gone
  let cursor = true;
  if (f >= TYPE_END && f < DEL0) cursor = Math.floor((f - TYPE_END) / 4) % 2 === 0;
  if (f >= RE_END) cursor = f < RE_END + 40 && Math.floor((f - RE_END) / 10) % 2 === 0;
  const lead = ramp(f, 0, 12, EASE.enter);
  const mark = ramp(f, RE_END + 3, 16, EASE.out);
  const push = 1 + 0.03 * ramp(f, 0, 180, EASE.smooth);
  const done = f >= RE_END;
  const wordIdx = RIGHT.indexOf('write');
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <AbsoluteFill style={{ transform: `scale(${push})`, transformOrigin: '30% 50%' }}>
        <div style={{ position: 'absolute', left: 300, top: 330, fontFamily: FONT.serif }}>
          <div style={{ fontSize: 84, color: C.muted, opacity: lead, transform: `translateY(${(1 - lead) * 10}px)` }}>Before chapter 31,</div>
          <div style={{ fontSize: 132, color: C.ink, marginTop: 18, height: 160, whiteSpace: 'pre', display: 'flex', alignItems: 'center' }}>
            {done ? (
              <>
                <span>{RIGHT.slice(0, wordIdx)}</span>
                <span style={{ position: 'relative' }}>
                  <span style={{
                    position: 'absolute', left: -8, right: -8, bottom: 22, height: 44, background: C.yellow,
                    transform: `scaleX(${mark})`, transformOrigin: '0 50%',
                  }} />
                  <span style={{ position: 'relative' }}>write</span>
                </span>
                <span>{RIGHT.slice(wordIdx + 5, text.length)}</span>
              </>
            ) : (
              <span>{text}</span>
            )}
            <span style={{ display: 'inline-block', width: 7, height: 120, marginLeft: 6, background: C.ink, opacity: cursor ? 1 : 0 }} />
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ───────────── S02 · letterspace materialize, ink on paper ─────────────
// Single-line skeleton glyphs on a 64-high box (baseline 59, x-height 22, cap 5), from the demo's set
// plus L, W, n, g drawn the same way. All glyphs share one progress so they start and finish together.
const GLYPHS: Record<string, { w: number; d: string }> = {
  L: { w: 38, d: 'M 6 5 L 6 59 L 34 59' },
  W: { w: 56, d: 'M 3 5 L 15 59 L 28 18 L 41 59 L 53 5' },
  i: { w: 14, d: 'M 7 22 L 7 59 M 7 9.5 L 7 10' },
  v: { w: 42, d: 'M 4 22 L 21 59 L 38 22' },
  n: { w: 41, d: 'M 5 22 L 5 59 M 5 38 C 5 27, 12 22, 20.5 22 C 30 22, 36 27, 36 37 L 36 59' },
  g: { w: 46, d: 'M 41.5 40.5 A 18.5 18.5 0 0 0 4.5 40.5 A 18.5 18.5 0 0 0 41.5 40.5 M 41.5 22 L 41.5 64 C 41.5 74, 34 78, 23 78 C 14 78, 8 75, 5 70' },
  r: { w: 28, d: 'M 5 22 L 5 59 M 5 38 C 5 27, 13 22, 24 23' },
  t: { w: 26, d: 'M 12 8 L 12 59 M 3 22 L 23 22' },
};
const WORD = 'Living Writing';
const GLYPH_SCALE = 1.7;
const TRACK = 26;
const strokeEase = bezier(0.5, 0, 0.3, 1);

export const Wordmark: React.FC = () => {
  const f = useCurrentFrame();
  const e = ramp(f, 16, 52, strokeEase);
  const sub = ramp(f, 70, 16, EASE.enter);
  const push = 1 + 0.02 * ramp(f, 0, 140, EASE.smooth);
  return (
    <AbsoluteFill style={{ background: C.paper, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ transform: `scale(${push})`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: TRACK, alignItems: 'center', height: 64 * GLYPH_SCALE + 30 }}>
          {WORD.split('').map((ch, i) => {
            if (ch === ' ') return <div key={i} style={{ width: 34 }} />;
            const g = GLYPHS[ch];
            return (
              <svg key={i} width={g.w * GLYPH_SCALE} height={64 * GLYPH_SCALE} viewBox={`0 0 ${g.w} 64`} style={{ overflow: 'visible', display: 'block' }}>
                {e > 0 && (
                  <path d={g.d} fill="none" stroke={C.ink} strokeWidth={6 / GLYPH_SCALE} strokeLinecap="round" strokeLinejoin="round"
                    pathLength={1} strokeDasharray={1} strokeDashoffset={1 - e} />
                )}
              </svg>
            );
          })}
        </div>
        <div style={{
          marginTop: 58, display: 'flex', alignItems: 'center', gap: 22, opacity: sub, transform: `translateY(${(1 - sub) * 10}px)`,
          fontFamily: FONT.sans, fontSize: 46, color: C.muted,
        }}>
          <span style={{ width: 16, height: 16, background: C.yellow }} />
          A wiki for fiction, kept true by an agent.
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ───────────── S03 · tilt reveal of the real desk ─────────────
// Pose math, timings and the Q2 equivalent rotateX'·scaleY are the demo's; the look is paper:
// no glow, rim light or sheen, a hairline page edge, the far end fading into paper-sunk.
const HOLD = 20, MOVE = 40, SETTLE = 10, FROM = 86;
const CREEP = 3 / 86, OVER = 1 + 2.2 / 86;
const S0 = 2.5, S1 = 0.84, BOT0 = 600;
const BOT1 = 540 + (1080 * S1) / 2 - 18;

const poseAt = (f: number) => {
  const creep = ramp(f, 0, HOLD, EASE.smooth) * CREEP;
  const lift = ramp(f, HOLD, MOVE, EASE.swift);
  const q = mix(creep, OVER, lift) - (OVER - 1) * ramp(f, HOLD + MOVE, SETTLE, EASE.smooth);
  const p = mix(creep, 1, lift);
  return { p, rotX: FROM * (1 - q), scale: mix(S0, S1, p), bot: mix(BOT0, BOT1, p), eye: mix(BOT0 - 300, 520, p), persp: mix(700, 1500, p) };
};

const DESK_LABELS = [
  { text: 'Write', x: 945, y: 545, at: 78 },
  { text: 'The world', x: 1755, y: 140, at: 84 },
  { text: 'Time', x: 700, y: 676, at: 90 },
];

export const DeskReveal: React.FC = () => {
  const f = useCurrentFrame();
  const { rotX, scale: s0, bot, eye, persp } = poseAt(f);
  const push = mix(1, 1.03, ramp(f, 70, 140, EASE.smooth));
  const scale = s0 * push;
  const botY = 540 + (bot - 540) * push;
  const topY = botY - 1080 * scale;
  const vRot = poseAt(f + 0.5).rotX - poseAt(f - 0.5).rotX;
  const rad = (rotX * Math.PI) / 180;
  const rEq = (Math.atan2(Math.sin(rad), scale * Math.cos(rad)) * 180) / Math.PI;
  const kEq = Math.sqrt(scale * scale * Math.cos(rad) ** 2 + Math.sin(rad) ** 2) / scale;
  const vScale = kEq * Math.abs(Math.cos((rEq * Math.PI) / 180));
  const sigma = vScale > 0.6 ? 0 : (0.55 / Math.max(0.05, vScale)) * 1.6 - 1.2;
  const flat = Math.min(1, Math.abs(rotX) / 86);
  return (
    <AbsoluteFill style={{ background: C.sunk, overflow: 'hidden' }}>
      <SpeedBlur vx={0} vy={-vRot * 7} amount={0.2} max={9}>
        <div style={{ position: 'absolute', inset: 0, perspective: persp, perspectiveOrigin: `50% ${(eye / 1080) * 100}%` }}>
          <div style={{
            position: 'absolute', left: 960 - 960 * scale, top: topY, width: 1920 * scale, height: 1080 * scale,
            transformOrigin: '50% 100%', transform: `rotateX(${rEq}deg) scaleY(${kEq})`, overflow: 'hidden',
            outline: `1px solid ${C.rule}`,
          }}>
            {sigma > 0.5 && (
              <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
                <filter id="tilt-aa" x="0" y="-5%" width="100%" height="110%" colorInterpolationFilters="sRGB">
                  <feGaussianBlur stdDeviation={`0 ${sigma.toFixed(2)}`} />
                </filter>
              </svg>
            )}
            <div style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, zoom: scale, filter: sigma > 0.5 ? 'url(#tilt-aa)' : undefined }}>
              <Img src={staticFile('textures/desk.png')} style={{ width: 1920, height: 1080, display: 'block' }} />
            </div>
            <div style={{
              position: 'absolute', inset: 0, pointerEvents: 'none',
              background: `linear-gradient(0deg, rgba(242,240,232,${0.1 * flat}) 0%, rgba(242,240,232,${0.5 * flat}) 45%, rgba(242,240,232,${0.9 * flat ** 1.5}) 100%)`,
            }} />
          </div>
        </div>
      </SpeedBlur>
      {DESK_LABELS.map((l) => {
        const t = ramp(f, l.at, 12, EASE.overshoot);
        if (t <= 0) return null;
        const x = 960 + (l.x - 960) * scale;
        const y = topY + l.y * scale;
        return (
          <div key={l.text} style={{
            position: 'absolute', left: x, top: y, transform: `translate(-50%, -50%) scale(${0.8 + 0.2 * t})`, opacity: Math.min(1, t * 1.4),
            display: 'flex', alignItems: 'center', gap: 20, padding: '14px 30px 16px 24px', background: C.paper,
            border: `1px solid ${C.ink}`, borderRadius: 2, fontFamily: FONT.sans, fontSize: 56, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap',
          }}>
            <span style={{ width: 18, height: 18, background: C.yellow }} />
            {l.text}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
