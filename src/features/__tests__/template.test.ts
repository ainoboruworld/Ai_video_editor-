import { describe, expect, it } from 'vitest';
import { buildProfile } from '@/features/template/analyse';
import { aggressionForShotLength, planTemplate } from '@/features/template/apply';
import { describeProfile, INTENSITY_WEIGHT, type StyleProfile } from '@/features/template/profile';
import { applyCommand, makeClip, makeSequence, trackByRole, type Sequence } from '@/lib/engine';
import type { LoudnessEnvelope } from '@/features/analysis/audioAnalysis';

/**
 * Synthetic frame samples. `cutsAt` are sample indices where the picture jumps;
 * everything else drifts slightly, like a locked-off talking head.
 */
function frames(options: {
  count: number;
  fps?: number;
  cutsAt?: number[];
  gradual?: boolean;
  dipAt?: number[];
  captionBand?: 0 | 1 | 2;
  captionEvery?: number;
  motion?: number;
}) {
  const fps = options.fps ?? 8;
  const cuts = new Set(options.cutsAt ?? []);
  const dips = new Set(options.dipAt ?? []);
  return Array.from({ length: options.count }, (_, i) => {
    const isCut = cuts.has(i);
    const isDip = dips.has(i);
    const bands: [number, number, number] = [0.001, 0.001, 0.001];
    if (options.captionBand !== undefined) {
      // Captions turn over every `captionEvery` samples — present, then gone.
      const on = Math.floor(i / (options.captionEvery ?? 8)) % 2 === 0;
      bands[options.captionBand] = on ? 0.05 : 0.001;
    }
    return {
      time: i / fps,
      change: isCut || isDip ? (options.gradual ? 0.12 : 0.4) : (options.motion ?? 0.004),
      luma: isDip ? 0.02 : 0.5,
      bands,
    };
  });
}

/** A loudness envelope with a given floor between phrases and under speech. */
function envelope(options: { seconds: number; bed: number; ducked: number; speechEvery?: number; silentHead?: number }): LoudnessEnvelope {
  const windowSeconds = 0.05;
  const count = Math.round(options.seconds / windowSeconds);
  const every = options.speechEvery ?? 20;
  const head = Math.round((options.silentHead ?? 0) / windowSeconds);
  const values = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    if (i < head) {
      values[i] = options.bed;
      continue;
    }
    // Alternating blocks: speaking, then a gap.
    values[i] = Math.floor(i / every) % 2 === 0 ? 1 : options.bed;
    if (Math.floor(i / every) % 2 === 0) values[i] = Math.max(options.ducked, 0.6);
  }
  return { values, windowSeconds, duration: options.seconds, peak: 1 };
}

describe('reading pacing off the frames', () => {
  it('counts cuts and works out the average shot', () => {
    // 80 samples at 8fps = 10s, cut every 2s.
    const profile = buildProfile('ref.mp4', frames({ count: 80, cutsAt: [16, 32, 48, 64] }), null);
    expect(profile.pacing.cutsPerMinute).toBeGreaterThan(23);
    expect(profile.pacing.cutsPerMinute).toBeLessThan(26);
    expect(profile.pacing.averageShotSeconds).toBeCloseTo(2, 0);
  });

  it('calls a single continuous shot what it is, and says so', () => {
    const profile = buildProfile('ref.mp4', frames({ count: 60 }), null);
    expect(profile.pacing.cutsPerMinute).toBe(0);
    expect(profile.caveats.join(' ')).toContain('single continuous shot');
  });

  it('reports how evenly the shots are spaced', () => {
    const even = buildProfile('a', frames({ count: 80, cutsAt: [16, 32, 48, 64] }), null);
    const uneven = buildProfile('b', frames({ count: 80, cutsAt: [4, 8, 60] }), null);
    expect(uneven.pacing.variation).toBeGreaterThan(even.pacing.variation);
  });
});

describe('reading the joins', () => {
  it('calls an instant change a hard cut', () => {
    expect(buildProfile('a', frames({ count: 60, cutsAt: [20, 40] }), null).transitions.style).toBe('hard');
  });

  it('calls a change spread over several samples a dissolve', () => {
    const profile = buildProfile('a', frames({ count: 60, cutsAt: [20, 21, 22, 40, 41, 42], gradual: true }), null);
    expect(profile.transitions.style).toBe('dissolve');
    expect(profile.transitions.dissolveShare).toBeGreaterThan(0.5);
  });

  it('calls a pass through black a dip', () => {
    const profile = buildProfile('a', frames({ count: 60, dipAt: [20, 21, 40, 41] }), null);
    expect(profile.transitions.style).toBe('dip');
  });

  it('admits the sampling rate limits what a join can be called', () => {
    expect(buildProfile('a', frames({ count: 60, cutsAt: [20] }), null).caveats.join(' ')).toMatch(/hard cuts/i);
  });
});

