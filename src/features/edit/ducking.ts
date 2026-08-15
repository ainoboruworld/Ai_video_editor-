'use client';

/**
 * Ducking the music under speech.
 *
 * The mix rule for a talking-head video is not subtle: the voice has to win.
 * Rather than picking one music level and hoping, the music is keyframed —
 * pulled down while the speaker talks and allowed back up in the gaps, with
 * ramps long enough that the movement is not audible as pumping.
 *
 * The keyframes go on the clip, so the same envelope drives the preview and the
 * exported file: both read `keyframes.volume` through the playback engine's
 * gain graph. There is no separate export-time mix to fall out of sync.
 */
import { mergeRanges, type Range } from '@/features/analysis/audioAnalysis';
import type { Clip, Keyframe } from '@/lib/engine';

export interface DuckingOptions {
  /** Music level with no speech under it. */
  bed: number;
  /** Music level while the speaker is talking. */
  ducked: number;
  /** How fast the music drops when speech starts. */
  attack: number;
  /** How slowly it comes back. Longer than attack, or it sounds like pumping. */
  release: number;
}

/**
 * Speech-safe defaults. A bed at 0.28 and a duck to 0.09 keeps music present
 * without ever competing with a voice.
 */
export const DUCKING_DEFAULTS: DuckingOptions = { bed: 0.28, ducked: 0.09, attack: 0.18, release: 0.5 };

/**
 * Builds the music clip's volume envelope, in clip-local time.
 *
 * Speech ranges arrive in timeline time; they are mapped through the clip's own
 * position and speed, because a music clip trimmed or moved on the timeline
 * still has to duck at the right moments.
 */
export function duckingKeyframes(input: {
  clip: Clip;
  speech: Range[];
  options?: Partial<DuckingOptions>;
}): Keyframe[] {
  const options = { ...DUCKING_DEFAULTS, ...input.options };
  const { clip } = input;
  const localEnd = clip.duration;

  const speech = mergeRanges(
    input.speech
      .map((range) => ({
        start: (range.start - clip.start) / clip.speed,
        end: (range.end - clip.start) / clip.speed,
      }))
      .filter((range) => range.end > 0 && range.start < localEnd)
      .map((range) => ({ start: Math.max(0, range.start), end: Math.min(localEnd, range.end) })),
    // Two phrases a breath apart should stay ducked through the breath rather
    // than swelling for a fifth of a second.
    Math.max(0.4, options.release),
  );

  const points: Keyframe[] = [{ time: 0, value: speech[0]?.start === 0 ? options.ducked : options.bed }];
  const push = (time: number, value: number) => {
    const last = points[points.length - 1];
    if (last && Math.abs(last.time - time) < 0.01) {
      last.value = value;
      return;
    }
    if (time < 0 || time > localEnd) return;
    points.push({ time, value });
  };

  for (const range of speech) {
    push(Math.max(0, range.start - options.attack), options.bed);
    push(range.start, options.ducked);
    push(range.end, options.ducked);
    push(Math.min(localEnd, range.end + options.release), options.bed);
  }

  if (points[points.length - 1]!.time < localEnd) push(localEnd, options.bed);
  return points.sort((a, b) => a.time - b.time);
}

/** True when a clip already carries a ducking envelope. */
export function isDucked(clip: Clip): boolean {
  return (clip.keyframes.volume?.length ?? 0) > 1;
}

/** How far the music moves, for showing the user what was applied. */
export function duckingSummary(keyframes: Keyframe[]): { low: number; high: number; moves: number } {
  const values = keyframes.map((point) => point.value);
  return {
    low: values.length ? Math.min(...values) : 0,
    high: values.length ? Math.max(...values) : 0,
    moves: Math.max(0, keyframes.length - 2),
  };
}
