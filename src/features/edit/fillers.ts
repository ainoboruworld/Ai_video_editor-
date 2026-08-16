/**
 * Filler word detection.
 *
 * The naive version of this feature — regex the transcript, delete every hit —
 * ruins recordings. "Basically" opening a sentence is usually the speaker's
 * actual point; "basically" wedged between two commas is throat-clearing. So
 * every candidate carries the reason it was flagged and a confidence, and
 * nothing is removed until the user says so.
 *
 * The other half of the problem is timing. Cutting text out of a transcript
 * does nothing to the video; a cut needs a real span of the recording. Word
 * timings are used when the transcript has them, otherwise the span is
 * interpolated across the segment and — when the audio has been analysed —
 * snapped to the quiet either side of the word, which turns a guess into
 * something anchored in the recording.
 */
import type { LoudnessEnvelope, Range } from '@/features/analysis/audioAnalysis';
import type { TranscriptSegment, TranscriptWord } from '@/features/transcript/model';

export type FillerConfidence = 'high' | 'medium' | 'low';

export interface FillerCandidate {
  id: string;
  segmentId: string;
  /** The matched text, as it appears in the transcript. */
  word: string;
  start: number;
  end: number;
  /** Character span inside the segment, for highlighting. */
  charStart: number;
  charEnd: number;
  confidence: FillerConfidence;
  reason: string;
  /** True when the span was interpolated rather than measured. */
  estimatedTiming: boolean;
}

/**
 * Sounds, not words. These are hesitation noises in every context, so they are
 * flagged wherever they appear.
 */
const HESITATIONS = [
  'um', 'umm', 'ummm', 'uhm', 'uhmm',
  'uh', 'uhh', 'uhhh',
  'er', 'err', 'erm', 'ehm', 'emm',
  'ah', 'ahh',
  'mm', 'mmm', 'hm', 'hmm',
];

/**
 * Deliberately *not* hesitations: "uh-huh" and "mm-hmm" mean yes, "huh" and
 * "eh" ask a question. Transcribers spell them out of the same sounds as the
 * list above, but they carry meaning and cutting them changes what was said.
 *
 * They are masked out of the search text before anything is matched, because
 * the halves match on their own otherwise — "uh-huh" contains "uh".
 */
const BACKCHANNELS = /\b(?:uh[-\s]?huh|mm[-\s]?hmm|hm[-\s]?hmm|huh|eh)\b/gi;

function maskBackchannels(stripped: string): string {
  return stripped.replace(BACKCHANNELS, (match) => ' '.repeat(match.length));
}

/**
 * Real words that are only fillers in some positions. Each carries the test
 * that decides, so the reason shown to the user is the reason it was flagged.
 */
const CONDITIONAL: { phrase: string; test: (context: WordContext) => { keep: false; reason: string } | null }[] = [
  {
    phrase: 'you know',
    test: (c) =>
      // "you know that…" / "you know how…" is a real clause.
      /^(that|how|what|when|where|why|who|if)\b/i.test(c.after)
        ? null
        : { keep: false, reason: 'Conversational filler' },
  },
  {
    phrase: 'i mean',
    test: (c) => (/^(it|that|this|business|no|yes)\b/i.test(c.after) ? null : { keep: false, reason: 'Restart phrase' }),
  },
  {
    phrase: 'like',
    test: (c) => {
      // "looks like", "feels like", "sounds like", "I like it", "like this" are real.
      if (/\b(look|looks|looked|feel|feels|felt|sound|sounds|sounded|seem|seems|seemed|just|be|is|was|were|are)$/i.test(c.before)) return null;
      if (/^(this|that|these|those|a|an|the|it|him|her|them|you|me)\b/i.test(c.after)) return null;
      if (/\b(i|we|they|you|he|she)$/i.test(c.before)) return null; // "I like", "they like"
      return { keep: false, reason: 'Filler use of "like"' };
    },
  },
  {
    phrase: 'basically',
    test: (c) =>
      // Sentence-initial "Basically, X" is usually the speaker framing a point.
      c.sentenceInitial ? null : { keep: false, reason: 'Mid-sentence hedge' },
  },
  {
    phrase: 'actually',
    test: (c) => (c.sentenceInitial ? null : { keep: false, reason: 'Mid-sentence hedge' }),
  },
  {
    phrase: 'literally',
    test: (c) => (c.sentenceInitial ? null : { keep: false, reason: 'Mid-sentence hedge' }),
  },
  {
    phrase: 'so',
    test: (c) =>
      // "so" opening a segment is a discourse marker; "so that", "so we could"
      // and "so much" are load-bearing.
      c.sentenceInitial && !/^(that|it|we|i|they|you|he|she|much|many|far|long)\b/i.test(c.after)
        ? { keep: false, reason: 'Sentence-opening filler' }
        : null,
  },
  {
    phrase: 'kind of',
    test: (c) => (c.sentenceInitial ? null : { keep: false, reason: 'Hedging phrase' }),
  },
  {
    phrase: 'sort of',
    test: (c) => (c.sentenceInitial ? null : { keep: false, reason: 'Hedging phrase' }),
  },
  {
    phrase: 'right',
    test: (c) =>
      // A trailing "right?" checking the audience is filler; "the right way" is not.
      c.trailing ? { keep: false, reason: 'Trailing tag' } : null,
  },
  {
    phrase: 'okay',
    test: (c) => (c.sentenceInitial && c.after.length > 0 ? { keep: false, reason: 'Sentence-opening filler' } : null),
  },
];

