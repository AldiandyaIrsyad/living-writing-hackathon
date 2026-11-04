// Act 2 · the timeline. S08 tracks, S09 time travel (timeline-travel), S10 page versions
// (before-after-slider-scrub), S11 a scene's changes.
import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame } from 'remotion';
import { C, EASE, FONT, SpeedBlur, mix, ramp, velocity } from '../look';
import { CamKey, PageCam } from '../PageCam';
import { Press } from '../parts';

const clamp = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };

// ───────────── S08 · tracks ─────────────
export const S08Tracks: React.FC = () => {
  const keys: CamKey[] = [
    { frame: 0, cx: 960, cy: 600, zoom: 1.05 },
    { frame: 50, cx: 680, cy: 905, zoom: 1.38 },
    { frame: 320, cx: 685, cy: 905, zoom: 1.42 },
  ];
  return <PageCam src="tracks.png" keys={keys} />;
};

// ───────────── S09 · time travel ─────────────
// Camera curve, pop timing (6f before the camera arrives, spring 11/160/0.9) and the brake + 10f push
// are the demo's. Cards are the real State panels at three playhead positions.
type Card = { name: string; src: string; h: number };
const TICK_GAP = 1400;
const TICKS: { label: string; far: string; cards: Card[] }[] = [
  { label: 'Start · before any scene', far: 'Start', cards: [{ name: 'Norman', src: 'state-start-norman.png', h: 178 }] },
  { label: 'Chapter 4 · Gathering Storm', far: 'Ch 4', cards: [{ name: 'Alice & Bob', src: 'state-end-alice-bob.png', h: 166 }] },
  {
    label: 'Chapter 5 · The Fall of Ashford', far: 'Ch 5', cards: [
      { name: 'Norman', src: 'state-end-norman.png', h: 212 },
      { name: 'Ashford', src: 'state-end-ashford.png', h: 143 },
    ],
  },
];
const AXIS_Y = 770;
const CARD_S = 1.4; // CSS px → screen
const CARD_W = 840 * CARD_S;
const STEM = 36;
const TRAVEL_START = 12, TRAVEL_END = 104, ZOOM_END = 114;

const camXAt = (f: number) => {
  const total = TICK_GAP * (TICKS.length - 1);
  const t = interpolate(f, [TRAVEL_START, TRAVEL_END], [0, 1], clamp);
  return interpolate(t, [0, 0.15, 0.88, 1], [0, 0.055, 0.9, 1], { easing: Easing.inOut(Easing.quad) }) * total;
};
export const popFrameOf = (i: number) => {
  if (i === 0) return 0;
  for (let f = TRAVEL_START; f <= TRAVEL_END; f++) if (camXAt(f) >= i * TICK_GAP) return f;
  return TRAVEL_END;
};

const StateCard: React.FC<{ card: Card }> = ({ card }) => (
  <div style={{ marginTop: 14 }}>
    <div style={{ fontFamily: FONT.sans, fontSize: 36, fontWeight: 700, color: C.ink, marginBottom: 8 }}>{card.name}</div>
    <div style={{ width: CARD_W, height: card.h * CARD_S, background: '#fff', outline: `1px solid ${C.rule}` }}>
      <Img src={staticFile(`textures/${card.src}`)} style={{ width: CARD_W, height: card.h * CARD_S, display: 'block' }} />
    </div>
  </div>
);

const Tick: React.FC<{ i: number; frame: number }> = ({ i, frame }) => {
  const tick = TICKS[i];
  const x = 960 + i * TICK_GAP;
  const hero = i === TICKS.length - 1;
  const pop = popFrameOf(i) - 6;
  const s = i === 0 ? 1 : spring({ frame: frame - pop, fps: 30, config: { damping: 11, stiffness: 160, mass: 0.9 }, durationInFrames: 26 });
  const lit = i === 0 ? 1 : interpolate(frame, [pop, pop + 6], [0, 1], clamp);
  const appeared = i === 0 || frame >= pop;
  return (
    <div style={{ position: 'absolute', left: x, top: 0, height: 1080 }}>
      <div style={{
        position: 'absolute', left: -9, top: AXIS_Y - 9, width: 18, height: 18, boxSizing: 'border-box',
        border: `3px solid ${C.ink}`, background: lit > 0.5 ? C.ink : C.paper,
      }} />
      <div style={{
        position: 'absolute', left: -400, width: 800, top: AXIS_Y + 30, textAlign: 'center', fontFamily: FONT.sans,
        fontSize: 34, fontWeight: hero ? 700 : 600, color: C.ink,
      }}>{tick.label}</div>
      {appeared && (
        <>
          <div style={{ position: 'absolute', left: -0.5, top: AXIS_Y - 9 - STEM * Math.min(1, s), width: 1, height: STEM * Math.min(1, s), background: C.faint }} />
          <div style={{
            position: 'absolute', left: -CARD_W / 2, bottom: 1080 - (AXIS_Y - 9 - STEM),
            transform: `scaleY(${s}) scaleX(${0.85 + 0.15 * s})`, transformOrigin: '50% 100%', opacity: Math.min(1, s * 2),
          }}>
            {tick.cards.map((c) => <StateCard key={c.src} card={c} />)}
          </div>
        </>
      )}
    </div>
  );
};

