import { describe, expect, it } from 'vitest';
import {
  detectFillers,
  detectSilences,
  invertRanges,
  mergeRanges,
  speechRanges,
  totalDuration,
  type LoudnessEnvelope,
} from '@/features/analysis/audioAnalysis';
import { cutsToCommands, planFromKeepRanges, planTightenToTarget, sourceToTimeline } from '@/features/ai/autoEdit';
import { applyCommand, makeClip, makeSequence, sequenceDuration, trackByRole } from '@/lib/engine';

/** Builds an envelope from a loudness pattern, one value per 100ms. */
function envelope(values: number[], windowSeconds = 0.1): LoudnessEnvelope {
  return {
    values: Float32Array.from(values),
    windowSeconds,
    duration: values.length * windowSeconds,
    peak: Math.max(...values),
  };
}

describe('detectSilences', () => {
  it('finds quiet stretches longer than the minimum', () => {
    // 1s loud, 1s silent, 1s loud
    const env = envelope([...Array(10).fill(1), ...Array(10).fill(0), ...Array(10).fill(1)]);
    const silences = detectSilences(env, { minSilenceSeconds: 0.4, paddingSeconds: 0 });
    expect(silences).toHaveLength(1);
    expect(silences[0]!.start).toBeCloseTo(1, 1);
    expect(silences[0]!.end).toBeCloseTo(2, 1);
  });

  it('ignores short natural gaps between words', () => {
    const env = envelope([...Array(10).fill(1), 0, 0, ...Array(10).fill(1)]);
    expect(detectSilences(env, { minSilenceSeconds: 0.4 })).toHaveLength(0);
  });

  it('scales the threshold to a quietly recorded source', () => {
    const quiet = envelope([...Array(10).fill(0.02), ...Array(10).fill(0), ...Array(10).fill(0.02)]);
    expect(detectSilences(quiet, { minSilenceSeconds: 0.4, paddingSeconds: 0 })).toHaveLength(1);
  });

  it('leaves padding so cuts do not clip speech', () => {
    const env = envelope([...Array(10).fill(1), ...Array(10).fill(0), ...Array(10).fill(1)]);
    const [silence] = detectSilences(env, { minSilenceSeconds: 0.4, paddingSeconds: 0.2 });
    expect(silence!.start).toBeGreaterThan(1);
    expect(silence!.end).toBeLessThan(2);
  });
});

describe('speechRanges', () => {
  it('returns the complement of the silences', () => {
    const env = envelope([...Array(10).fill(1), ...Array(10).fill(0), ...Array(10).fill(1)]);
    const silences = detectSilences(env, { minSilenceSeconds: 0.4, paddingSeconds: 0 });
    const speech = speechRanges(env, silences);
    expect(speech).toHaveLength(2);
    expect(speech[0]!.start).toBe(0);
    expect(speech[1]!.end).toBeCloseTo(3, 1);
  });
});

describe('mergeRanges / invertRanges', () => {
  it('merges touching ranges', () => {
    expect(mergeRanges([{ start: 0, end: 1 }, { start: 1.01, end: 2 }])).toEqual([{ start: 0, end: 2 }]);
  });

  it('inverts keep-ranges into cuts', () => {
    const cuts = invertRanges([{ start: 2, end: 4 }, { start: 6, end: 8 }], 10);
    expect(cuts).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 6 },
      { start: 8, end: 10 },
    ]);
  });

  it('returns no cuts when everything is kept', () => {
    expect(invertRanges([{ start: 0, end: 5 }], 5)).toHaveLength(0);
  });
});

describe('detectFillers', () => {
  it('finds single-word and phrase fillers', () => {
    const words = [
      { text: 'So', start: 0, end: 0.3 },
      { text: 'um', start: 0.4, end: 0.6 },
      { text: 'you', start: 0.7, end: 0.9 },
      { text: 'know', start: 0.9, end: 1.1 },
      { text: 'today', start: 1.2, end: 1.6 },
    ];
    const found = detectFillers(words);
    expect(found).toHaveLength(2);
    expect(found[0]!.start).toBeCloseTo(0.4, 2);
    expect(found[1]!.end).toBeCloseTo(1.1, 2);
  });

  it('ignores ordinary speech', () => {
    expect(detectFillers([{ text: 'hello', start: 0, end: 1 }])).toHaveLength(0);
  });
});

