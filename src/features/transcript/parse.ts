/**
 * Parsing a pasted transcript.
 *
 * People paste whatever their tool gave them — a range per block, a single
 * leading timestamp per line, an SRT/VTT export, or plain prose with no times
 * at all. All of those are accepted. What is never done is inventing precision:
 * when a paste has no timings, the segments are spread evenly and the result is
 * flagged `estimatedTimings` so the UI can say so.
 */
import { normaliseSegments, parseTimestamp, segmentId, type TranscriptSegment } from './model';

export interface ParseResult {
  segments: TranscriptSegment[];
  estimatedTimings: boolean;
  /** Human-readable note about what was detected, shown after importing. */
  note: string;
  /** Segments discarded because they fell outside the video's duration. */
  droppedOutsideVideo: number;
}

const TIME = String.raw`\d{1,2}:\d{1,2}(?::\d{1,2})?(?:[.,]\d{1,3})?`;
/** `00:00 - 00:04`, `00:00 –> 00:04`, `[00:00 - 00:04]`, SRT's `-->` form. */
const RANGE = new RegExp(String.raw`^\[?\s*(${TIME})\s*(?:-{1,2}>?|–|—|to)\s*(${TIME})\s*\]?\s*$`);
/**
 * The same range with the line's text after it: `[00:46 - 00:47] "Uh,"`.
 *
 * Common enough to matter — several transcription tools emit exactly this — and
 * without it the leading-timestamp rule half-matches, leaving `00:47] "` sitting
 * in the transcript text and throwing the real end time away.
 */
const RANGE_INLINE = new RegExp(
  // The lookahead stops the timestamp being backtracked into: without it,
  // SRT's `00:00:04,000` gives up its last digit to satisfy the text group.
  // The text must also be separated by a bracket or whitespace, so a bare
  // range on its own line stays a block header.
  String.raw`^\[?\s*(${TIME})\s*(?:-{1,2}>?|–|—|to)\s*(${TIME})(?![\d.,:])\s*(?:\]\s*|\s+)[-–—:]?\s*(\S.*)$`,
);
/** A single leading timestamp: `00:04 Today we…` or `[00:04] Today we…` */
const LEADING = /^\[?\s*(\d{1,2}:\d{1,2}(?::\d{1,2})?(?:[.,]\d{1,3})?)\s*\]?\s*[-–—:]?\s*(.*)$/;
/** A bare SRT sequence number on its own line. */
const SEQUENCE = /^\d+$/;

/**
 * @param raw       Whatever the user pasted.
 * @param duration  The video's duration, used to spread untimed transcripts and
 *                  to clamp timings that overrun the footage.
 */
export function parseTranscript(raw: string, duration?: number): ParseResult {
  const lines = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim());

  const inline = parseRangeInline(lines);
  if (inline.length > 0) {
    return withNote(inline, duration, false, (kept) => `Imported ${kept} timed segments.`);
  }

  const ranged = parseRanged(lines);
  if (ranged.length > 0) {
    return withNote(ranged, duration, false, (kept) => `Imported ${kept} timed segments.`);
  }

  const leading = parseLeading(lines, duration);
  if (leading.length > 0) {
    return withNote(
      leading,
      duration,
      false,
      (kept) => `Imported ${kept} segments from single timestamps; each one runs until the next.`,
    );
  }

  const plain = parsePlain(lines, duration);
  if (plain.length === 0) {
    return { segments: [], estimatedTimings: false, note: 'Nothing to import — the text was empty.', droppedOutsideVideo: 0 };
  }
  return withNote(
    plain,
    duration,
    true,
    (kept) =>
      `Imported ${kept} segments. No timestamps found, so timings are estimated${
        duration ? ' across the video length' : ''
      } — adjust them below or re-paste with timestamps.`,
  );
}

/**
 * Normalises against the footage and reports anything that fell outside it, so
 * a transcript pasted for a longer cut does not quietly lose its tail.
 */
function withNote(
  parsed: TranscriptSegment[],
  duration: number | undefined,
  estimated: boolean,
  describe: (kept: number) => string,
): ParseResult {
  const segments = normaliseSegments(parsed, duration);
  const dropped = parsed.length - segments.length;
  const note = dropped > 0
    ? `${describe(segments.length)} ${dropped} segment${dropped === 1 ? '' : 's'} fell outside the video's ${
        duration ? `${Math.round(duration)}s` : ''
      } length and ${dropped === 1 ? 'was' : 'were'} dropped.`
    : describe(segments.length);

  return { segments, estimatedTimings: estimated, note, droppedOutsideVideo: dropped };
}