describe('reading captions and music', () => {
  it('finds burned-in captions and which band they sit in', () => {
    const profile = buildProfile('a', frames({ count: 80, captionBand: 2, captionEvery: 6 }), null);
    expect(profile.captions.present).toBe(true);
    expect(profile.captions.band).toBe('lower');
  });

  it('does not call a bright static area a caption', () => {
    // Constant energy in a band, never turning over: a logo, not a caption.
    const constant = frames({ count: 80 }).map((frame) => ({ ...frame, bands: [0.001, 0.001, 0.05] as [number, number, number] }));
    expect(buildProfile('a', constant, null).captions.present).toBe(false);
  });

  it('detects a music bed from the floor between phrases', () => {
    const profile = buildProfile('a', frames({ count: 60 }), envelope({ seconds: 20, bed: 0.18, ducked: 0.06 }));
    expect(profile.music.present).toBe(true);
    expect(profile.music.bedLevel).toBeGreaterThan(0.1);
  });

  it('calls voice-only audio voice-only', () => {
    const profile = buildProfile('a', frames({ count: 60 }), envelope({ seconds: 20, bed: 0.004, ducked: 0.004 }));
    expect(profile.music.present).toBe(false);
    expect(profile.music.bedLevel).toBeLessThan(0.02);
  });

  it('refuses to claim a ducking depth it cannot measure', () => {
    // Music and speech are one waveform; the level under a voice is the voice.
    // Saying how far the reference ducked would be a confident invention.
    const profile = buildProfile('a', frames({ count: 60 }), envelope({ seconds: 20, bed: 0.18, ducked: 0.06 }));
    expect(profile.music).not.toHaveProperty('duckingDepth');
    expect(profile.caveats.join(' ')).toMatch(/cannot be measured/i);
  });

  it('measures a speechless intro', () => {
    const profile = buildProfile('a', frames({ count: 60 }), envelope({ seconds: 20, bed: 0.18, ducked: 0.06, silentHead: 3 }));
    expect(profile.structure.introSeconds).toBeGreaterThan(2.5);
  });

  it('says when the audio could not be read at all', () => {
    expect(buildProfile('a', frames({ count: 60 }), null).caveats.join(' ')).toContain('audio could not be decoded');
  });
});

describe('mapping a reference onto the pause slider', () => {
  it('wants conservative trimming for a slow reference and aggressive for a fast one', () => {
    expect(aggressionForShotLength(8)).toBe(0);
    expect(aggressionForShotLength(1.5)).toBe(1);
    expect(aggressionForShotLength(4)).toBeGreaterThan(0.4);
    expect(aggressionForShotLength(4)).toBeLessThan(0.8);
  });

  it('clamps rather than extrapolating past what pause trimming can do', () => {
    expect(aggressionForShotLength(0.2)).toBe(1);
    expect(aggressionForShotLength(60)).toBe(0);
  });
});