describe('sourceToTimeline', () => {
  const clip = makeClip({ id: 'c', kind: 'video', start: 10, duration: 20, sourceIn: 5, speed: 1 });

  it('maps source time onto the timeline', () => {
    expect(sourceToTimeline(clip, { start: 5, end: 7 })).toEqual({ start: 10, end: 12 });
  });

  it('clips ranges to the trimmed portion of the source', () => {
    expect(sourceToTimeline(clip, { start: 0, end: 6 })).toEqual({ start: 10, end: 11 });
    expect(sourceToTimeline(clip, { start: 0, end: 4 })).toBeNull();
  });

  it('accounts for playback speed', () => {
    const fast = makeClip({ id: 'f', kind: 'video', start: 0, duration: 10, sourceIn: 0, speed: 2 });
    expect(sourceToTimeline(fast, { start: 0, end: 4 })).toEqual({ start: 0, end: 2 });
  });
});

describe('cutsToCommands', () => {
  it('cuts back-to-front so earlier timestamps stay valid', () => {
    const commands = cutsToCommands([{ start: 1, end: 2 }, { start: 5, end: 6 }]);
    expect(commands.map((c) => (c as { start: number }).start)).toEqual([5, 1]);
    expect(commands.every((c) => (c as { ripple: boolean }).ripple)).toBe(true);
  });

  it('actually shortens a sequence when applied', () => {
    let sequence = makeSequence('s', 'test', '16:9');
    const track = trackByRole(sequence, 'video')!;
    sequence = applyCommand(sequence, {
      type: 'ADD_CLIP',
      trackId: track.id,
      clip: makeClip({ id: 'v', kind: 'video', start: 0, duration: 10, assetId: 'a' }),
    });
    expect(sequenceDuration(sequence)).toBe(10);

    for (const command of cutsToCommands([{ start: 2, end: 4 }, { start: 6, end: 7 }])) {
      sequence = applyCommand(sequence, command);
    }
    // 3 seconds removed from a 10-second clip.
    expect(sequenceDuration(sequence)).toBeCloseTo(7, 5);
  });
});

describe('planFromKeepRanges', () => {
  it('turns an AI keep-list into the cuts that produce it', () => {
    const clip = makeClip({ id: 'c', kind: 'video', start: 0, duration: 60, sourceIn: 0, speed: 1 });
    const plan = planFromKeepRanges([{ start: 10, end: 20 }, { start: 40, end: 50 }], clip, 60);
    expect(totalDuration(plan.cuts)).toBeCloseTo(40, 5);
    expect(plan.cuts).toHaveLength(3);
  });
});

describe('planTightenToTarget', () => {
  const clip = makeClip({ id: 'c', kind: 'video', start: 0, duration: 60, sourceIn: 0, speed: 1 });
  const analysis = {
    envelope: { values: Float32Array.from([]), windowSeconds: 0.1, duration: 60, peak: 1 },
    silences: [
      { start: 5, end: 7 },   // 2s
      { start: 20, end: 28 }, // 8s — longest
      { start: 40, end: 44 }, // 4s
    ],
    speech: [],
    removableSeconds: 14,
  };

  it('cuts the longest pauses first and stops once the target is met', () => {
    const plan = planTightenToTarget(analysis, clip, 60, 50);
    // Needs 10s: takes the 8s pause, then the 4s one.
    expect(totalDuration(plan.cuts)).toBeCloseTo(12, 5);
    expect(plan.cuts.some((cut) => cut.start === 20)).toBe(true);
    expect(plan.cuts.some((cut) => cut.start === 5)).toBe(false);
  });

  it('does nothing when already under the target', () => {
    expect(planTightenToTarget(analysis, clip, 60, 90).cuts).toHaveLength(0);
  });

  it('removes every pause it has when the target is unreachable', () => {
    const plan = planTightenToTarget(analysis, clip, 60, 5);
    expect(totalDuration(plan.cuts)).toBeCloseTo(14, 5);
  });
});
