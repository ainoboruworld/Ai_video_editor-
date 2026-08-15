import { describe, expect, it } from 'vitest';
import { detectFillerCandidates, highlightRuns, snapToSilence } from '@/features/edit/fillers';
import type { TranscriptSegment } from '@/features/transcript/model';

function segment(text: string, start = 0, end = 4, words?: TranscriptSegment['words']): TranscriptSegment {
  return { id: 's1', start, end, text, words };
}

describe('detectFillerCandidates', () => {
  it('flags hesitation sounds wherever they appear', () => {
    const found = detectFillerCandidates({ segments: [segment('Today we are, uh, going to talk about it.')] });
    expect(found.map((f) => f.word.toLowerCase())).toContain('uh');
    expect(found[0]!.confidence).toBe('high');
  });

  it('leaves a sentence-opening "basically" alone', () => {
    // The spec's own example: this one is the speaker making their point.
    const found = detectFillerCandidates({ segments: [segment('Basically, the product works this way.')] });
    expect(found).toHaveLength(0);
  });

  it('flags "basically" wedged mid-sentence', () => {
    const found = detectFillerCandidates({ segments: [segment('The product basically works this way.')] });
    expect(found.map((f) => f.word.toLowerCase())).toEqual(['basically']);
    expect(found[0]!.confidence).toBe('medium');
  });

  it('keeps "like" when it is a real verb or comparison', () => {
    for (const text of ['It looks like a duck.', 'I like this one.', 'That sounds like trouble.']) {
      expect(detectFillerCandidates({ segments: [segment(text)] })).toHaveLength(0);
    }
  });

  it('flags "like" used as filler', () => {
    const found = detectFillerCandidates({ segments: [segment('It was, like, completely different.')] });
    expect(found.map((f) => f.word.toLowerCase())).toEqual(['like']);
  });

  it('keeps "you know" when it opens a real clause', () => {
    expect(detectFillerCandidates({ segments: [segment('You know that we shipped it.')] })).toHaveLength(0);
    expect(detectFillerCandidates({ segments: [segment('It was, you know, quite hard.')] })).toHaveLength(1);
  });

  it('prefers the longer phrase where two overlap', () => {
    const found = detectFillerCandidates({ segments: [segment('It was, you know, hard.')] });
    expect(found).toHaveLength(1);
    expect(found[0]!.word.toLowerCase()).toBe('you know');
  });

  it('marks a segment that is nothing but a filler', () => {
    const found = detectFillerCandidates({ segments: [segment('Um', 1, 1.4)] });
    expect(found).toHaveLength(1);
    expect(found[0]!.confidence).toBe('high');
    expect(found[0]!.reason).toMatch(/only this filler/i);
  });

  it('uses word timings when the transcript carries them', () => {
    const words = [
      { text: 'Today', start: 0, end: 0.5 },
      { text: 'uh', start: 0.6, end: 0.9 },
      { text: 'right', start: 1.0, end: 1.4 },
    ];
    const found = detectFillerCandidates({ segments: [segment('Today uh right', 0, 2, words)] });
    const uh = found.find((f) => f.word.toLowerCase() === 'uh');
    expect(uh).toBeDefined();
    expect(uh!.start).toBeCloseTo(0.6, 5);
    expect(uh!.end).toBeCloseTo(0.9, 5);
    expect(uh!.estimatedTiming).toBe(false);
  });

  it('interpolates and says so when there are no word timings', () => {
    const found = detectFillerCandidates({ segments: [segment('Today we are uh going to talk', 0, 6)] });
    const uh = found.find((f) => f.word.toLowerCase() === 'uh');
    expect(uh).toBeDefined();
    expect(uh!.estimatedTiming).toBe(true);
    // Roughly where "uh" sits in the string, not pinned to the segment edges.
    expect(uh!.start).toBeGreaterThan(0);
    expect(uh!.end).toBeLessThan(6);
  });

  it('returns candidates in timeline order', () => {
    const segments = [segment('Um hello there', 0, 2), { ...segment('So uh we start', 2, 5), id: 's2' }];
    const found = detectFillerCandidates({ segments });
    const starts = found.map((f) => f.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});

describe('snapToSilence', () => {
  it('pulls a span out to the quiet either side', () => {
    const snapped = snapToSilence({ start: 1.0, end: 1.4 }, [
      { start: 0.7, end: 0.95 },
      { start: 1.45, end: 1.8 },
    ]);
    expect(snapped.start).toBeCloseTo(0.95, 5);
    expect(snapped.end).toBeCloseTo(1.45, 5);
  });

  it('ignores silence that is nowhere near', () => {
    const span = { start: 5, end: 5.4 };
    expect(snapToSilence(span, [{ start: 0, end: 1 }])).toEqual(span);
  });
});

describe('highlightRuns', () => {
  it('splits a segment around its fillers without losing any text', () => {
    const seg = segment('Today we are, uh, going.');
    const runs = highlightRuns(seg, detectFillerCandidates({ segments: [seg] }));
    expect(runs.map((run) => run.text).join('')).toBe(seg.text);
    expect(runs.filter((run) => run.candidate !== null)).toHaveLength(1);
  });

  it('returns the whole segment when nothing was flagged', () => {
    const seg = segment('A perfectly clean sentence.');
    expect(highlightRuns(seg, [])).toEqual([{ text: seg.text, candidate: null }]);
  });
});

describe('candidate identity', () => {
  it('gives every candidate its own id, even for repeated text', () => {
    // A transcript full of one-word "Uh," lines: the shape a real transcription
    // tool produces, and the one where a positional id would repeat.
    const segments = Array.from({ length: 8 }, (_, index) => ({
      id: 's',
      start: index * 2,
      end: index * 2 + 1,
      text: 'Uh,',
    }));
    const found = detectFillerCandidates({ segments });
    expect(found).toHaveLength(8);
    expect(new Set(found.map((f) => f.id)).size).toBe(8);
  });

  it('survives accept-all as a keyed record', () => {
    const segments = [
      { id: 'a', start: 0, end: 2, text: 'Um, so basically it was, like, different.' },
      { id: 'a', start: 2, end: 4, text: 'Uh, you know, right?' },
    ];
    const found = detectFillerCandidates({ segments });
    const decisions = Object.fromEntries(found.map((c) => [c.id, true]));
    // The count the UI shows and the count that gets cut have to be one number.
    expect(Object.keys(decisions)).toHaveLength(found.length);
    expect(found.filter((c) => decisions[c.id]).length).toBe(found.length);
  });
});