describe('applying a template', () => {
  function profile(overrides: Partial<StyleProfile> = {}): StyleProfile {
    return {
      id: 't1',
      name: 'Fast talking head',
      createdAt: new Date(0).toISOString(),
      sourceName: 'ref.mp4',
      durationSeconds: 60,
      pacing: { cutsPerMinute: 24, averageShotSeconds: 2, medianShotSeconds: 2, shortestShotSeconds: 1, variation: 0.2 },
      transitions: { style: 'hard', dissolveShare: 0, dipShare: 0, averageSeconds: 0 },
      motion: { energy: 0.1, staticShare: 0.8 },
      captions: { present: true, band: 'lower', coverage: 0.7 },
      music: { present: true, bedLevel: 0.2 },
      structure: { introSeconds: 0, outroSeconds: 0 },
      caveats: [],
      ...overrides,
    };
  }

  function timeline(clipCount = 2): Sequence {
    let seq = makeSequence('s', 'test');
    const track = trackByRole(seq, 'video')!;
    for (let i = 0; i < clipCount; i += 1) {
      seq = applyCommand(seq, {
        type: 'ADD_CLIP',
        trackId: track.id,
        clip: makeClip({ id: `c${i}`, kind: 'video', assetId: `a${i}`, start: i * 5, duration: 5 }),
      });
    }
    return seq;
  }

  it('moves further towards the reference as intensity rises', () => {
    const sequence = timeline();
    const low = planTemplate({ sequence, profile: profile(), intensity: 'low', currentAggression: 0 });
    const high = planTemplate({ sequence, profile: profile(), intensity: 'high', currentAggression: 0 });
    expect(low.aggression).toBeGreaterThan(0);
    expect(high.aggression).toBeGreaterThan(low.aggression);
    expect(high.aggression).toBeCloseTo(aggressionForShotLength(2), 2);
    expect(low.aggression).toBeCloseTo(aggressionForShotLength(2) * INTENSITY_WEIGHT.low, 2);
  });

  it('keeps hard cuts hard when the reference cuts hard', () => {
    const plan = planTemplate({ sequence: timeline(), profile: profile(), intensity: 'high' });
    expect(plan.smoothing).toBe('audio');
    expect(plan.joinDissolve).toBe(false);
    expect(plan.commands.some((c) => c.type === 'ADD_TRANSITION')).toBe(false);
  });

  it('dissolves when the reference dissolves', () => {
    const plan = planTemplate({
      sequence: timeline(),
      profile: profile({ transitions: { style: 'dissolve', dissolveShare: 0.8, dipShare: 0, averageSeconds: 0.25 } }),
      intensity: 'high',
    });
    expect(plan.smoothing).toBe('dissolve');
    expect(plan.commands.some((c) => c.type === 'ADD_TRANSITION')).toBe(true);
  });

  it('refuses to dip to black mid-sentence, and says why', () => {
    const plan = planTemplate({
      sequence: timeline(),
      profile: profile({ transitions: { style: 'dip', dissolveShare: 0.1, dipShare: 0.8, averageSeconds: 0.25 } }),
      intensity: 'high',
    });
    expect(plan.smoothing).toBe('dissolve');
    expect(plan.skipped.join(' ')).toMatch(/dips through black/i);
  });

  it('restyles captions that exist rather than inventing any', () => {
    const bare = timeline();
    expect(planTemplate({ sequence: bare, profile: profile(), intensity: 'high' }).commands.some(
      (c) => c.type === 'SET_CAPTION_STYLE',
    )).toBe(false);

    const caption = trackByRole(bare, 'caption')!;
    const withCaption = applyCommand(bare, {
      type: 'ADD_CAPTION',
      trackId: caption.id,
      clipId: 'cap1',
      text: 'hello',
      start: 0,
      duration: 2,
    });
    const plan = planTemplate({ sequence: withCaption, profile: profile(), intensity: 'high' });
    expect(plan.commands.some((c) => c.type === 'SET_CAPTION_STYLE')).toBe(true);
  });

  it('never deletes captions the reference happens not to have', () => {
    const caption = trackByRole(timeline(), 'caption')!;
    const withCaption = applyCommand(timeline(), {
      type: 'ADD_CAPTION',
      trackId: caption.id,
      clipId: 'cap1',
      text: 'hello',
      start: 0,
      duration: 2,
    });
    const plan = planTemplate({
      sequence: withCaption,
      profile: profile({ captions: { present: false, band: 'none', coverage: 0 } }),
      intensity: 'high',
    });
    expect(plan.commands.some((c) => c.type === 'DELETE_CLIP')).toBe(false);
    expect(plan.skipped.join(' ')).toMatch(/left alone/i);
  });

  it('mixes music at the measured bed level, ducked by the editor’s own rule', () => {
    const plan = planTemplate({ sequence: timeline(), profile: profile(), intensity: 'high' });
    expect(plan.ducking).not.toBeNull();
    expect(plan.ducking!.bed).toBeCloseTo(0.2, 2);
    expect(plan.ducking!.ducked).toBeLessThan(plan.ducking!.bed);
    expect(plan.skipped.join(' ')).toMatch(/not measurable from a mixed track/i);
  });

  it('always states that none of the reference media is copied', () => {
    const plan = planTemplate({ sequence: timeline(), profile: profile(), intensity: 'low' });
    expect(plan.skipped.join(' ')).toMatch(/none of the reference/i);
  });

  it('treats an intro as content rather than style', () => {
    const plan = planTemplate({
      sequence: timeline(),
      profile: profile({ structure: { introSeconds: 4, outroSeconds: 0 } }),
      intensity: 'high',
    });
    expect(plan.skipped.join(' ')).toMatch(/intro is content/i);
  });
});

describe('describeProfile', () => {
  it('summarises a profile in one line', () => {
    const line = describeProfile(buildProfile('ref.mp4', frames({ count: 80, cutsAt: [16, 32, 48, 64] }), null));
    expect(line).toMatch(/cuts\/min/);
    expect(line).toMatch(/hard cuts/);
  });
});
