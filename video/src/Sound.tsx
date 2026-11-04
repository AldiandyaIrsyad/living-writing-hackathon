// Sound: one central cue table, every cue pinned to an action inside a shot (startOf(shot) + offset).
// A cue's `at` is the frame where the sound's own energy peak should land; sfxFrom() subtracts the
// file's measured peak (audio-manifest.json, energy_peak_seconds) and the output audio offset.
import React from 'react';
import { Audio, Sequence, interpolate, staticFile } from 'remotion';
import { FILM_FRAMES, startOf } from './Film';
import { DEL0, DEL_END, RIGHT, TYPE0 as KEY0, WRONG } from './shots/Open';
import { RET5, RET6, SEG, TYPE0 } from './shots/Agent';
import { popFrameOf } from './shots/Time';
import { FLIP0, PRE, STAGGER } from './shots/Flow';

// AAC priming in Remotion's mp4 output (sound-design §4.6). Checked 2026-11-04 on Remotion 4.0.484,
// AAC 48 kHz, mp4, Windows: scripts/audio-offset.py on the no-BGM render, probes = mouse click ×3,
// switch ×2, impact ×1 (normalised cross-correlation 1.00): residual −0.18…+0.40 f with this value.
const OUTPUT_AUDIO_OFFSET_F = 1.28;
// energy_peak_seconds × 30, from audio-manifest.json
const PEAK_F: Record<string, number> = {
  'fs-380137.mp3': 1.35, 'fs-360602.mp3': 0.45, 
  // beds, not hits: typing and pen are continuous, so they start with the action (peak 0 on purpose)
  'fs-517762.mp3': 0, 'fs-751055.mp3': 0,
  'fs-71852.mp3': 13.05, 'fs-623709.mp3': 3.75, 'fs-444431-gain.mp3': 14.85, 'fs-687107.mp3': 4.35,
  'fs-278204.mp3': 1.05, 'fs-84322.mp3': 15.15, 'fs-859482.mp3': 68.55, 'fs-728515.mp3': 0.75,
};
export const sfxFrom = (at: number, src: string) => Math.max(0, Math.round(at - (PEAK_F[src] ?? 0) - OUTPUT_AUDIO_OFFSET_F));

type Cue = { at: number; src: string; volume: number; dur?: number; trim?: number; note: string };

const KEY = ['fs-380137.mp3', 'fs-360602.mp3'];
const CLICK = 'fs-687107.mp3', SNAP = 'fs-278204.mp3', WHOOSH = 'fs-71852.mp3', SWOOSH = 'fs-623709.mp3';
const PAPER = 'fs-444431-gain.mp3', PEN = 'fs-751055.mp3', FLIP = 'fs-84322.mp3';