/** One segment per line: a start–end range followed by that segment's text. */
function parseRangeInline(lines: string[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  for (const line of lines) {
    if (!line || SEQUENCE.test(line)) continue;
    const match = line.match(RANGE_INLINE);
    if (!match) continue;
    const start = parseTimestamp(match[1]!);
    const end = parseTimestamp(match[2]!);
    const text = stripWrappingQuotes((match[3] ?? '').trim());
    if (start === null || end === null || text.length === 0) continue;
    segments.push({ id: segmentId(), start, end, text });
  }

  // A single hit is more likely a stray line inside prose than a timed transcript.
  return segments.length >= 2 ? segments : [];
}

/**
 * Transcription tools often wrap each line in quotes. They are punctuation about
 * the transcript rather than words in it, and leaving them in shifts every
 * character offset the filler highlighter works with.
 */
function stripWrappingQuotes(text: string): string {
  const trimmed = text.trim();
  const quoted = /^["\u201C\u201D\u2018\u2019']([\s\S]*)["\u201C\u201D\u2018\u2019']$/.exec(trimmed);
  return quoted ? quoted[1]!.trim() : trimmed;
}

/** Blocks introduced by a start–end range, with the text on following lines. */
function parseRanged(lines: string[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: { start: number; end: number; text: string[] } | null = null;

  for (const line of lines) {
    const match = line.match(RANGE);
    if (match) {
      if (current) segments.push(toSegment(current));
      const start = parseTimestamp(match[1]!);
      const end = parseTimestamp(match[2]!);
      current = start === null || end === null ? null : { start, end, text: [] };
      continue;
    }
    if (!line || SEQUENCE.test(line)) continue;
    if (current) current.text.push(line);
  }
  if (current) segments.push(toSegment(current));

  return segments.filter((segment) => segment.text.length > 0);
}

/** Lines that start with one timestamp; each runs until the next one begins. */
function parseLeading(lines: string[], duration?: number): TranscriptSegment[] {
  const found: { start: number; text: string }[] = [];

  for (const line of lines) {
    if (!line || SEQUENCE.test(line)) continue;
    const match = line.match(LEADING);
    if (!match) continue;
    const start = parseTimestamp(match[1]!);
    const text = stripWrappingQuotes((match[2] ?? '').trim());
    if (start === null || text.length === 0) continue;
    found.push({ start, text });
  }

  // One stray timestamp in a prose paste is not a timed transcript.
  if (found.length < 2) return [];

  return found.map((entry, index) => ({
    id: segmentId(),
    start: entry.start,
    end: found[index + 1]?.start ?? fallbackEnd(entry.start, duration),
    text: entry.text,
  }));
}

function fallbackEnd(start: number, duration?: number): number {
  if (duration && duration > start) return duration;
  // Roughly a sentence's worth, rather than a made-up precise value.
  return start + 4;
}

/**
 * Plain prose. Split on blank-line paragraphs when present, otherwise on
 * sentences, then spread across the footage. Timings are declared estimated.
 */
function parsePlain(lines: string[], duration?: number): TranscriptSegment[] {
  const text = lines.join('\n').trim();
  if (!text) return [];

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const chunks =
    paragraphs.length > 1
      ? paragraphs
      : lines.filter(Boolean).length > 1
        ? lines.filter(Boolean)
        : splitSentences(text);

  if (chunks.length === 0) return [];

  // Spread by word count, so a long sentence gets proportionally more time
  // than a short one instead of every chunk getting an identical slice.
  const weights = chunks.map((chunk) => Math.max(1, chunk.split(/\s+/).filter(Boolean).length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const total = duration && duration > 0 ? duration : totalWeight / 2.6;

  let cursor = 0;
  return chunks.map((chunk, index) => {
    const span = (weights[index]! / totalWeight) * total;
    const segment = { id: segmentId(), start: round(cursor), end: round(cursor + span), text: chunk };
    cursor += span;
    return segment;
  });
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function toSegment(entry: { start: number; end: number; text: string[] }): TranscriptSegment {
  return {
    id: segmentId(),
    start: entry.start,
    end: entry.end,
    text: entry.text.join(' ').replace(/\s+/g, ' ').trim(),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
