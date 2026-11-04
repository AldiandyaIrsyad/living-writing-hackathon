import React from 'react';
import { Composition } from 'remotion';
import { FILM_FRAMES, Film } from './Film';

export const Root: React.FC = () => (
  <Composition
    id="DemoFilm"
    component={Film}
    durationInFrames={FILM_FRAMES}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{ bgm: true }}
  />
);
