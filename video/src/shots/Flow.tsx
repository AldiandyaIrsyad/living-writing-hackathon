// Act 3 · Flow. S12 four scenes flip to their parts (card-flip-reveal), S13 the real Flow panel.
// Roles and tones are the real model's readings of the demo story (capture/flow-readings.json).
import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { C, EASE, FONT, bezier, mix, ramp, springAt } from '../look';
import { CamKey, PageCam } from '../PageCam';

const SCENES = [
  { n: '1.01', ch: 'Chapter 1', title: 'Supper at the Inn', open: 'Norman is eating his food.', role: 'Setup', tone: 'quiet, domestic, faintly foreboding' },
  { n: '3.01', ch: 'Chapter 3', title: 'The Betrayal', open: 'Bob says the words Alice will never forget.', role: 'Turn', tone: 'somber, bitter, quietly final' },
  { n: '4.01', ch: 'Chapter 4', title: 'Gathering Storm', open: 'Clouds pile up over the hills above Ashford.', role: 'Escalation', tone: 'quiet, tense, foreboding' },
  { n: '5.01', ch: 'Chapter 5', title: 'The Fall of Ashford', open: 'The gates of Ashford give way at dusk.', role: 'Climax', tone: 'bleak, violent, final' },
];

const CW = 400, CH = 540, GAP = 40;
const X0 = (1920 - (CW * 4 + GAP * 3)) / 2;
const Y = 250;
export const FLIP0 = 22, STAGGER = 12, PRE = 4;
const FLIP = 16, PEAK = 194;
const flipEase = bezier(0.55, 0, 0.3, 1);
const angleAt = (f: number, i: number) => {
  const s = FLIP0 + i * STAGGER;
  if (f < s + PRE) return -10 * ramp(f, s, PRE, EASE.out);
  if (f < s + PRE + FLIP) return mix(-10, PEAK, ramp(f, s + PRE, FLIP, flipEase));
  return PEAK - (PEAK - 180) * springAt(f, s + PRE + FLIP, { damping: 15, stiffness: 190 });
};

// Shading as the face turns away (the demo's FaceLight without the specular band).
const Shade: React.FC<{ angle: number; dark: boolean }> = ({ angle, dark }) => (
  <div style={{ position: 'absolute', inset: 0, background: '#000', opacity: (1 - Math.abs(Math.cos((angle * Math.PI) / 180))) * (dark ? 0.55 : 0.4) }} />
);

const FlipCard: React.FC<{ i: number; frame: number }> = ({ i, frame }) => {
  const sc = SCENES[i];
  const angle = angleAt(frame, i);
  const lift = Math.max(0, Math.sin((Math.min(180, Math.max(0, angle)) * Math.PI) / 180));
  const land = FLIP0 + i * STAGGER + PRE + FLIP;
  const num = springAt(frame, land - 2, { damping: 18, stiffness: 160 });
  const lab = ramp(frame, land + 2, 14, EASE.snappy);
  const face: React.CSSProperties = { position: 'absolute', inset: 0, backfaceVisibility: 'hidden', borderRadius: 2, overflow: 'hidden' };
  return (
    <div style={{ position: 'absolute', left: X0 + i * (CW + GAP), top: Y, width: CW, height: CH, perspective: 1600 }}>
      <div style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transform: `translateZ(${(lift * 60).toFixed(2)}px) rotateY(${angle.toFixed(3)}deg)` }}>
        <div style={{ ...face, background: C.paper, border: `1px solid ${C.rule}`, boxSizing: 'border-box', padding: '34px 34px' }}>
          <div style={{ fontFamily: FONT.sans, fontSize: 32, fontWeight: 600, color: C.muted, display: 'flex', gap: 14 }}>
            <span style={{ color: C.ink, fontWeight: 700 }}>{sc.n}</span><span>{sc.ch}</span>
          </div>
          <div style={{ fontFamily: FONT.serif, fontSize: 46, lineHeight: 1.1, color: C.ink, marginTop: 26 }}>{sc.title}</div>
          <div style={{ height: 1, background: C.rule, margin: '26px 0' }} />
          <div style={{ fontFamily: FONT.serif, fontSize: 34, lineHeight: 1.36, color: C.muted }}>{sc.open}</div>
          <Shade angle={angle} dark={false} />
        </div>
        <div style={{ ...face, transform: 'rotateY(180deg)', background: C.night, color: '#fff', padding: '34px 34px', boxSizing: 'border-box' }}>
          <div style={{ fontFamily: FONT.serif, fontSize: 34, lineHeight: 1.15, color: '#c9c7c0' }}>{sc.title}</div>
          <div style={{ position: 'absolute', left: 34, top: 170 }}>
            <div style={{
              display: 'inline-block', background: C.yellow, color: C.ink, padding: '6px 22px 10px', borderRadius: 2,
              fontFamily: FONT.sans, fontSize: 64, fontWeight: 700, letterSpacing: '-0.02em',
              transform: `scale(${mix(1.08, 1, num).toFixed(4)})`, transformOrigin: 'left bottom',
            }}>{sc.role}</div>
          </div>
          <div style={{
            position: 'absolute', left: 34, right: 34, bottom: 44, fontFamily: FONT.serif, fontStyle: 'italic', fontSize: 38, lineHeight: 1.3,
            color: '#e8e6df', opacity: lab, transform: `translateY(${((1 - lab) * 14).toFixed(2)}px)`,
          }}>{sc.tone}</div>
          <Shade angle={180 - angle} dark />
        </div>
      </div>
    </div>
  );
};

export const S12FlowCards: React.FC = () => {
  const frame = useCurrentFrame();
  const push = 1 + 0.03 * ramp(frame, 0, 210, EASE.smooth);
  const head = ramp(frame, 0, 14, EASE.enter);
  return (
    <AbsoluteFill style={{ background: C.sunk, overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `scale(${push.toFixed(4)})`, transformOrigin: '50% 55%' }}>
        <div style={{
          position: 'absolute', left: X0, top: 140, opacity: head, fontFamily: FONT.sans, fontSize: 34, fontWeight: 700,
          letterSpacing: '0.18em', color: C.muted, textTransform: 'uppercase', display: 'flex', gap: 18, alignItems: 'center',
        }}>
          <span style={{ color: C.ink }}>Flow</span><span style={{ width: 36, height: 2, background: C.rule }} /><span>The Ashford Chronicle, in reading order</span>
        </div>
        {SCENES.map((_, i) => <FlipCard key={i} i={i} frame={frame} />)}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const S13FlowPanel: React.FC = () => {
  const keys: CamKey[] = [
    { frame: 0, cx: 1080, cy: 520, zoom: 1.12 },
    { frame: 24, cx: 1080, cy: 520, zoom: 1.12 },
    { frame: 80, cx: 1551, cy: 343, zoom: 2.6 },
    { frame: 320, cx: 1551, cy: 350, zoom: 2.66 },
  ];
  return <PageCam src="flow-betrayal.png" keys={keys} />;
};
