// Act 1 · the agent. S04 write, S05 Check, S06 contradiction, S07 take back.
// One continuous camera over the real screens; each shot starts where the last one ended.
import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { C, EASE, ramp } from '../look';
import { CamKey, PageCam, camAt, toScreen } from '../PageCam';
import { Press, Reticle } from '../parts';

// Framings (page CSS px). INSP keeps the inspector's right edge on the frame edge.
const EDIT = { cx: 930, cy: 470, zoom: 1.6 };
const LINE = { cx: 840, cy: 490, zoom: 1.9 };
const INSP = { cx: 1414, cy: 380, zoom: 1.9 };
const INSP_LOW = { cx: 1414, cy: 440, zoom: 1.9 };
const CONTRA = { cx: 1551, cy: 483, zoom: 2.6 };
const SCENE = { cx: 860, cy: 505, zoom: 2.2 };
const TAKEBACK = { cx: 1484, cy: 250, zoom: 2.2 };
const BOTH = { cx: 1120, cy: 380, zoom: 1.2 };

// ───────────── S04 · typing, from the 13 real frames ─────────────
// Each captured frame k shows the line up to END[k] (CSS x). Between frames we show frame k with
// the not-yet-typed part masked in editor paper, revealed in ~one-character steps. Frames 1, 4 and 11
// carry the real link autocomplete; they hold a beat.
const END = [539, 593, 620, 662, 711, 749, 795, 845, 900, 944, 983, 1028, 1072];
const POPUP = new Set([1, 4, 11]);
export const TYPE0 = 40;
const F_PER_PX = 0.5; // ~7 characters a second
export const SEG = (() => {
  const s: { k: number; start: number; typeDur: number }[] = [];
  let t = TYPE0;
  for (let k = 1; k < END.length; k++) {
    const typeDur = (END[k] - END[k - 1]) * F_PER_PX;
    s.push({ k, start: t, typeDur });
    t += typeDur + (POPUP.has(k) ? 12 : 0);
  }
  return { list: s, end: t };
})();
const LINE_Y0 = 490, LINE_Y1 = 527;

const Typing: React.FC = () => {
  const f = useCurrentFrame();
  if (f < TYPE0) return null;
  let seg = SEG.list[0];
  for (const s of SEG.list) if (f >= s.start) seg = s;
  const p = Math.min(1, (f - seg.start) / seg.typeDur);
  const span = END[seg.k] - END[seg.k - 1];
  const STEP = 8.6;
  const shown = p >= 1 ? span : Math.floor((span * p) / STEP) * STEP;
  const clipX = END[seg.k - 1] + shown;
  const typing = p < 1;
  const caretOn = typing || Math.floor((f - seg.start - seg.typeDur) / 8) % 2 === 0;
  return (
    <>
      <Img src={staticFile(`textures/type-${String(seg.k).padStart(2, '0')}.png`)} style={{ position: 'absolute', width: 1920, height: 1080 }} />
      {shown < span && (
        <div style={{ position: 'absolute', left: clipX + 1, top: LINE_Y0, width: END[seg.k] - clipX + 6, height: LINE_Y1 - LINE_Y0, background: C.paper }} />
      )}
      {f < SEG.end + 30 && caretOn && <div style={{ position: 'absolute', left: clipX + 1, top: 495, width: 1.5, height: 24, background: C.ink }} />}
    </>
  );
};

export const S04Write: React.FC = () => {
  const f = useCurrentFrame();
  const keys: CamKey[] = [
    { frame: 0, ...EDIT, zoom: 1.45 },
    { frame: 40, ...EDIT },
    { frame: 330, ...LINE },
    { frame: 390, ...LINE },
    { frame: 450, ...INSP },
  ];
  return (
    <PageCam src="desk.png" keys={keys} swaps={[{ at: 22, src: 'type-00.png', fade: 8 }, { at: SEG.end + 20, src: 'typed.png' }]}>
      {f < SEG.end + 20 && <Typing />}
    </PageCam>
  );
};

// ───────────── S05 · Check → report, reticle on the new page ─────────────
export const RET5 = 130;
export const S05Check: React.FC = () => {
  const f = useCurrentFrame();
  const keys: CamKey[] = [{ frame: 0, ...INSP }, { frame: 330, ...INSP }, { frame: 470, ...INSP_LOW }];
  const cam = camAt(keys, RET5 + 46);
  const a = toScreen(cam, 1601, 186);
  const b = toScreen(cam, 1909, 234);
  const out = 1 - ramp(f, 300, 10, EASE.swift);
  return (
    <AbsoluteFill>
      <PageCam src="typed.png" keys={keys} swaps={[{ at: 28, src: 'checking.png' }, { at: 112, src: 'report.png', fade: 8 }]}>
        <Press at={24} x={1603} y={163} w={50} h={21} />
      </PageCam>
      {out > 0 && (
        <AbsoluteFill style={{ opacity: out }}>
          <Reticle start={RET5} rect={{ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }} label="New page · Nora" pad={12} />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

// ───────────── S06 · the contradiction, then the scene line it quotes ─────────────
export const RET6 = 30;
export const S06Contradiction: React.FC = () => {
  const f = useCurrentFrame();
  const keys: CamKey[] = [{ frame: 0, ...INSP_LOW }, { frame: 36, ...CONTRA }, { frame: 200, ...CONTRA }, { frame: 250, ...SCENE }];
  const cam = camAt(keys, RET6 + 46);
  const a = toScreen(cam, 1603, 427);
  const b = toScreen(cam, 1908, 540);
  const out = 1 - ramp(f, 190, 8, EASE.swift);
  const under = ramp(f, 256, 22, EASE.out);
  return (
    <AbsoluteFill>
      <PageCam src="report.png" keys={keys}>
        {under > 0 && (
          <div style={{ position: 'absolute', left: 783, top: 521, width: (1072 - 783) * under, height: 2.5, background: C.red }} />
        )}
      </PageCam>
      {out > 0 && (
        <AbsoluteFill style={{ opacity: out }}>
          <Reticle start={RET6} rect={{ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }} label="Contradiction" color={C.red} pad={10} />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

// ───────────── S07 · take back ─────────────
export const S07TakeBack: React.FC = () => {
  const f = useCurrentFrame();
  const keys: CamKey[] = [{ frame: 0, ...SCENE }, { frame: 40, ...TAKEBACK }, { frame: 96, ...TAKEBACK }, { frame: 150, ...BOTH }];
  const mark = ramp(f, 160, 14, EASE.out);
  return (
    <PageCam src="report.png" keys={keys} swaps={[{ at: 48, src: 'takeback-hover.png' }, { at: 70, src: 'takeback-after.png', fade: 8 }]}>
      <Press at={66} x={1725} y={163} w={129} h={21} />
      {mark > 0 && <div style={{ position: 'absolute', left: 537, top: 521, width: 65 * mark, height: 4, background: C.yellow }} />}
    </PageCam>
  );
};
