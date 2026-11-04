// Act 4 · the rest. S14 placeholder portrait, S15 quad montage (quad-split-parallel-scenes),
// S16 outro (outro-group-photo-launch, paper version: no dust, no glow, no shadows).
import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { C, EASE, FONT, SpeedBlur, ramp, velocity } from '../look';
import { CamKey, PageCam } from '../PageCam';
import { Press } from '../parts';

const clamp = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };

// ───────────── S14 · placeholder portrait ─────────────
export const S14Portrait: React.FC = () => {
  const keys: CamKey[] = [
    { frame: 0, cx: 700, cy: 300, zoom: 1.5 },
    { frame: 30, cx: 700, cy: 300, zoom: 1.5 },
    { frame: 70, cx: 960, cy: 306, zoom: 1.6 },
    { frame: 96, cx: 960, cy: 306, zoom: 1.6 },
    { frame: 136, cx: 960, cy: 470, zoom: 1.15 },
    { frame: 196, cx: 960, cy: 470, zoom: 1.15 },
    { frame: 240, cx: 960, cy: 452, zoom: 1.42 },
    { frame: 250, cx: 960, cy: 452, zoom: 1.42 },
    { frame: 280, cx: 600, cy: 280, zoom: 1.7 },
  ];
  return (
    <PageCam src="norman-page.png" keys={keys} swaps={[
      { at: 30, src: 'portrait-draft.png', fade: 6 },
      { at: 92, src: 'portrait-made.png', fade: 10 },
      { at: 252, src: 'portrait-kept.png', fade: 8 },
    ]}>
      <Press at={24} x={548} y={105} w={98} h={21} />
      <Press at={86} x={1161} y={442} w={102} h={30} />
    </PageCam>
  );
};

// ───────────── S15 · quad montage ─────────────
const QW = 948, QH = 528, G = 8;
type Panel = { src: string; label: string; cue: number; cam: (f: number) => { cx: number; cy: number; zoom: number } };
const inQuad = (t: number) => t * t;
const PANELS: Panel[] = [
  { src: 'palette.png', label: 'Ctrl+K to anywhere', cue: 3, cam: (f) => ({ cx: 958, cy: 330, zoom: 1.25 * (1 + 0.1 * inQuad(Math.min(1, f / 150))) }) },
  {
    src: 'large.png', label: 'Many stories, one timeline', cue: 8, cam: (f) => {
      const t = ramp(f, 37, 10, EASE.snappy);
      return { cx: 960 - 180 * t, cy: 820 - 40 * t, zoom: 0.62 * (1 + 0.85 * t) };
    },
  },
  { src: 'dark.png', label: 'Light and dark', cue: 12, cam: (f) => ({ cx: 960, cy: 540, zoom: 0.494 * (1 + 0.06 * ramp(f, 0, 150, EASE.smooth)) }) },
  { src: 'vault-menu.png', label: 'Markdown out', cue: 17, cam: (f) => ({ cx: 1712, cy: 250, zoom: 2.65 * (1 + 0.03 * ramp(f, 0, 150, EASE.smooth)) }) },
];

