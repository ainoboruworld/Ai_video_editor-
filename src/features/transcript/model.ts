/**
 * The transcript model.
 *
 * Whisper in the browser, a hosted Whisper endpoint and a transcript pasted by
 * hand all normalise to the same shape, so nothing downstream — captions, the
 * recut planner, the transcript editor — needs to know where the words came
 * from.
 */
import type { CaptionCue } from '@/types';

/** A single timed word, when the source gave us that resolution. */
export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  /**
   * Present only when the transcript came from a backend that reports word
   * timings. Filler cuts use them when they exist and fall back to interpolating
   * across the segment when they do not — so a pasted transcript still works,
   * it just says its timings are estimates.
   */
  words?: TranscriptWord[];
}

export type TranscriptSource = 'local' | 'hosted' | 'manual';

export interface Transcript {
  segments: TranscriptSegment[];
  source: TranscriptSource;
  /**
   * True when the timings were derived rather than measured — a pasted
   * transcript with no timestamps. The UI says so instead of implying a
   * precision the data does not have.
   */
  estimatedTimings: boolean;
  createdAt: string;
}

export function segmentId(): string {
  return `seg_${Math.random().toString(36).slice(2, 10)}`;
}

/** Sorts, clamps and repairs a segment list so it is always safe to render. */
export function normaliseSegments(segments: TranscriptSegment[], duration?: number): TranscriptSegment[] {
  const limit = duration && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  return segments
    .map((segment) => ({
      ...segment,
      text: segment.text.trim(),
      start: clamp(segment.start, 0, limit),
      end: clamp(segment.end, 0, limit),
    }))
    .filter((segment) => segment.text.length > 0 && segment.end > segment.start)
    .sort((a, b) => a.start - b.start);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/** Caption cues from transcript segments — no second transcription request. */
export function segmentsToCues(segments: TranscriptSegment[], maxWords = 6): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const segment of segments) {
    const words = segment.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    // Long segments become several cues so captions stay readable on screen.
    const groups: string[][] = [];
    for (let i = 0; i < words.length; i += maxWords) groups.push(words.slice(i, i + maxWords));
    const per = (segment.end - segment.start) / groups.length;

    groups.forEach((group, index) => {
      const start = segment.start + index * per;
      const end = index === groups.length - 1 ? segment.end : start + per;
      cues.push({ text: group.join(' '), start, end, words: [] });
    });
  }
  return cues;
}

/** Whisper cues (hosted or local) become segments. */
export function cuesToSegments(cues: CaptionCue[]): TranscriptSegment[] {
  return normaliseSegments(
    cues.map((cue) => ({
      id: segmentId(),
      start: cue.start,
      end: cue.end,
      text: cue.text,
      // Word timings are what let a filler cut hit the actual sound rather than
      // an interpolated position, so they are carried through when present.
      words: cue.words?.length ? cue.words.map((word) => ({ text: word.text, start: word.start, end: word.end })) : undefined,
    })),
  );
}

export function transcriptText(segments: TranscriptSegment[]): string {
  return segments.map((segment) => segment.text).join(' ');
}

export function transcriptDuration(segments: TranscriptSegment[]): number {
  return segments.reduce((end, segment) => Math.max(end, segment.end), 0);
}

/** Formats seconds as mm:ss for the transcript editor. */
export function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/** Parses "mm:ss", "hh:mm:ss" or "mm:ss.mmm" back into seconds. */
export function parseTimestamp(value: string): number | null {
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!match) {
    const plain = Number(value);
    return Number.isFinite(plain) && plain >= 0 ? plain : null;
  }
  const [, hours, minutes, seconds, millis] = match;
  return (
    Number(hours ?? 0) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    (millis ? Number(millis.padEnd(3, '0')) / 1000 : 0)
  );
}
