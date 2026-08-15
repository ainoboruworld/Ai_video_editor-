import { describe, expect, it } from 'vitest';
import { assembleStoryboard, estimateNarrationSeconds, fitAssetToScene, splitScript } from '@/features/broll/assemble';
import { applyCommand, makeSequence, sequenceDuration, trackByRole, type Sequence } from '@/lib/engine';
import type { Asset, StoryboardScene } from '@/types';

function videoAsset(id: string, duration: number): Asset {
  return {
    id,
    kind: 'video',
    name: `clip ${id}`,
    url: `https://example.test/${id}.mp4`,
    thumbnailUrl: null,
    duration,
    width: 1080,
    height: 1920,
    sizeBytes: null,
    mimeType: 'video/mp4',
    origin: 'stock',
    storageKey: null,
    credit: null,
    createdAt: new Date(0).toISOString(),
  };
}

function scene(partial: Partial<StoryboardScene> & { id: string; index: number }): StoryboardScene {
  return {
    title: 'Scene',
    duration: 5,
    script: '',
    onScreenText: '',
    visual: 'a visual',
    brollQueries: [],
    assetId: null,
    transition: 'cut',
    clipIds: [],
    ...partial,
  };
}

function run(sequence: Sequence, commands: Parameters<typeof applyCommand>[1][]): Sequence {
  return commands.reduce((current, command) => applyCommand(current, command), sequence);
}

describe('fitAssetToScene', () => {
  it('trims footage that is longer than the scene', () => {
    const { commands, clipIds } = fitAssetToScene(videoAsset('a', 20), 0, 5, { trackId: 't' });
    expect(clipIds).toHaveLength(1);
    const add = commands[0] as { type: string; clip: { duration: number; speed: number } };
    expect(add.clip.duration).toBe(5);
    expect(add.clip.speed).toBe(1);
  });

  it('slows slightly short footage instead of leaving a gap', () => {
    const { commands } = fitAssetToScene(videoAsset('a', 4), 0, 5, { trackId: 't' });
    const add = commands[0] as { clip: { duration: number; speed: number } };
    expect(add.clip.duration).toBe(5);
    expect(add.clip.speed).toBeCloseTo(0.8, 2);
  });

  it('repeats very short footage to cover the scene', () => {
    const { clipIds } = fitAssetToScene(videoAsset('a', 2), 0, 5, { trackId: 't' });
    expect(clipIds.length).toBeGreaterThan(1);
  });

  it('holds an image for the whole scene', () => {
    const image = { ...videoAsset('i', 0), kind: 'image' as const, duration: null };
    const { commands } = fitAssetToScene(image, 2, 4, { trackId: 't' });
    const add = commands[0] as { clip: { kind: string; start: number; duration: number } };
    expect(add.clip.kind).toBe('image');
    expect(add.clip.start).toBe(2);
    expect(add.clip.duration).toBe(4);
  });

  it('adds the requested transition to the first segment', () => {
    const { commands } = fitAssetToScene(videoAsset('a', 10), 0, 5, { trackId: 't', transition: 'fade' });
    expect(commands.some((command) => command.type === 'ADD_TRANSITION')).toBe(true);
  });
});

describe('assembleStoryboard', () => {
  it('lays scenes end to end on the b-roll, text and caption tracks', () => {
    const sequence = makeSequence('s1', 'Test', '9:16');
    const assets = [videoAsset('a1', 12), videoAsset('a2', 12)];
    const scenes = [
      scene({ id: 's1', index: 0, duration: 4, assetId: 'a1', onScreenText: 'Hello', script: 'one two three' }),
      scene({ id: 's2', index: 1, duration: 6, assetId: 'a2', onScreenText: 'World', script: 'four five six' }),
    ];

    const { commands, placements } = assembleStoryboard({ sequence, scenes, assets, withCaptions: true });
    const next = run(sequence, commands);

    expect(placements.map((placement) => placement.start)).toEqual([0, 4]);
    expect(sequenceDuration(next)).toBeCloseTo(10, 5);

    const broll = trackByRole(next, 'broll')!;
    expect(broll.clips).toHaveLength(2);
    expect(broll.clips[1]!.start).toBe(4);

    expect(trackByRole(next, 'text')!.clips).toHaveLength(2);
    expect(trackByRole(next, 'caption')!.clips.length).toBeGreaterThan(0);
  });

  it('replaces a previous assembly instead of stacking clips', () => {
    const sequence = makeSequence('s1', 'Test', '9:16');
    const assets = [videoAsset('a1', 12)];
    const scenes = [scene({ id: 's1', index: 0, duration: 4, assetId: 'a1' })];

    const first = run(sequence, assembleStoryboard({ sequence, scenes, assets }).commands);
    const second = run(first, assembleStoryboard({ sequence: first, scenes, assets }).commands);

    expect(trackByRole(second, 'broll')!.clips).toHaveLength(1);
  });

  it('skips scenes with no chosen footage but keeps their timing', () => {
    const sequence = makeSequence('s1', 'Test', '9:16');
    const scenes = [
      scene({ id: 's1', index: 0, duration: 3 }),
      scene({ id: 's2', index: 1, duration: 3, onScreenText: 'Second' }),
    ];
    const { placements, commands } = assembleStoryboard({ sequence, scenes, assets: [] });
    const next = run(sequence, commands);
    expect(placements[1]!.start).toBe(3);
    expect(trackByRole(next, 'broll')!.clips).toHaveLength(0);
    expect(trackByRole(next, 'text')!.clips).toHaveLength(1);
  });
});

describe('splitScript', () => {
  it('spreads cues evenly across the scene without overlapping', () => {
    const cues = splitScript('one two three four five six seven eight', 10, 4);
    expect(cues[0]!.start).toBe(10);
    expect(cues[cues.length - 1]!.end).toBeCloseTo(14, 5);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i]!.start).toBeGreaterThanOrEqual(cues[i - 1]!.end - 0.001);
    }
  });
});

describe('estimateNarrationSeconds', () => {
  it('estimates read time from word count', () => {
    expect(estimateNarrationSeconds('one two three four five six')).toBeCloseTo(6 / 2.6, 5);
  });
});
