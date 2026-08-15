import { describe, expect, it } from 'vitest';
import { extractSubject, offlineCaptionCues, offlineStoryboard } from '@/lib/ai/offline';

describe('extractSubject', () => {
  it('pulls the topic out of a natural brief', () => {
    expect(extractSubject('Create a 30-second Instagram Reel about organic mangoes')).toBe('organic mangoes');
  });

  it('falls back to the whole brief', () => {
    expect(extractSubject('morning productivity routine')).toContain('morning');
  });
});

describe('offlineStoryboard', () => {
  it('produces scenes whose durations add up to the requested length', () => {
    const storyboard = offlineStoryboard({
      prompt: 'Create a 30-second reel about organic mangoes',
      durationSeconds: 30,
      aspect: '9:16',
    });
    const total = storyboard.scenes.reduce((sum, scene) => sum + scene.duration, 0);
    expect(total).toBeGreaterThan(28);
    expect(total).toBeLessThan(32);
  });

  it('gives every scene a visual and searchable queries', () => {
    const storyboard = offlineStoryboard({
      prompt: 'A reel about sourdough baking',
      durationSeconds: 20,
      aspect: '9:16',
    });
    for (const scene of storyboard.scenes) {
      expect(scene.visual.length).toBeGreaterThan(3);
      expect(scene.brollQueries.length).toBeGreaterThan(0);
    }
  });

  it('honours an explicit scene count', () => {
    const storyboard = offlineStoryboard({
      prompt: 'A reel about cold brew',
      durationSeconds: 24,
      aspect: '16:9',
      sceneCount: 3,
    });
    expect(storyboard.scenes).toHaveLength(3);
  });
});

describe('offlineCaptionCues', () => {
  it('splits narration into cues inside the scene window', () => {
    const cues = offlineCaptionCues('one two three four five six seven', 5, 3);
    expect(cues[0]!.start).toBe(5);
    expect(cues[cues.length - 1]!.end).toBeCloseTo(8, 5);
    expect(cues.every((cue) => cue.text.split(' ').length <= 5)).toBe(true);
  });
});
