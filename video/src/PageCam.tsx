// PageCam: 2.5D camera over a full-page 2x screenshot. Copied from video-shotcraft
// assets/lib/PageCam.tsx (flat + 3D modes, CSS-zoom rasterising for sharp text); changes:
// paper-sunk stage colour, `swaps` to change screenshots on a frame (the real app's next state),
// and `camAt` exported so overlays can be placed in screen space.
import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { C, EASE } from './look';

export type CamKey = { frame: number; cx: number; cy: number; zoom: number; rotX?: number; rotY?: number; persp?: number };
export type Swap = { at: number; src: string; fade?: number };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const camAt = (keys: CamKey[], frame: number, ease = EASE.camera) => {
  let a = keys[0], b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (frame >= keys[i].frame && frame <= keys[i + 1].frame) { a = keys[i]; b = keys[i + 1]; break; }
  }
  if (frame < keys[0].frame) b = a;
  const t = a.frame === b.frame ? 1 : interpolate(frame, [a.frame, b.frame], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease,
  });
  return {
    cx: lerp(a.cx, b.cx, t), cy: lerp(a.cy, b.cy, t), zoom: lerp(a.zoom, b.zoom, t),
    rotX: lerp(a.rotX ?? 0, b.rotX ?? 0, t), rotY: lerp(a.rotY ?? 0, b.rotY ?? 0, t), persp: lerp(a.persp ?? 1400, b.persp ?? 1400, t),
  };
};

/** Screen position of a page point under a flat camera. */
export const toScreen = (cam: { cx: number; cy: number; zoom: number }, x: number, y: number) => ({
  x: 960 + (x - cam.cx) * cam.zoom,
  y: 540 + (y - cam.cy) * cam.zoom,
});

/** The screenshot stack: base src plus timed swaps (cross-faded over `fade` frames). */
const Pages: React.FC<{ src: string; swaps: Swap[]; frame: number; pageH: number }> = ({ src, swaps, frame, pageH }) => (
  <>
    <Img src={staticFile(`textures/${src}`)} style={{ position: 'absolute', width: 1920, height: pageH }} />
    {swaps.map((s) => {
      if (frame < s.at) return null;
      const o = s.fade ? Math.min(1, (frame - s.at) / s.fade) : 1;
      return <Img key={s.at} src={staticFile(`textures/${s.src}`)} style={{ position: 'absolute', width: 1920, height: pageH, opacity: o }} />;
    })}
  </>
);

export const PageCam: React.FC<{
  src: string;
  keys: CamKey[];
  swaps?: Swap[];
  pageH?: number;
  children?: React.ReactNode; // page-space overlays (CSS px)
  blur?: number;
}> = ({ src, keys, swaps = [], pageH = 1080, children, blur = 0 }) => {
  const frame = useCurrentFrame();
  const cam = camAt(keys, frame);
  const has3D = keys.some((k) => k.rotX !== undefined || k.rotY !== undefined);
  const filter = blur > 0 ? `blur(${blur}px)` : undefined;

  if (!has3D) {
    return (
      <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: C.sunk }}>
        <div style={{
          position: 'absolute', width: 1920, height: pageH, zoom: cam.zoom, filter,
          transform: `translate(${960 / cam.zoom - cam.cx}px, ${540 / cam.zoom - cam.cy}px)`,
        }}>
          <Pages src={src} swaps={swaps} frame={frame} pageH={pageH} />
          {children}
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: C.sunk }}>
      <div style={{ position: 'absolute', inset: 0, perspective: `${cam.persp * cam.zoom}px`, perspectiveOrigin: '960px 540px' }}>
        <div style={{
          position: 'absolute', width: 1920, height: pageH, zoom: cam.zoom, filter,
          transform: `translate(${960 / cam.zoom - cam.cx}px, ${540 / cam.zoom - cam.cy}px) rotateY(${cam.rotY}deg) rotateX(${cam.rotX}deg)`,
          transformOrigin: `${cam.cx}px ${cam.cy}px`, transformStyle: 'preserve-3d',
        }}>
          <Pages src={src} swaps={swaps} frame={frame} pageH={pageH} />
          {children}
        </div>
      </div>
    </AbsoluteFill>
  );
};