interface WordContext {
  before: string;
  after: string;
  sentenceInitial: boolean;
  trailing: boolean;
}

export interface DetectFillerOptions {
  segments: TranscriptSegment[];
  /** Audio envelope, when the recording has been analysed. Improves timings. */
  envelope?: LoudnessEnvelope | null;
  /** Silences from the same analysis, used to snap estimated spans. */
  silences?: Range[];
}

/** Every filler-shaped hit in the transcript, with the reason it was flagged. */
export function detectFillerCandidates(options: DetectFillerOptions): FillerCandidate[] {
  const out: FillerCandidate[] = [];

  for (const segment of options.segments) {
    const text = segment.text;
    const stripped = maskBackchannels(text.replace(/[^a-z0-9\s']/gi, ' ').toLowerCase());

    for (const match of [...matchesIn(text, stripped), ...stumblesIn(text, stripped)].sort(
      (a, b) => a.charStart - b.charStart,
    )) {
      const context = contextAt(text, match.charStart, match.charEnd);
      const verdict = match.phrase === STUMBLE ? { confidence: 'medium' as const, reason: 'Repeated word' } : classify(match.phrase, context);
      if (!verdict) continue;

      const timing = spanFor(segment, match.charStart, match.charEnd, options);
      if (!timing) continue;

      // Removing this must leave a sentence behind. A segment that is nothing
      // but the filler is handled as a whole-segment cut; a segment reduced to
      // a single dangling word is not worth the cut.
      const remaining = (text.slice(0, match.charStart) + text.slice(match.charEnd)).replace(/\s+/g, ' ').trim();
      const wholeSegment = remaining.replace(/[^a-z0-9]/gi, '').length === 0;

      out.push({
        // Position in the list, not just in the text: an id that can repeat
        // would silently merge two candidates wherever they are held by id.
        id: `fill_${out.length}_${segment.id}_${match.charStart}`,
        segmentId: segment.id,
        word: text.slice(match.charStart, match.charEnd),
        start: timing.start,
        end: timing.end,
        charStart: match.charStart,
        charEnd: match.charEnd,
        confidence: wholeSegment ? 'high' : verdict.confidence,
        reason: wholeSegment ? 'Segment is only this filler' : verdict.reason,
        estimatedTiming: timing.estimated,
      });
    }
  }

  return out.sort((a, b) => a.start - b.start);
}


/** Marks a match as a stutter rather than a word from the filler list. */
const STUMBLE = '\u0000stumble';

/**
 * Immediate word repetitions — "the the", "I I want", "we we should".
 *
 * A stutter is not on any word list; it is a word said twice, and it is one of
 * the commonest things that makes a take sound unrehearsed. Only the *first*
 * copy is offered for removal, so what the speaker went on to say survives
 * intact. One-letter words are skipped ("a a" is far more often a mishearing
 * than a stumble) and so is deliberate emphasis across a comma ("no, no").
 */
function stumblesIn(text: string, stripped: string): { phrase: string; charStart: number; charEnd: number }[] {
  const found: { phrase: string; charStart: number; charEnd: number }[] = [];
  const pattern = /\b([a-z']{2,})(\s+)\1\b/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(stripped)) !== null) {
    const first = match[1]!;
    const gap = match[2]!;
    const between = text.slice(match.index + first.length, match.index + first.length + gap.length);
    // "no, no" and "very, very" are emphasis; punctuation between the two is
    // the speaker meaning it twice.
    if (/[,;:.!?—-]/.test(between)) continue;
    found.push({ phrase: STUMBLE, charStart: match.index, charEnd: match.index + first.length + gap.length });
  }

  return found;
}

/** Finds every filler phrase in a segment, longest phrases first. */
function matchesIn(text: string, stripped: string): { phrase: string; charStart: number; charEnd: number }[] {
  const phrases = [...CONDITIONAL.map((entry) => entry.phrase), ...HESITATIONS].sort((a, b) => b.length - a.length);
  const found: { phrase: string; charStart: number; charEnd: number }[] = [];
  const claimed = new Set<number>();

  for (const phrase of phrases) {
    const pattern = new RegExp(`\\b${phrase.replace(/ /g, '\\s+')}\\b`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(stripped)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      // A longer phrase already covering this text wins ("you know" over "know").
      let overlap = false;
      for (let i = start; i < end; i += 1) if (claimed.has(i)) overlap = true;
      if (overlap) continue;
      for (let i = start; i < end; i += 1) claimed.add(i);
      found.push({ phrase, charStart: start, charEnd: Math.min(end, text.length) });
    }
  }

  return found.sort((a, b) => a.charStart - b.charStart);
}

function classify(phrase: string, context: WordContext): { confidence: FillerConfidence; reason: string } | null {
  if (HESITATIONS.includes(phrase)) {
    return { confidence: 'high', reason: 'Hesitation sound' };
  }
  const rule = CONDITIONAL.find((entry) => entry.phrase === phrase);
  if (!rule) return null;
  const verdict = rule.test(context);
  if (!verdict) return null;
  return { confidence: 'medium', reason: verdict.reason };
}

function contextAt(text: string, charStart: number, charEnd: number): WordContext {
  const before = text.slice(0, charStart).trim();
  const after = text.slice(charEnd).trim().replace(/^[,.:;!?]+\s*/, '');
  return {
    before,
    after,
    // Start of the segment, or straight after sentence-ending punctuation.
    sentenceInitial: before.length === 0 || /[.!?]$/.test(before),
    trailing: after.length === 0 || /^[?.!]$/.test(after),
  };
}

/**
 * The span of recording a filler occupies.
 *
 * Measured word timings are used verbatim. Without them the span is placed by
 * character position inside the segment and then, if the audio has been
 * analysed, pulled out to the quiet on either side — a filler is nearly always
 * bracketed by a breath, so the silence boundaries are a better cut point than
 * the interpolated one.
 *
 * Exported because every transcript-derived cut has the same problem: cutting
 * text does nothing to the video without a real span of recording behind it.
 */
export function spanFor(
  segment: TranscriptSegment,
  charStart: number,
  charEnd: number,
  options: DetectFillerOptions,
): { start: number; end: number; estimated: boolean } | null {
  const measured = measuredSpan(segment, charStart, charEnd);
  if (measured) return { ...measured, estimated: false };

  const length = segment.end - segment.start;
  const chars = Math.max(1, segment.text.length);
  const start = segment.start + (charStart / chars) * length;
  const end = segment.start + (charEnd / chars) * length;
  if (end - start < 0.04) return null;

  const snapped = options.silences ? snapToSilence({ start, end }, options.silences) : { start, end };
  return { ...snapped, estimated: true };
}

/** Uses the transcript's own word timings when it carries them. */
function measuredSpan(
  segment: TranscriptSegment,
  charStart: number,
  charEnd: number,
): { start: number; end: number } | null {
  const words = segment.words;
  if (!words || words.length === 0) return null;

  // Walk the segment text and the word list together, matching by position.
  let cursor = 0;
  const spans: { word: TranscriptWord; charStart: number; charEnd: number }[] = [];
  for (const word of words) {
    const index = segment.text.toLowerCase().indexOf(word.text.toLowerCase().trim(), cursor);
    if (index < 0) continue;
    spans.push({ word, charStart: index, charEnd: index + word.text.trim().length });
    cursor = index + word.text.trim().length;
  }

  const covering = spans.filter((span) => span.charStart < charEnd && charStart < span.charEnd);
  if (covering.length === 0) return null;

  const start = Math.min(...covering.map((span) => span.word.start));
  const end = Math.max(...covering.map((span) => span.word.end));
  return end > start ? { start, end } : null;
}

/**
 * Widens a span out to the quiet around it, so the cut lands between sounds
 * rather than through one. Only nearby silence counts — a filler does not sit
 * seconds away from its own boundary.
 */
export function snapToSilence(span: Range, silences: Range[], tolerance = 0.35): Range {
  let { start, end } = span;
  for (const silence of silences) {
    if (silence.end > start - tolerance && silence.end <= start + tolerance && silence.end < end) {
      start = Math.max(start - tolerance, silence.end);
    }
    if (silence.start >= end - tolerance && silence.start < end + tolerance && silence.start > start) {
      end = Math.min(end + tolerance, silence.start);
    }
  }
  return { start, end };
}

/** The candidates a first pass should arrive pre-ticked. */
export function defaultAccepted(candidates: FillerCandidate[]): Set<string> {
  return new Set(candidates.filter((candidate) => candidate.confidence === 'high').map((candidate) => candidate.id));
}

/** Splits a segment's text into runs so fillers can be highlighted in place. */
export function highlightRuns(
  segment: TranscriptSegment,
  candidates: FillerCandidate[],
): { text: string; candidate: FillerCandidate | null }[] {
  const mine = candidates
    .filter((candidate) => candidate.segmentId === segment.id)
    .sort((a, b) => a.charStart - b.charStart);
  if (mine.length === 0) return [{ text: segment.text, candidate: null }];

  const runs: { text: string; candidate: FillerCandidate | null }[] = [];
  let cursor = 0;
  for (const candidate of mine) {
    if (candidate.charStart > cursor) {
      runs.push({ text: segment.text.slice(cursor, candidate.charStart), candidate: null });
    }
    runs.push({ text: segment.text.slice(candidate.charStart, candidate.charEnd), candidate });
    cursor = candidate.charEnd;
  }
  if (cursor < segment.text.length) runs.push({ text: segment.text.slice(cursor), candidate: null });
  return runs.filter((run) => run.text.length > 0);
}
