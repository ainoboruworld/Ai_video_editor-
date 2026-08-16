/**
 * Unnecessary line detection.
 *
 * Filler detection handles sounds and hedge words. This handles the larger
 * mistakes a speaker makes in a take: saying the same sentence twice, starting
 * a sentence and abandoning it, correcting themselves out loud, wandering off
 * the point, and restating something already said.
 *
 * Three rules shape all of it:
 *
 * 1. **Nothing is decided by word matching alone.** "Sorry" is a correction
 *    when it precedes a restart and an apology when it does not; a repeated
 *    sentence is a retake when the copies are adjacent and a deliberate recap
 *    when they are a minute apart. Every detector here looks at position and
 *    surroundings, not just the words.
 * 2. **Uncertainty becomes REVIEW, never REMOVE.** Rambling, redundancy and
 *    off-topic runs are judgement calls about someone's meaning, so they are
 *    always offered for a decision and never pre-ticked.
 * 3. **Every cut is a real span of recording.** Text removed from a transcript
 *    does nothing to the video, so each candidate carries measured timings when
 *    the transcript has them and an interpolated span, marked as estimated,
 *    when it does not.
 */
import type { Range } from '@/features/analysis/audioAnalysis';
import type { TranscriptSegment } from '@/features/transcript/model';
import { spanFor } from './fillers';

export type CutKind =
  | 'repeated-sentence'
  | 'false-start'
  | 'correction'
  | 'rambling'
  | 'redundant'
  | 'off-topic';

/** REMOVE is pre-ticked; REVIEW is offered but never assumed. */
export type CutVerdict = 'remove' | 'review';
export type CutConfidence = 'high' | 'medium' | 'low';

export interface SmartCut {
  id: string;
  kind: CutKind;
  verdict: CutVerdict;
  confidence: CutConfidence;
  start: number;
  end: number;
  /** Exactly what would be cut, as it reads in the transcript. */
  text: string;
  /** Why, in a sentence the user can agree or disagree with. */
  reason: string;
  segmentIds: string[];
  /** True when the span was interpolated rather than measured. */
  estimatedTiming: boolean;
}

export interface SmartCutOptions {
  segments: TranscriptSegment[];
  /** Silences from the audio analysis; they make estimated spans much better. */
  silences?: Range[];
}

export const CUT_KIND_LABELS: Record<CutKind, string> = {
  'repeated-sentence': 'Repeated',
  'false-start': 'False start',
  correction: 'Correction',
  rambling: 'Rambling',
  redundant: 'Redundant',
  'off-topic': 'Off topic',
};

/**
 * The speaker announcing that the previous attempt did not count.
 *
 * Split by how unambiguous each one is. "Let me start again" means exactly one
 * thing. "Sorry" on its own is often part of the content ("sorry to say"), so
 * it only counts when a restart follows it.
 */
const EXPLICIT_RESTART =
  /\b(?:let me (?:start|try|do|say|take) (?:that )?(?:again|over|one more time)|start(?:ing)? again|scratch that|take (?:two|three|four)|from the top|redo that|let me rephrase|strike that)\b/i;
const SOFT_RESTART = /\b(?:sorry|sorry,|oops|wait|hold on|hang on|no wait|that's not right|that's wrong|i misspoke)\b/i;

/** The speaker marking their own tangent as over. */
const TANGENT_END =
  /\b(?:anyway|anyways|but anyway|getting back to|back to (?:the point|what i was saying)|where was i|as i was saying|long story short)\b/i;
/** The speaker marking a tangent as beginning. */
const TANGENT_START = /\b(?:side note|sidenote|by the way|off topic|tangent|random(?:ly)?,|unrelated,|quick aside)\b/i;

const STOPWORDS = new Set([
  'the','a','an','and','or','but','if','then','than','that','this','these','those','is','are','was','were','be',
  'been','being','have','has','had','do','does','did','will','would','can','could','should','may','might','must',
  'i','you','he','she','it','we','they','me','him','her','us','them','my','your','his','its','our','their','of',
  'in','on','at','to','for','with','from','by','about','as','into','over','after','before','so','just','very',
  'really','like','know','think','going','get','got','one','not','no','yes','what','when','where','why','how',
  'there','here','out','up','down','all','some','any','more','most','other','because','well','okay','ok','right',
]);