export const S09TimeTravel: React.FC = () => {
  const frame = useCurrentFrame();
  const camX = camXAt(frame);
  const vx = -(camXAt(frame + 0.5) - camXAt(frame - 0.5));
  const zoom = interpolate(frame, [TRAVEL_END, ZOOM_END], [1, 1.1], { easing: Easing.out(Easing.cubic), ...clamp });
  const worldW = 960 * 2 + TICK_GAP * (TICKS.length - 1);
  return (
    <AbsoluteFill style={{ background: C.paper, overflow: 'hidden', fontFamily: FONT.sans }}>
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${1 + (zoom - 1) * 0.35})`, transformOrigin: '50% 62%' }}>
        {TICKS.map((t, i) => {
          const d = Math.abs(camX - i * TICK_GAP) / TICK_GAP;
          const op = Math.max(0, 1 - d / 0.62);
          if (op <= 0) return null;
          return (
            <div key={i} style={{
              position: 'absolute', left: 960 + i * TICK_GAP * 0.35 - camX * 0.35 - 600, width: 1200, top: 60, textAlign: 'center',
              fontSize: 280, lineHeight: 1, fontWeight: 800, letterSpacing: '-0.05em', color: `rgba(22,24,28,${(0.045 * op).toFixed(4)})`,
            }}>{t.far}</div>
          );
        })}
      </div>
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${zoom})`, transformOrigin: '50% 62%' }}>
        <SpeedBlur vx={vx} amount={0.16} max={9}>
          <div style={{ position: 'absolute', left: 0, top: 0, width: worldW, height: 1080, transform: `translateX(${(-camX).toFixed(2)}px)` }}>
            <div style={{ position: 'absolute', left: 200, top: AXIS_Y - 1, width: worldW - 400, height: 2, background: C.rule }} />
            {Array.from({ length: (TICKS.length - 1) * 5 + 1 }).map((_, i) => i % 5 === 0 ? null : (
              <div key={i} style={{ position: 'absolute', left: 960 + i * (TICK_GAP / 5) - 1, top: AXIS_Y - 9, width: 2, height: 18, background: C.rule }} />
            ))}
            {TICKS.map((_, i) => <Tick key={i} i={i} frame={frame} />)}
          </div>
        </SpeedBlur>
        {/* the playhead: fixed at the centre, the world moves under it */}
        <div style={{ position: 'absolute', left: 958, top: AXIS_Y - 26, width: 4, height: 52, background: C.yellow }} />
        <div style={{ position: 'absolute', left: 948, top: AXIS_Y - 40, width: 24, height: 14, background: C.yellow }} />
      </div>
    </AbsoluteFill>
  );
};

// ───────────── S10 · page versions (before / after slider) ─────────────
// posAt keeps the demo's preload, fling, bounce and hold; the slow scrub goes on into "after" (88%)
// so the new line is readable at rest.
const PRE = 10, T0 = 14, FLING = 26, BOUNCE = 38, HOLD = 56, SCRUB = 104;
const posAt = (f: number) => {
  if (f < T0) return mix(8, 6.5, ramp(f, PRE, T0 - PRE, EASE.smooth));
  if (f < FLING) return mix(6.5, 76, ramp(f, T0, FLING - T0, EASE.out));
  if (f < BOUNCE) return mix(76, 70, ramp(f, FLING, BOUNCE - FLING, EASE.smooth));
  if (f < HOLD) return 70;
  return mix(70, 88, ramp(f, HOLD, SCRUB - HOLD, EASE.smooth));
};
const VX = 120, VY = 300, VW = 1680, VH = 390;

