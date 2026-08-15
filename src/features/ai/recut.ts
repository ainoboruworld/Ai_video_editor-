'use client';

/**
 * Recut proposals.
 *
 * Two producers — the AI planner and a local "Smart Auto-Cut" that uses only the
 * transcript and the silence map — emit the same proposal shape, so the review
 * UI and the apply path are identical. Nothing here touches the timeline: a
 * proposal is data the user approves or discards.
 */
import { detectFillers, mergeRanges, totalDuration, type Range } from '@/features/analysis/audioAnalysis';
import { transcriptText, type TranscriptSegment } from '@/features/transcript/model';
import type { AnalysisResult } from '@/features/ai/autoEdit';

export interface RecutSpan {
  start: number;
  end: number;
  reason: string;
}

export interface RecutProposal {
  /** Where the proposal came from, so the UI never calls a local heuristic "AI". */
  origin: 'ai' | 'smart';
  summary: string;
  keep: RecutSpan[];
  remove: RecutSpan[];
  /** Seconds the proposal would remove. */
  removedSeconds: number;
  /** Length after applying. */
  resultSeconds: number;
}

/** Fillers that make a whole short segment worth dropping. */
const FILLER_SEGMENT = /^(?:so|um|uh|okay|ok|right|yeah|and|but|like|anyway|erm)[\s,.!?]*$/i;
const HEDGE = /\b(?:so basically|what i wanted to say was|i mean|you know|kind of|sort of)\b/i;

/**
 * Builds a proposal from an AI response. The model returns what to keep; the
 * gaps between those spans are what gets removed, so keep and remove always
 * describe the same edit even if the model omitted one side.
 */
export function proposalFromAi(
  keep: RecutSpan[],
  remove: RecutSpan[],
  duration: number,
  summary: string,
): RecutProposal {
  const keptSpans = mergeSpans(keep);
  const derivedRemoves = invertSpans(keptSpans, duration);

  // Prefer the model's own reasons where they line up with a real gap.
  const removes = derivedRemoves.map((gap) => ({
    ...gap,
    reason: remove.find((entry) => overlaps(entry, gap))?.reason || gap.reason,
  }));

  const removedSeconds = totalDuration(removes);
  return {
    origin: 'ai',
    summary,
    keep: keptSpans,
    remove: removes,
    removedSeconds,
    resultSeconds: Math.max(0, duration - removedSeconds),
  };
}

/**
 * Smart Auto-Cut: no model involved.
 *
 * It removes what can be identified mechanically — silence between speech,
 * segments that are nothing but a filler word, and obvious hedging phrases —
 * and keeps everything else. Deliberately conservative: it would rather leave
 * something in than cut a real sentence.
 */
export function smartAutoCut(input: {
  segments: TranscriptSegment[];
  analysis?: AnalysisResult | null;
  duration: number;
  minSegmentSeconds?: number;
}): RecutProposal {
  const { segments, analysis, duration } = input;
  const minSegment = input.minSegmentSeconds ?? 0.6;
  const removes: RecutSpan[] = [];

  for (const segment of segments) {
    const text = segment.text.trim();
    const length = segment.end - segment.start;

    if (FILLER_SEGMENT.test(text)) {
      removes.push({ start: segment.start, end: segment.end, reason: `Filler only ("${text}")` });
      continue;
    }
    if (length < minSegment && text.split(/\s+/).length <= 2) {
      removes.push({ start: segment.start, end: segment.end, reason: 'Very short fragment' });
      continue;
    }
    if (HEDGE.test(text) && text.split(/\s+/).length <= 8) {
      removes.push({ start: segment.start, end: segment.end, reason: 'Hedging phrase' });
    }
  }

  // Silence between speech, from the audio analysis when it is available.
  if (analysis) {
    for (const silence of analysis.silences) {
      if (silence.end - silence.start >= 0.6) {
        removes.push({ start: silence.start, end: silence.end, reason: 'Long pause' });
      }
    }
  }

  // Filler words inside otherwise good segments, when word timings exist.
  const words = segments.flatMap((segment) =>
    segment.text.split(/\s+/).length === 1
      ? [{ text: segment.text, start: segment.start, end: segment.end }]
      : [],
  );
  for (const filler of detectFillers(words)) {
    removes.push({ start: filler.start, end: filler.end, reason: 'Filler word' });
  }

  const merged = mergeSpans(removes);
  const keep = invertSpans(merged, duration).map((span) => ({ ...span, reason: 'Speech' }));
  const removedSeconds = totalDuration(merged);

  return {
    origin: 'smart',
    summary:
      merged.length === 0
        ? 'Nothing obvious to cut — no long pauses or filler-only segments were found.'
        : `Found ${merged.length} sections to cut: long pauses, filler-only segments and short fragments.`,
    keep,
    remove: merged,
    removedSeconds,
    resultSeconds: Math.max(0, duration - removedSeconds),
  };
}

/** Merges overlapping spans, keeping the first reason for each merged block. */
export function mergeSpans(spans: RecutSpan[]): RecutSpan[] {
  const sorted = [...spans].filter((span) => span.end > span.start).sort((a, b) => a.start - b.start);
  const out: RecutSpan[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span.start - last.end <= 0.02) {
      last.end = Math.max(last.end, span.end);
    } else {
      out.push({ ...span });
    }
  }
  return out;
}

/** The complement of a set of spans across [0, duration]. */
export function invertSpans(spans: RecutSpan[], duration: number, reason = 'Cut'): RecutSpan[] {
  const merged = mergeSpans(spans);
  const out: RecutSpan[] = [];
  let cursor = 0;
  for (const span of merged) {
    if (span.start - cursor > 0.05) out.push({ start: cursor, end: span.start, reason });
    cursor = Math.max(cursor, span.end);
  }
  if (duration - cursor > 0.05) out.push({ start: cursor, end: duration, reason });
  return out;
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Ranges for the cutter, in source time. */
export function proposalCuts(proposal: RecutProposal): Range[] {
  return mergeRanges(proposal.remove.map((span) => ({ start: span.start, end: span.end })));
}