/** Everything worth offering, in timeline order, deduplicated by span. */
export function detectSmartCuts(options: SmartCutOptions): SmartCut[] {
  const segments = options.segments.filter((segment) => segment.text.trim().length > 0);
  if (segments.length === 0) return [];

  const found: SmartCut[] = [
    ...repeatedSentences(segments, options),
    ...falseStarts(segments, options),
    ...corrections(segments, options),
    ...redundant(segments, options),
    ...rambling(segments, options),
    ...offTopic(segments, options),
  ];

  return dedupe(found.sort((a, b) => a.start - b.start || b.end - a.end));
}

/** The cuts that arrive pre-ticked: the ones the detector is sure about. */
export function defaultAcceptedCuts(cuts: SmartCut[]): Set<string> {
  return new Set(cuts.filter((cut) => cut.verdict === 'remove').map((cut) => cut.id));
}

// --------------------------------------------------------------- detectors --

/**
 * The same sentence said twice.
 *
 * Adjacent copies are a retake: the speaker fluffed it and went again, so the
 * *earlier* one goes and the one they settled on survives. Copies far apart are
 * a deliberate recap — the same words used to make the point again — which is a
 * judgement call, so those are offered for review instead.
 */
function repeatedSentences(segments: TranscriptSegment[], options: SmartCutOptions): SmartCut[] {
  const out: SmartCut[] = [];
  const claimed = new Set<string>();

  for (let i = 0; i < segments.length; i += 1) {
    const a = segments[i]!;
    if (claimed.has(a.id)) continue;
    const wordsA = contentWords(a.text);
    if (wordsA.length < 4) continue;

    for (let j = i + 1; j < segments.length; j += 1) {
      const b = segments[j]!;
      if (claimed.has(b.id)) continue;
      const wordsB = contentWords(b.text);
      if (wordsB.length < 4) continue;

      const overlap = similarity(wordsA, wordsB);
      if (overlap < 0.8) continue;

      const gapSegments = j - i - 1;
      const gapSeconds = b.start - a.end;
      const retake = gapSegments <= 1 && gapSeconds < 12;

      const span = wholeSegment(a, options);
      if (!span) continue;
      claimed.add(a.id);

      out.push({
        id: `sc_rep_${a.id}_${b.id}`,
        kind: 'repeated-sentence',
        verdict: retake ? 'remove' : 'review',
        confidence: retake ? (overlap > 0.92 ? 'high' : 'medium') : 'low',
        start: span.start,
        end: span.end,
        text: a.text.trim(),
        reason: retake
          ? `Said again ${gapSeconds < 1 ? 'immediately' : `${gapSeconds.toFixed(1)}s later`} — this looks like the take before the good one.`
          : `Nearly the same sentence appears again at ${formatTime(b.start)}. Deliberate repetition, or worth cutting?`,
        segmentIds: [a.id],
        estimatedTiming: span.estimated,
      });
      break;
    }
  }

  return out;
}

/**
 * A sentence begun, abandoned, and begun again.
 *
 * Two shapes, both real: the restart happens inside one segment ("we need to —
 * we need to focus"), or it straddles two, where an unfinished segment is
 * followed by one that opens with the same words. Only the abandoned attempt is
 * cut, so what the speaker actually went on to say survives untouched.
 */
function falseStarts(segments: TranscriptSegment[], options: SmartCutOptions): SmartCut[] {
  const out: SmartCut[] = [];

  for (const [index, segment] of segments.entries()) {
    // --- within one segment ---
    const inner = innerRestart(segment.text);
    if (inner) {
      const span = spanFor(segment, inner.charStart, inner.charEnd, { segments, silences: options.silences });
      if (span) {
        out.push({
          id: `sc_fs_${segment.id}_${inner.charStart}`,
          kind: 'false-start',
          verdict: 'remove',
          confidence: inner.words >= 3 ? 'high' : 'medium',
          start: span.start,
          end: span.end,
          text: segment.text.slice(inner.charStart, inner.charEnd).trim(),
          reason: `Started this ${inner.words === 1 ? 'phrase' : `${inner.words}-word phrase`} and restarted it.`,
          segmentIds: [segment.id],
          estimatedTiming: span.estimated,
        });
      }
    }

    // --- across two segments ---
    const next = segments[index + 1];
    if (!next) continue;
    if (!isUnfinished(segment.text)) continue;

    const shared = sharedOpening(segment.text, next.text);
    if (shared < 2) continue;

    const span = wholeSegment(segment, options);
    if (!span) continue;
    out.push({
      id: `sc_fs2_${segment.id}`,
      kind: 'false-start',
      verdict: 'remove',
      confidence: shared >= 3 ? 'high' : 'medium',
      start: span.start,
      end: span.end,
      text: segment.text.trim(),
      reason: 'Abandoned mid-sentence, then started again with the same words.',
      segmentIds: [segment.id],
      estimatedTiming: span.estimated,
    });
  }

  return out;
}