const Tag: React.FC<{ label: string; dark?: boolean; style: React.CSSProperties }> = ({ label, dark, style }) => (
  <div style={{
    position: 'absolute', height: 58, padding: '0 22px 0 18px', display: 'flex', alignItems: 'center', gap: 12,
    background: dark ? C.night : C.paper, color: dark ? '#fff' : C.ink, border: `1px solid ${dark ? C.night : C.rule}`, borderRadius: 2,
    fontFamily: FONT.sans, fontSize: 34, fontWeight: 600, whiteSpace: 'nowrap', ...style,
  }}>
    <span style={{ width: 12, height: 12, background: dark ? C.yellow : C.faint }} />{label}
  </div>
);

export const S10Versions: React.FC = () => {
  const frame = useCurrentFrame();
  const p = posAt(frame);
  const x = VX + (p / 100) * VW;
  const vx = velocity((f) => VX + (posAt(f) / 100) * VW, frame);
  const squish = 1 + Math.min(Math.abs(vx) / 110, 1) * 0.18;
  const press = 1 - 0.06 * Math.sin(Math.PI * ramp(frame, PRE, FLING - PRE, EASE.linear));
  const head = ramp(frame, 0, 12, EASE.enter);
  return (
    <AbsoluteFill style={{ background: C.sunk, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: VX, top: 150, opacity: head, display: 'flex', alignItems: 'baseline', gap: 28 }}>
        <span style={{ fontFamily: FONT.serif, fontSize: 76, color: C.ink }}>Mira</span>
        <span style={{ fontFamily: FONT.sans, fontSize: 34, fontWeight: 700, letterSpacing: '0.14em', color: C.muted, textTransform: 'uppercase' }}>Character · her page in story time</span>
      </div>
      <div style={{ position: 'absolute', left: VX, top: VY, width: VW, height: VH, background: '#fff', outline: `1px solid ${C.rule}`, overflow: 'hidden' }}>
        <Img src={staticFile('textures/cut-mira-before.png')} style={{ position: 'absolute', left: 0, top: 0, width: VW, height: 300 }} />
        <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 ${VX + VW - x}px 0 0)`, background: '#fff' }}>
          <Img src={staticFile('textures/cut-mira-after.png')} style={{ position: 'absolute', left: 0, top: 0, width: VW, height: VH }} />
        </div>
      </div>
      <Tag label="As of Chapter 2" style={{ right: 1920 - VX - VW, top: VY + VH + 24 }} />
      <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 ${1920 - x}px 0 0)` }}>
        <Tag label="As of Chapter 5" dark style={{ left: VX, top: VY + VH + 24 }} />
      </div>
      <SpeedBlur vx={vx} amount={0.12} max={14}>
        <div style={{ position: 'absolute', left: x - 1.5, top: VY - 40, width: 3, height: VH + 80, background: C.ink }} />
        <div style={{
          position: 'absolute', left: x - 32, top: VY + VH / 2 - 32, width: 64, height: 64, boxSizing: 'border-box',
          background: C.paper, border: `2px solid ${C.ink}`, borderRadius: 2, transform: `scale(${press * squish}, ${press})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width={32} height={18} viewBox="0 0 36 20">
            <path d="M11 3 L4 10 L11 17" fill="none" stroke={C.ink} strokeWidth={2.8} />
            <path d="M25 3 L32 10 L25 17" fill="none" stroke={C.ink} strokeWidth={2.8} />
          </svg>
        </div>
      </SpeedBlur>
    </AbsoluteFill>
  );
};

// ───────────── S11 · a scene's changes ─────────────
export const S11Changes: React.FC = () => {
  const keys: CamKey[] = [
    { frame: 0, cx: 900, cy: 330, zoom: 1.7 },
    { frame: 40, cx: 900, cy: 330, zoom: 1.7 },
    { frame: 84, cx: 950, cy: 470, zoom: 1.75 },
    { frame: 150, cx: 950, cy: 470, zoom: 1.75 },
    { frame: 192, cx: 950, cy: 440, zoom: 2.25 },
    { frame: 228, cx: 950, cy: 440, zoom: 2.25 },
    { frame: 270, cx: 950, cy: 550, zoom: 2.25 },
  ];
  return (
    <PageCam src="fall-closed.png" keys={keys} swaps={[{ at: 34, src: 'fall-changes.png', fade: 6 }]}>
      <Press at={30} x={891} y={247} w={88} h={25} />
    </PageCam>
  );
};