export const cues = (): Cue[] => {
  const s = startOf;
  const c: Cue[] = [];
  // S01 · typewriter: one key per character (two samples alternating, volume steps), backspace every other step
  for (let i = 0; i < WRONG.length; i++) c.push({ at: KEY0 + i * 2, src: KEY[i % 2], volume: 0.32 - (i % 3) * 0.04, note: 'S01 type' });
  for (let i = 0; i < WRONG.length; i += 2) c.push({ at: DEL0 + i * 1.5, src: KEY[(i / 2) % 2], volume: 0.2, note: 'S01 backspace' });
  for (let i = 0; i < RIGHT.length; i++) c.push({ at: DEL_END + i * 1.5, src: KEY[i % 2], volume: 0.3 - (i % 3) * 0.04, note: 'S01 retype' });
  // S02 · the wordmark strokes itself
  c.push({ at: s('S02') + 16, src: PEN, volume: 0.45, dur: 52, note: 'S02 pen stroke' });
  // S03 · the desk lifts
  c.push({ at: s('S03') + 42, src: WHOOSH, volume: 0.45, note: 'S03 tilt up' });
  // title cards
  for (const t of ['T1', 'T2', 'T3', 'T4']) c.push({ at: s(t) + 8, src: PAPER, volume: 0.55, note: `${t} paper` });
  // S04 · typing on a real keyboard (the clip is 5.3s; two windows cover the line)
  const typeLen = SEG.end - TYPE0;
  for (let t = 0; t < typeLen; t += 141) c.push({ at: s('S04') + TYPE0 + t, src: 'fs-517762.mp3', volume: 0.42, trim: 9, dur: Math.min(141, typeLen - t), note: 'S04 typing' });
  c.push({ at: s('S04') + 420, src: SWOOSH, volume: 0.22, note: 'S04 camera to inspector' });
  // S05 · Check, the report lands, reticle bites
  c.push({ at: s('S05') + 24, src: CLICK, volume: 0.6, note: 'S05 Check click' });
  c.push({ at: s('S05') + 114, src: SWOOSH, volume: 0.22, note: 'S05 report appears' });
  c.push({ at: s('S05') + RET5 + 22, src: WHOOSH, volume: 0.22, note: 'S05 reticle flies in' });
  c.push({ at: s('S05') + RET5 + 46, src: SNAP, volume: 0.5, note: 'S05 reticle lock' });
  // S06 · push in, red reticle, pan to the scene line, underline
  c.push({ at: s('S06') + 18, src: SWOOSH, volume: 0.25, note: 'S06 push in' });
  c.push({ at: s('S06') + RET6 + 46, src: SNAP, volume: 0.55, note: 'S06 reticle lock' });
  c.push({ at: s('S06') + 225, src: WHOOSH, volume: 0.28, note: 'S06 pan to scene' });
  c.push({ at: s('S06') + 256, src: PEN, volume: 0.35, dur: 22, note: 'S06 underline' });
  // S07 · take back
  c.push({ at: s('S07') + 20, src: SWOOSH, volume: 0.22, note: 'S07 camera' });
  c.push({ at: s('S07') + 66, src: CLICK, volume: 0.6, note: 'S07 Take back click' });
  c.push({ at: s('S07') + 120, src: SWOOSH, volume: 0.2, note: 'S07 pull back' });
  // S08 · flash cut onto the timeline
  c.push({ at: s('S08'), src: SWOOSH, volume: 0.32, note: 'S08 flash cut' });
  // S09 · the playhead travels, cards pop
  c.push({ at: s('S09') + 58, src: WHOOSH, volume: 0.5, note: 'S09 travel' });
  for (const i of [1, 2]) c.push({ at: s('S09') + popFrameOf(i) - 4, src: SNAP, volume: 0.28, note: `S09 card ${i}` });
  // S10 · slider fling
  c.push({ at: s('S10') + 20, src: SWOOSH, volume: 0.35, note: 'S10 fling' });
  // S11 · open Changes
  c.push({ at: s('S11') + 30, src: CLICK, volume: 0.6, note: 'S11 Changes click' });
  // S12 · four flips
  for (let i = 0; i < 4; i++) c.push({ at: s('S12') + FLIP0 + i * STAGGER + PRE + 8, src: FLIP, volume: i % 2 ? 0.36 : 0.44, note: `S12 flip ${i + 1}` });
  // S13 · push into Flow
  c.push({ at: s('S13') + 52, src: WHOOSH, volume: 0.3, note: 'S13 push in' });
  // S14 · Make portrait, Make picture, the picture appears
  c.push({ at: s('S14') + 24, src: CLICK, volume: 0.6, note: 'S14 Make portrait click' });
  c.push({ at: s('S14') + 86, src: CLICK, volume: 0.6, note: 'S14 Make picture click' });
  c.push({ at: s('S14') + 96, src: SWOOSH, volume: 0.22, note: 'S14 picture' });
  c.push({ at: s('S14') + 262, src: SWOOSH, volume: 0.22, note: 'S14 to the page' });
  // S15 · flash cut, panels arrive
  c.push({ at: s('S15'), src: SWOOSH, volume: 0.32, note: 'S15 flash cut' });
  [3, 8, 12, 17].forEach((cue, i) => c.push({ at: s('S15') + cue + 4, src: SNAP, volume: 0.24 - i * 0.03, note: `S15 panel ${i + 1}` }));
  // S16 · elements fly in, riser → impact on the wordmark
  [4, 13, 22].forEach((cue, i) => c.push({ at: s('S16') + cue + 6, src: SWOOSH, volume: 0.32 - i * 0.05, note: `S16 flight ${i + 1}` }));
  c.push({ at: s('S16') + 42, src: 'fs-859482.mp3', volume: 0.4, note: 'S16 riser' });
  c.push({ at: s('S16') + 44, src: 'fs-728515.mp3', volume: 0.5, note: 'S16 wordmark impact' });
  return c;
};

export const BGM_FROM = 180; // enters with the wordmark
export const BGM_VOLUME = 0.13;
// SFX play ~3.5 dB over their table values so they read over the BGM (sample peak checked after render)
const SFX_GAIN = 1.5;
export const Sound: React.FC<{ bgm: boolean }> = ({ bgm }) => (
  <>
    {bgm && (
      <Sequence from={BGM_FROM} name="bgm">
        <Audio
          src={staticFile('audio/bgm/bgm-tech-house.mp3')}
          volume={(f) => BGM_VOLUME * interpolate(f, [0, 45, FILM_FRAMES - BGM_FROM - 60, FILM_FRAMES - BGM_FROM], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
        />
      </Sequence>
    )}
    {cues().map((q, i) => (
      <Sequence key={i} from={sfxFrom(q.at, q.src)} durationInFrames={q.dur ?? 120} name={q.note}>
        <Audio src={staticFile(`audio/sfx/${q.src}`)} volume={(f) => Math.min(1, q.volume * SFX_GAIN) * (q.dur ? interpolate(f, [q.dur - 6, q.dur], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1)} trimBefore={q.trim} />
      </Sequence>
    ))}
  </>
);