/**
 * The speaker correcting themselves out loud.
 *
 * What is worth cutting is not the marker but everything the marker disowns:
 * the failed attempt before it, plus the marker itself. An explicit "let me
 * start again" is unambiguous; a bare "sorry" only counts when a fresh sentence
 * follows it, and even then it is offered rather than assumed.
 */
function corrections(segments: TranscriptSegment[], options: SmartCutOptions): SmartCut[] {
  const out: SmartCut[] = [];

  for (const segment of segments) {
    const text = segment.text;
    const explicit = EXPLICIT_RESTART.exec(text);
    const soft = explicit ? null : SOFT_RESTART.exec(text);
    const match = explicit ?? soft;
    if (!match) continue;

    const markerEnd = match.index + match[0].length;
    // Everything after the marker is the corrected version, and there has to be
    // one — a marker at the very end of a take corrects nothing that follows.
    const after = text.slice(markerEnd).replace(/^[\s,.:;—-]+/, '');
    if (after.split(/\s+/).filter(Boolean).length < 3) continue;

    const cutEnd = text.length - after.length;
    const span = spanFor(segment, 0, cutEnd, { segments, silences: options.silences });
    if (!span) continue;

    out.push({
      id: `sc_cor_${segment.id}_${match.index}`,
      kind: 'correction',
      verdict: explicit ? 'remove' : 'review',
      confidence: explicit ? 'high' : 'medium',
      start: span.start,
      end: span.end,
      text: text.slice(0, cutEnd).trim(),
      reason: explicit
        ? `The speaker restarts here ("${match[0].trim()}") — this is the attempt they threw away.`
        : `"${match[0].trim()}" reads like a stumble before the real line. Cut the attempt before it?`,
      segmentIds: [segment.id],
      estimatedTiming: span.estimated,
    });
  }

  return out;
}

/**
 * A sentence that restates the one before it.
 *
 * "So basically what I'm saying is…" following the thing it restates adds
 * nothing but length. This is close enough to a real rhetorical device that it
 * is never removed automatically — high containment against the previous
 * sentence is evidence, not proof.
 */
