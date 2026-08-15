/**
 * Pause trimming.
 *
 * Two things separate this from "delete every silence". First, only pauses past
 * a threshold are touched at all — the small gaps between clauses are what make
 * speech sound like speech. Second, a pause that is cut is *shortened*, not
 * removed: a beat is left behind so the speaker still breathes. Closing every
 * gap to zero is exactly what makes auto-edited video sound robotic.
 */
import { mergeRanges, type Range } from '@/features/analysis/audioAnalysis';

export interface PauseCut extends Range {
  /** Length of the original pause this came from. */
  pauseSeconds: number;
  /** What is left of it afterwards. */
  keptSeconds: number;
}

/**
 * 0 keeps the pacing conversational, 1 tightens as far as this will go.
 * The default sits near the bottom on purpose: the spec asks for conservative,
 * and an over-tight first result is what makes people distrust the feature.
 */
export const DEFAULT_AGGRESSION = 0.25;

interface Profile {
  /** Pauses shorter than this are never touched. */
  threshold: number;
  /** How much silence to leave behind. */
  keep: number;
}

/** Maps the slider to real seconds. Natural at 0, tight at 1. */
export function pauseProfile(aggression: number): Profile {
  const t = Math.max(0, Math.min(1, aggression));
  return {
    threshold: lerp(2.0, 0.28, t),
    keep: lerp(0.45, 0.08, t),
  };
}

export function describeAggression(aggression: number): string {
  const { threshold, keep } = pauseProfile(aggression);
  return `Cuts pauses over ${threshold.toFixed(2)}s, leaving ${keep.toFixed(2)}s`;
}

/**
 * Turns detected silences into the spans that should actually be removed.
 *
 * Silence at the very start or end of the recording is head/tail trim rather
 * than a pause between sentences, so it is left to the user.
 */
export function pauseCuts(input: {
  silences: Range[];
  duration: number;
  aggression?: number;
  /** Silence touching either end within this many seconds is treated as head/tail. */
  edgeSeconds?: number;
}): PauseCut[] {
  const { threshold, keep } = pauseProfile(input.aggression ?? DEFAULT_AGGRESSION);
  const edge = input.edgeSeconds ?? 0.4;
  const cuts: PauseCut[] = [];

  for (const silence of mergeRanges(input.silences)) {
    const length = silence.end - silence.start;
    if (length < threshold) continue;
    if (silence.start <= edge || silence.end >= input.duration - edge) continue;

    const removable = length - keep;
    if (removable < 0.06) continue;

    // Take the cut out of the middle so the tail of the previous phrase and the
    // start of the next both keep a little air around them.
    const centre = (silence.start + silence.end) / 2;
    cuts.push({
      start: centre - removable / 2,
      end: centre + removable / 2,
      pauseSeconds: length,
      keptSeconds: keep,
    });
  }

  return cuts;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
