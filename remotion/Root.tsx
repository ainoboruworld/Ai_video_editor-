import React from 'react';
import { Composition } from 'remotion';
import { ProjectComposition } from './ProjectComposition';
import type { RemotionProps } from './types';

/**
 * A single parameterised composition: the worker passes the project document as
 * input props and overrides width/height/fps/duration per render, so one
 * composition serves every aspect ratio and export preset.
 */
const EMPTY: RemotionProps['project'] = {
  name: 'Empty project',
  width: 1080,
  height: 1920,
  fps: 30,
  sequence: { width: 1080, height: 1920, fps: 30, tracks: [] },
  assets: [],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Project"
      component={ProjectComposition as unknown as React.FC<Record<string, unknown>>}
      durationInFrames={300}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ project: EMPTY } as unknown as Record<string, unknown>}
    />
  );
};