function redundant(segments: TranscriptSegment[], options: SmartCutOptions): SmartCut[] {
  const RESTATER = /\b(?:what i'?m saying is|in other words|to put (?:it|that) another way|basically what|which is to say|essentially what)\b/i;
  const out: SmartCut[] = [];

  for (let i = 1; i < segments.length; i += 1) {
    const previous = segments[i - 1]!;
    const segment = segments[i]!;
    const words = contentWords(segment.text);
    if (words.length < 4) continue;

    const contained = containment(words, contentWords(previous.text));
    const restater = RESTATER.test(segment.text);
    if (!restater && contained < 0.7) continue;
    if (restater && contained < 0.45) continue;
    // A near-exact copy is the repeated-sentence detector's job.
    if (contained > 0.95) continue;

    const span = wholeSegment(segment, options);
    if (!span) continue;
    out.push({
      id: `sc_red_${segment.id}`,
      kind: 'redundant',
      verdict: 'review',
      confidence: restater && contained > 0.6 ? 'medium' : 'low',
      start: span.start,
      end: span.end,
      text: segment.text.trim(),
      reason: restater
        ? 'Restates the previous sentence in different words.'
        : `Most of this was already said in the sentence before it (${Math.round(contained * 100)}% overlap).`,
      segmentIds: [segment.id],
      estimatedTiming: span.estimated,
    });
  }

  return out;
}

/**
 * A long stretch that adds nothing new.
 *
 * Measured, not guessed: a run of consecutive segments spanning more than
 * twelve seconds whose content words are almost all words the speaker has
 * already used in the last minute. That is what rambling *is* — still talking,
 * no new information. Always REVIEW: cutting twenty seconds of someone's
 * speech on a vocabulary statistic is not a decision to make for them.
 */
function rambling(segments: TranscriptSegment[], options: SmartCutOptions): SmartCut[] {
  const MIN_SECONDS = 12;
  const MEMORY_SECONDS = 60;
  const out: SmartCut[] = [];

  let i = 0;
  while (i < segments.length) {
    const recent = new Set(
      segments
        .filter((s) => s.end <= segments[i]!.start && s.end > segments[i]!.start - MEMORY_SECONDS)
        .flatMap((s) => contentWords(s.text)),
    );
    // Enough prior speech to judge novelty against — roughly a sentence. Below
    // that, "nothing new" says more about the sample than about the speaker.
    if (recent.size < 6) {
      i += 1;
      continue;
    }

    let j = i;
    let novel = 0;
    let total = 0;
    while (j < segments.length) {
      const words = contentWords(segments[j]!.text);
      const fresh = words.filter((word) => !recent.has(word)).length;
      // Stop the run as soon as a segment brings real new content.
      if (words.length >= 4 && fresh / words.length > 0.45) break;
      novel += fresh;
      total += words.length;
      j += 1;
    }

    const first = segments[i]!;
    const last = segments[j - 1];
    const seconds = last ? last.end - first.start : 0;
    if (!last || seconds < MIN_SECONDS || total < 15 || novel / Math.max(1, total) > 0.3) {
      i += 1;
      continue;
    }

    const span = spanAcross(first, last, options);
    if (span) {
      out.push({
        id: `sc_ram_${first.id}`,
        kind: 'rambling',
        verdict: 'review',
        confidence: novel / total < 0.15 ? 'medium' : 'low',
        start: span.start,
        end: span.end,
        text: segments.slice(i, j).map((s) => s.text.trim()).join(' '),
        reason: `${Math.round(seconds)}s that mostly re-use words already said — ${Math.round((novel / total) * 100)}% new content.`,
        segmentIds: segments.slice(i, j).map((s) => s.id),
        estimatedTiming: span.estimated,
      });
    }
    i = j;
  }

  return out;
}

/**
 * A tangent, bounded by the speaker's own markers.
 *
 * Guessing at topic drift from vocabulary alone produces nonsense on any
 * recording that legitimately covers two subjects. What is reliable is the
 * speaker *saying* they went off ("anyway…", "back to the point", "side note")
 * — so the tangent is the span between the marker that opened it and the one
 * that closed it, and it is only offered when its vocabulary really has drifted
 * from the rest of the recording.
 */
function offTopic(segments: TranscriptSegment[], options: SmartCutOptions): SmartCut[] {
  const topic = topicVocabulary(segments);
  if (topic.size < 8) return [];
  const out: SmartCut[] = [];

  for (const [index, segment] of segments.entries()) {
    if (!TANGENT_END.test(segment.text)) continue;

    // Walk back to the marker that opened the tangent, or as far as four
    // segments — beyond that it stops being an aside and becomes the video.
    let start = index;
    for (let k = index - 1; k >= 0 && index - k <= 4; k -= 1) {
      start = k;
      if (TANGENT_START.test(segments[k]!.text)) break;
    }
    if (start >= index) continue;

    const run = segments.slice(start, index);
    const words = run.flatMap((s) => contentWords(s.text));
    if (words.length < 8) continue;

    const onTopic = words.filter((word) => topic.has(word)).length / words.length;
    if (onTopic > 0.3) continue;

    const first = run[0]!;
    const last = run[run.length - 1]!;
    const span = spanAcross(first, last, options);
    if (!span) continue;

    out.push({
      id: `sc_off_${first.id}`,
      kind: 'off-topic',
      verdict: 'review',
      confidence: onTopic < 0.15 ? 'medium' : 'low',
      start: span.start,
      end: span.end,
      text: run.map((s) => s.text.trim()).join(' '),
      reason: `The speaker returns to the point right after this, and only ${Math.round(onTopic * 100)}% of it uses the video's own vocabulary.`,
      segmentIds: run.map((s) => s.id),
      estimatedTiming: span.estimated,
    });
  }

  return out;
}

// ----------------------------------------------------------------- helpers --

/**
 * A phrase started and immediately restarted inside one segment.
 *
 * "We need to, we need to focus" — the first attempt is returned. Requires the
 * two attempts to be adjacent, because a phrase repeated later in a sentence is
 * usually structure ("more data, more problems"), not a stumble.
 */
function innerRestart(text: string): { charStart: number; charEnd: number; words: number } | null {
  const pattern = /\b((?:[\w']+[ ,]+){1,5}?[\w']+)[\s,—-]+\1\b/i;
  const match = pattern.exec(text);
  if (!match) return null;
  const phrase = match[1]!;
  const words = phrase.split(/\s+/).filter(Boolean).length;
  if (words < 2) return null;
  // The first copy plus the separator; the second copy is what survives.
  return { charStart: match.index, charEnd: match.index + match[0].length - phrase.length, words };
}

/** A segment that stops without finishing its sentence. */
function isUnfinished(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (/[—-]$/.test(trimmed)) return true;
  if (/[.!?]["')\]]?$/.test(trimmed)) return false;
  // No terminal punctuation and short enough to be an abandoned attempt.
  return trimmed.split(/\s+/).length <= 14;
}

/** How many opening words two segments share. */
function sharedOpening(a: string, b: string): number {
  const wordsA = normalise(a).split(' ').filter(Boolean);
  const wordsB = normalise(b).split(' ').filter(Boolean);
  let shared = 0;
  while (shared < wordsA.length && shared < wordsB.length && wordsA[shared] === wordsB[shared]) shared += 1;
  return shared;
}

function wholeSegment(
  segment: TranscriptSegment,
  options: SmartCutOptions,
): { start: number; end: number; estimated: boolean } | null {
  return spanFor(segment, 0, segment.text.length, { segments: options.segments, silences: options.silences });
}

function spanAcross(
  first: TranscriptSegment,
  last: TranscriptSegment,
  options: SmartCutOptions,
): { start: number; end: number; estimated: boolean } | null {
  const head = wholeSegment(first, options);
  const tail = wholeSegment(last, options);
  if (!head || !tail) return null;
  return { start: head.start, end: Math.max(head.end, tail.end), estimated: head.estimated || tail.estimated };
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();
}

function contentWords(text: string): string[] {
  return normalise(text)
    .split(' ')
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/** Symmetric overlap: how much two word bags are the same bag. */
function similarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared += 1;
  return shared / Math.max(setA.size, setB.size);
}

/** Asymmetric: how much of `a` is already in `b`. */
function containment(a: string[], b: string[]): number {
  const setB = new Set(b);
  const setA = new Set(a);
  if (setA.size === 0) return 0;
  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared += 1;
  return shared / setA.size;
}

/** The words this recording is actually about: the ones it keeps coming back to. */
function topicVocabulary(segments: TranscriptSegment[]): Set<string> {
  const counts = new Map<string, number>();
  for (const segment of segments) {
    for (const word of new Set(contentWords(segment.text))) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([word]) => word),
  );
}

/**
 * One cut per span.
 *
 * The detectors overlap by design — a repeated sentence often also reads as
 * redundant — and showing the same seconds twice would let the user "reject" a
 * cut that another entry silently reinstates. The more certain verdict wins.
 */
function dedupe(cuts: SmartCut[]): SmartCut[] {
  const rank: Record<CutConfidence, number> = { high: 3, medium: 2, low: 1 };
  const out: SmartCut[] = [];

  for (const cut of cuts) {
    const clash = out.find((existing) => existing.start < cut.end - 0.05 && cut.start < existing.end - 0.05);
    if (!clash) {
      out.push(cut);
      continue;
    }
    const better =
      (cut.verdict === 'remove' ? 10 : 0) + rank[cut.confidence] >
      (clash.verdict === 'remove' ? 10 : 0) + rank[clash.confidence];
    if (better) out[out.indexOf(clash)] = cut;
  }

  return out.sort((a, b) => a.start - b.start);
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