const PanelView: React.FC<{ p: Panel; i: number; frame: number }> = ({ p, i, frame }) => {
  const x = G + (i % 2) * (QW + G);
  const y = G + Math.floor(i / 2) * (QH + G);
  const t = ramp(frame, p.cue, 12, EASE.snappy);
  const cam = p.cam(frame);
  const lab = ramp(frame, p.cue + 10, 12, EASE.overshoot);
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: QW, height: QH, overflow: 'hidden', background: C.sunk, opacity: t }}>
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${1.04 - 0.04 * t})` }}>
        <div style={{
          position: 'absolute', width: 1920, height: 1080, zoom: cam.zoom,
          transform: `translate(${QW / 2 / cam.zoom - cam.cx}px, ${QH / 2 / cam.zoom - cam.cy}px)`,
        }}>
          <Img src={staticFile(`textures/${p.src}`)} style={{ width: 1920, height: 1080, display: 'block' }} />
        </div>
      </div>
      {lab > 0 && (
        <div style={{
          position: 'absolute', left: 24, bottom: 24, display: 'flex', alignItems: 'center', gap: 18, padding: '10px 26px 14px 20px',
          background: C.paper, border: `1px solid ${C.ink}`, borderRadius: 2, fontFamily: FONT.sans, fontSize: 56, fontWeight: 600, color: C.ink,
          transform: `scale(${0.85 + 0.15 * lab})`, transformOrigin: '0 100%', opacity: Math.min(1, lab * 1.4), whiteSpace: 'nowrap',
        }}>
          <span style={{ width: 18, height: 18, background: C.yellow }} />{p.label}
        </div>
      )}
    </div>
  );
};

export const S15Montage: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.rule }}>
      {PANELS.map((p, i) => <PanelView key={p.src} p={p} i={i} frame={frame} />)}
    </AbsoluteFill>
  );
};

// ───────────── S16 · outro ─────────────
type FlyEl = { key: string; src: string; w: number; h: number; cx: number; cy: number; rot: number; dx: number; dy: number; cue: number; crop?: { x: number; y: number; w: number; h: number } };
const ELS: FlyEl[] = [
  { key: 'agent', src: 'cut-agent.png', w: 290, h: 410, cx: 250, cy: 330, rot: -4, dx: -500, dy: 0, cue: 4 },
  { key: 'flow', src: 'cut-flow.png', w: 380, h: 263, cx: 1660, cy: 300, rot: 4, dx: 500, dy: 0, cue: 7 },
  { key: 'state', src: 'state-end-norman.png', w: 560, h: 141, cx: 1470, cy: 830, rot: -3, dx: 450, dy: 260, cue: 10 },
  { key: 'contra', src: 'cut-contradiction.png', w: 430, h: 159, cx: 360, cy: 800, rot: 3, dx: -400, dy: 300, cue: 13 },
  { key: 'portrait', src: 'cut-portrait.png', w: 150, h: 150, cx: 700, cy: 170, rot: -6, dx: 0, dy: -240, cue: 16 },
  { key: 'tracks', src: 'tracks.png', w: 760, h: 136, cx: 900, cy: 960, rot: 2, dx: 0, dy: 320, cue: 19, crop: { x: 0, y: 852, w: 1300, h: 232 } },
  { key: 'mira', src: 'cut-mira-after.png', w: 480, h: 111, cx: 1270, cy: 160, rot: 2.5, dx: 360, dy: -200, cue: 22 },
];
const FLY_EASE = Easing.bezier(0.34, 1.4, 0.44, 1);
const WORD = 'Living Writing'.split('');

export const S16Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const craneT = interpolate(frame, [0, 40], [0, 1], { ...clamp, easing: Easing.bezier(0.3, 0, 0.2, 1) });
  const pushT = ramp(frame, 36, 240 - 36, EASE.smooth);
  const camScale = 1.06 - 0.06 * craneT + 0.035 * pushT;
  const camTilt = 4 * (1 - craneT);
  const recede = interpolate(frame, [42, 54], [0, 1], clamp);
  const rule = interpolate(frame, [58, 70], [0, 1], { ...clamp, easing: Easing.bezier(0.3, 0, 0.2, 1) });
  const tag = ramp(frame, 68, 12, EASE.out);
  const small = ramp(frame, 84, 12, EASE.out);
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <AbsoluteFill style={{ transform: `perspective(1400px) rotateX(${camTilt}deg) scale(${camScale})`, transformOrigin: '50% 45%' }}>
        {ELS.map((el) => {
          if (frame < el.cue) return null;
          const posAt = (fr: number) => {
            const tt = interpolate(fr, [el.cue, el.cue + 12], [0, 1], { ...clamp, easing: FLY_EASE });
            return [el.dx * (1 - tt), el.dy * (1 - tt)];
          };
          const t = interpolate(frame, [el.cue, el.cue + 12], [0, 1], { ...clamp, easing: FLY_EASE });
          const op = interpolate(frame, [el.cue, el.cue + 3], [0, 1], clamp);
          const [x, y] = posAt(frame);
          const land = interpolate(frame, [el.cue + 9, el.cue + 12, el.cue + 16], [0, 1, 0], clamp);
          const scale = (1.12 - 0.12 * t) * (1 - 0.015 * land);
          return (
            <SpeedBlur key={el.key} vx={velocity((fr) => posAt(fr)[0], frame)} vy={velocity((fr) => posAt(fr)[1], frame)} amount={0.3} max={22}>
              <div style={{
                position: 'absolute', left: el.cx - el.w / 2, top: el.cy - el.h / 2, width: el.w, height: el.h, overflow: 'hidden',
                transform: `translate(${x}px, ${y}px) rotate(${el.rot * (2 - t)}deg) scale(${scale})`, background: '#fff',
                outline: `1px solid ${C.rule}`, opacity: op * (1 - 0.6 * recede), filter: recede > 0 ? `blur(${1.5 * recede}px)` : undefined,
              }}>
                {el.crop ? (
                  <div style={{ position: 'absolute', width: 1920, height: 1080, zoom: el.w / el.crop.w, transform: `translate(${-el.crop.x}px, ${-el.crop.y}px)` }}>
                    <Img src={staticFile(`textures/${el.src}`)} style={{ width: 1920, height: 1080, display: 'block' }} />
                  </div>
                ) : (
                  <Img src={staticFile(`textures/${el.src}`)} style={{ width: el.w, height: el.h, display: 'block' }} />
                )}
              </div>
            </SpeedBlur>
          );
        })}
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ textAlign: 'center', transform: 'translateY(-20px)' }}>
          <div style={{ fontFamily: FONT.sans, fontSize: 132, fontWeight: 700, color: C.ink, letterSpacing: '-0.02em', lineHeight: 1.1, display: 'flex', justifyContent: 'center' }}>
            {WORD.map((ch, i) => {
              const d = Math.round(42 + i * 1.8);
              const t = interpolate(frame, [d, d + 8], [0, 1], { ...clamp, easing: Easing.bezier(0.2, 0.75, 0.3, 1) });
              return (
                <span key={i} style={{
                  opacity: t, transform: `translateY(${(1 - t) * 28}px) scale(${1.35 - 0.35 * t})`, filter: t < 0.995 ? `blur(${(1 - t) * 8}px)` : undefined,
                  display: 'inline-block', whiteSpace: 'pre',
                }}>{ch}</span>
              );
            })}
          </div>
          <div style={{ height: 8, width: 280, margin: '34px auto 0', background: C.yellow, transform: `scaleX(${rule})` }} />
          <div style={{ fontFamily: FONT.serif, fontSize: 60, color: C.ink, marginTop: 34, opacity: tag, transform: `translateY(${(1 - tag) * 8}px)` }}>
            You write. The wiki keeps up.
          </div>
          <div style={{ fontFamily: FONT.sans, fontSize: 34, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted, marginTop: 34, opacity: small }}>
            Agent on Meta Muse Spark
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
