/**
 * Swallowing the scraps between two cuts that land close together.
 *
 * Two cuts a fraction of a second apart leave a sliver of footage between them.
 * A quarter-second fragment is not a shot — it is a flash of a frame or two
 * that reads as a glitch, and it costs *two* joins instead of one. A human
 * editor faced with the same choice runs the cut straight through it.
 *
 * The judgement here is the one the request asks for: cut the bit in between
 * too, **when the phrase in it is not needed**. That qualifier is the whole
 * feature. A 0.1s sliver holds nothing, so it always goes. Half a second can
 * hold a real word, so it only goes when the words in it turn out to be
 * disposable — a stray filler, a fragment of a word, a lone article left
 * stranded by the cuts either side. Anything that carries meaning survives, and
 * the two cuts stay two cuts.
 *
 * Everything swallowed is reported, because silently removing speech the user
 * did not tick is exactly the behaviour that makes an editor stop trusting a
 * tool.
 */
import { mergeRanges, type Range } from '@/features/analysis/audioAnalysis';
import type { TranscriptSegment } from '@/features/transcript/model';

export interface CoalesceOptions {
  cuts: Range[];
  /** Used to read what is actually in a fragment before deciding. */
  segments?: TranscriptSegment[];
  /** Fragments shorter than this hold nothing and always go. */
  minFragment?: number;
  /** Beyond this the gap is real footage and is never bridged. */
  maxBridge?: number;
}

export interface Swallowed {
  start: number;
  end: number;
  seconds: number;
  /** What was in it, as the transcript reads it. Empty when nothing was. */
  text: string;
  reason: string;
}

export interface CoalesceResult {
  cuts: Range[];
  swallowed: Swallowed[];
}

/** Under this, no word fits — it is a frame or two of flash. */
const MIN_FRAGMENT = 0.25;
/** Over this, the gap is a phrase, and phrases are the user's to decide about. */
const MAX_BRIDGE = 0.6;

/**
 * Words that carry no meaning on their own.
 *
 * Stranded between two cuts, each of these is a leftover rather than content —
 * "and", "so", "the" surviving alone between two removals is the grammar of a
 * sentence that no longer exists.
 */
const DISPOSABLE = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'so', 'then', 'well', 'okay', 'ok', 'right', 'now', 'just',
  'like', 'yeah', 'yes', 'no', 'oh', 'ah', 'um', 'umm', 'uh', 'uhh', 'er', 'erm', 'hmm', 'mm',
  'is', 'was', 'it', 'i', 'we', 'you', 'that', 'this', 'to', 'of', 'in', 'on', 'at', 'for',
]);

/**
 * Merges cuts separated by a fragment not worth keeping.
 *
 * Runs after `mergeRanges`, which handles cuts that actually overlap; this
 * handles the ones that nearly do.
 */
export function coalesceCuts(options: CoalesceOptions): CoalesceResult {
  const minFragment = options.minFragment ?? MIN_FRAGMENT;
  const maxBridge = options.maxBridge ?? MAX_BRIDGE;
  const sorted = mergeRanges(options.cuts).sort((a, b) => a.start - b.start);
  if (sorted.length < 2) return { cuts: sorted, swallowed: [] };

  const cuts: Range[] = [];
  const swallowed: Swallowed[] = [];
  let current = { ...sorted[0]! };

  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i]!;
    const gap = next.start - current.end;
    const verdict = judgeFragment(gap, current.end, next.start, minFragment, maxBridge, options.segments ?? []);

    if (verdict) {
      swallowed.push({ start: current.end, end: next.start, seconds: round(gap), ...verdict });
      current = { start: current.start, end: next.end };
      continue;
    }

    cuts.push(current);
    current = { ...next };
  }
  cuts.push(current);

  return { cuts, swallowed };
}

/** Whether this fragment should be swallowed, and the reason to show. */
function judgeFragment(
  gap: number,
  start: number,
  end: number,
  minFragment: number,
  maxBridge: number,
  segments: TranscriptSegment[],
): { text: string; reason: string } | null {
  if (gap <= 0) return { text: '', reason: 'The two cuts already meet.' };
  if (gap > maxBridge) return null;

  const text = textBetween(segments, start, end);

  if (gap < minFragment) {
    // Too short to be a shot at all. Nothing that fits here is worth two joins.
    return {
      text,
      reason: `Only ${Math.round(gap * 1000)}ms survives between these cuts — too brief to read as anything but a flash.`,
    };
  }

  // Long enough to hold a word, so what the word is decides it.
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return { text, reason: 'Nothing is said in the gap between these two cuts.' };
  }
  if (words.every((word) => DISPOSABLE.has(word))) {
    return {
      text,
      reason: `Only “${text.trim()}” survives between the cuts, which carries nothing on its own.`,
    };
  }

  // Real words. Two cuts stay two cuts.
  return null;
}

/**
 * The transcript text falling inside a span.
 *
 * Word timings are used when the transcript carries them. Without them the
 * position is interpolated across the segment by character, which is the same
 * approximation filler detection uses — good enough to tell "and" from a
 * clause, which is all this decision needs.
 */
export function textBetween(segments: TranscriptSegment[], start: number, end: number): string {
  const parts: string[] = [];

  for (const segment of segments) {
    if (segment.end <= start || segment.start >= end) continue;

    const words = segment.words ?? [];
    if (words.length > 0) {
      const inside = words.filter((word) => word.end > start && word.start < end).map((word) => word.text);
      if (inside.length > 0) parts.push(inside.join(' '));
      continue;
    }

    const length = segment.end - segment.start;
    if (length <= 0) continue;
    const chars = segment.text.length;
    const from = Math.max(0, Math.floor(((start - segment.start) / length) * chars));
    const to = Math.min(chars, Math.ceil(((end - segment.start) / length) * chars));
    const slice = segment.text.slice(from, to).trim();
    if (slice) parts.push(slice);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
