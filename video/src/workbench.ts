// Motion workbench manifest (video-shotcraft workbench §2). Everything is imported from the film's
// own tables, so the imported project renders the same as DemoFilm.
import { CaptionUnit, FILM_FRAMES, FLASHES, Film, SHOTS, TitleUnit, startOf } from './Film';
import { FlashCut } from './parts';
import { BGM_FROM, BGM_VOLUME, cues, sfxFrom } from './Sound';
import { C } from './look';

const FlashUnit = () => FlashCut({ at: 0 });

export const WORKBENCH = {
  name: 'Living Writing · hackathon demo',
  fps: 30, width: 1920, height: 1080,
  total: FILM_FRAMES,
  background: C.paper,
  shots: SHOTS.map((s) => s.C
    ? { id: s.id, label: s.id, from: s.from, duration: s.dur, component: s.C }
    : {
      id: s.id, label: `${s.id} title card`, from: s.from, duration: s.dur, component: TitleUnit,
      props: { ...s.title! }, durationProp: 'duration', cardId: 'title-card', cardName: 'Title card',
      schema: [
        { type: 'text', key: 'text', label: 'Statement (*accent*)', default: '' },
        { type: 'number', key: 'n', label: 'Act number', default: 1 },
        { type: 'text', key: 'label', label: 'Act label', default: '' },
      ],
    }),
  transitions: FLASHES.map((id) => ({ id: `flash-${id}`, label: `Flash ${id}`, from: startOf(id) - 4, duration: 10, component: FlashUnit })),
  captions: SHOTS.filter((s) => s.cap).map((s) => ({
    id: `cap-${s.id}`, label: `Caption ${s.id}`, from: s.from + s.cap!.from, duration: s.cap!.to - s.cap!.from,
    component: CaptionUnit, props: { text: s.cap!.text }, durationProp: 'duration', cardId: 'caption', cardName: 'Caption',
    schema: [{ type: 'textarea', key: 'text', label: 'Caption', default: '' }],
  })),
  overlays: [],
  sfx: cues().map((q) => ({ from: sfxFrom(q.at, q.src), duration: q.dur ?? 120, src: `audio/sfx/${q.src}`, volume: q.volume })),
  bgm: [{ from: BGM_FROM, duration: FILM_FRAMES - BGM_FROM, src: 'audio/bgm/bgm-tech-house.mp3', volume: BGM_VOLUME }],
  order: ['transitions', 'captions', 'overlays'],
  original: Film,
};
