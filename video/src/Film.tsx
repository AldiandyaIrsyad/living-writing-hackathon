// The film: SHOTS is the single source of truth for order, length and captions.
import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { C } from './look';
import { Caption, FlashCut, TitleCard } from './parts';
import { ColdOpen, DeskReveal, Wordmark } from './shots/Open';
import { S04Write, S05Check, S06Contradiction, S07TakeBack } from './shots/Agent';
import { S08Tracks, S09TimeTravel, S10Versions, S11Changes } from './shots/Time';
import { S12FlowCards, S13FlowPanel } from './shots/Flow';
import { S14Portrait, S15Montage, S16Outro } from './shots/More';
import { Sound } from './Sound';

type Cap = { text: string; from: number; to: number; at?: 'bottom' | 'top' };
type Title = { text: string; n: number; label: string };
type Shot = { id: string; dur: number; C?: React.FC; title?: Title; cap?: Cap };

/** Act title card; `*word*` marks the accent word. */
export const TitleUnit: React.FC<Title & { duration: number }> = ({ text, n, label, duration }) => (
  <TitleCard
    words={text.split(' ').map((w) => (w.startsWith('*') ? { text: w.replace(/\*/g, ''), accent: true } : { text: w }))}
    n={n} label={label} duration={duration}
  />
);
/** A caption as its own clip (used by the workbench). */
export const CaptionUnit: React.FC<{ text: string; duration: number }> = ({ text, duration }) => <Caption text={text} from={0} to={duration} />;

const SHOT_LIST: Shot[] = [
  { id: 'S01', dur: 180, C: ColdOpen },
  { id: 'S02', dur: 140, C: Wordmark },
  { id: 'S03', dur: 210, C: DeskReveal },
  { id: 'T1', dur: 55, title: { text: 'The *agent* keeps the wiki.', n: 1, label: 'The agent' } },
  { id: 'S04', dur: 460, C: S04Write, cap: { text: 'Write the scene. Link people and places with [[brackets]].', from: 44, to: 450 } },
  { id: 'S05', dur: 480, C: S05Check, cap: { text: 'Press Check. The agent files a page for Nora and updates who is where.', from: 16, to: 470 } },
  { id: 'S06', dur: 360, C: S06Contradiction, cap: { text: 'It catches contradictions, quoting your scene and the wiki line it breaks.', from: 20, to: 350 } },
  { id: 'S07', dur: 270, C: S07TakeBack, cap: { text: 'Everything the agent wrote is one click from undone.', from: 20, to: 262 } },
  { id: 'T2', dur: 55, title: { text: 'The *timeline* is story time.', n: 2, label: 'The timeline' } },
  { id: 'S08', dur: 330, C: S08Tracks, cap: { text: 'Stories are tracks. Scenes are clips. Side stories run alongside.', from: 40, to: 322 } },
  { id: 'S09', dur: 210, C: S09TimeTravel, cap: { text: 'Move the playhead. See the world as it stood then.', from: 8, to: 202 } },
  { id: 'S10', dur: 240, C: S10Versions, cap: { text: 'Every page keeps its versions, in story time.', from: 20, to: 232 } },
  { id: 'S11', dur: 300, C: S11Changes, cap: { text: 'Each scene records what it changes. Norman falls. Ashford burns.', from: 40, to: 292 } },
  { id: 'T3', dur: 55, title: { text: '*Flow* reads the shape of the story.', n: 3, label: 'Flow' } },
  { id: 'S12', dur: 210, C: S12FlowCards, cap: { text: 'Flow places each scene in the whole story: its part and its tone.', from: 20, to: 202 } },
  { id: 'S13', dur: 330, C: S13FlowPanel, cap: { text: 'It reads your outline and the wiki. It never writes the story for you.', from: 30, to: 322 } },
  { id: 'T4', dur: 55, title: { text: 'Portraits, search, *export.*', n: 4, label: 'More' } },
  { id: 'S14', dur: 300, C: S14Portrait, cap: { text: 'Placeholder portraits from the wiki, marked temporary until real art.', from: 20, to: 292 } },
  { id: 'S15', dur: 150, C: S15Montage },
  { id: 'S16', dur: 240, C: S16Outro },
];

export const SHOTS = (() => {
  let at = 0;
  return SHOT_LIST.map((s) => {
    const r = { ...s, from: at };
    at += s.dur;
    return r;
  });
})();
export const FILM_FRAMES = SHOTS[SHOTS.length - 1].from + SHOTS[SHOTS.length - 1].dur;
export const startOf = (id: string) => SHOTS.find((s) => s.id === id)!.from;

// Flash cuts on two hard seams between different screens (shot-transitions · flash-cut, ≤2).
export const FLASHES = ['S08', 'S15'];

export const Film: React.FC<{ bgm: boolean }> = ({ bgm }) => (
  <AbsoluteFill style={{ background: C.paper }}>
    {SHOTS.map((s) => (
      <Sequence key={s.id} from={s.from} durationInFrames={s.dur} name={s.id}>
        {s.C ? <s.C /> : <TitleUnit {...s.title!} duration={s.dur} />}
        {s.cap && <Caption {...s.cap} />}
      </Sequence>
    ))}
    {FLASHES.map((id) => (
      <Sequence key={`flash-${id}`} from={startOf(id) - 4} durationInFrames={10} name={`flash ${id}`}>
        <FlashCut at={0} />
      </Sequence>
    ))}
    <Sound bgm={bgm} />
  </AbsoluteFill>
);
