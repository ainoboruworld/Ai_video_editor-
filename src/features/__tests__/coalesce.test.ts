import { describe, expect, it } from 'vitest';
import { coalesceCuts, textBetween } from '@/features/edit/coalesce';
import type { TranscriptSegment } from '@/features/transcript/model';

/** One segment per sentence, four seconds each, speaking at a steady pace. */
function segments(...texts: string[]): TranscriptSegment[] {
  return texts.map((text, index) => ({
    id: `s${index}`,
    start: index * 4,
    end: index * 4 + 4,
    text,
  }));
}

const spans = (result: ReturnType<typeof coalesceCuts>) =>
  result.cuts.map((cut) => [+cut.start.toFixed(2), +cut.end.toFixed(2)]);

describe('slivers between cuts', () => {
  it('runs the cut straight through a fragment too short to be a shot', () => {
    // 80ms between two cuts is a frame and a half — a flash, not a shot.
    const result = coalesceCuts({ cuts: [{ start: 1, end: 2 }, { start: 2.08, end: 3 }] });
    expect(spans(result)).toEqual([[1, 3]]);
    expect(result.swallowed).toHaveLength(1);
    expect(result.swallowed[0]!.reason).toMatch(/80ms/);
  });

  it('leaves a genuine gap between two cuts alone', () => {
    const result = coalesceCuts({ cuts: [{ start: 1, end: 2 }, { start: 5, end: 6 }] });
    expect(spans(result)).toEqual([
      [1, 2],
      [5, 6],
    ]);
    expect(result.swallowed).toHaveLength(0);
  });

  it('never bridges more than the limit, however empty the gap looks', () => {
    // Half a second of silence is still half a second of the speaker's video.
    const result = coalesceCuts({ cuts: [{ start: 1, end: 2 }, { start: 2.9, end: 4 }], maxBridge: 0.6 });
    expect(spans(result)).toHaveLength(2);
  });

  it('collapses a run of near-touching cuts into one', () => {
    const result = coalesceCuts({
      cuts: [
        { start: 1, end: 2 },
        { start: 2.1, end: 3 },
        { start: 3.05, end: 4 },
      ],
    });
    expect(spans(result)).toEqual([[1, 4]]);
    expect(result.swallowed).toHaveLength(2);
  });
});

describe('deciding whether the phrase in between is needed', () => {
  const spoken = segments('So the whole reason this matters is that editing takes hours away from you.');

  it('swallows a fragment that is only grammar', () => {
    // 1.78–2.17s is "is that" — the joinery of a sentence that no longer
    // exists on either side of it.
    expect(textBetween(spoken, 1.78, 2.17)).toBe('is that');
    const result = coalesceCuts({
      cuts: [{ start: 1.2, end: 1.78 }, { start: 2.17, end: 3 }],
      segments: spoken,
    });
    expect(result.cuts).toHaveLength(1);
    expect(result.swallowed[0]!.reason).toMatch(/carries nothing on its own/i);
  });

  it('keeps a fragment that carries a real word', () => {
    // 2.2–2.6s is "editing" — the subject of the sentence, not joinery.
    expect(textBetween(spoken, 2.2, 2.6)).toBe('editing');
    const result = coalesceCuts({
      cuts: [{ start: 1.8, end: 2.2 }, { start: 2.6, end: 3.4 }],
      segments: spoken,
    });
    expect(result.cuts).toHaveLength(2);
    expect(result.swallowed).toHaveLength(0);
  });

  it('swallows a gap where nothing at all is said', () => {
    const result = coalesceCuts({
      cuts: [{ start: 30, end: 31 }, { start: 31.4, end: 32 }],
      segments: spoken,
    });
    expect(result.cuts).toHaveLength(1);
    expect(result.swallowed[0]!.reason).toMatch(/nothing is said/i);
  });

  it('uses word timings when the transcript has them', () => {
    const timed: TranscriptSegment[] = [
      {
        id: 's0',
        start: 0,
        end: 4,
        text: 'we shipped the product in January',
        words: [
          { text: 'we', start: 0, end: 0.5 },
          { text: 'shipped', start: 0.5, end: 1.2 },
          { text: 'the', start: 1.2, end: 1.5 },
          { text: 'product', start: 1.5, end: 2.2 },
          { text: 'in', start: 2.2, end: 2.4 },
          { text: 'January', start: 2.4, end: 3.2 },
        ],
      },
    ];
    expect(textBetween(timed, 1.2, 1.5)).toBe('the');
    expect(textBetween(timed, 1.5, 2.2)).toBe('product');

    // "the" alone goes; "product" stays.
    expect(coalesceCuts({ cuts: [{ start: 0.6, end: 1.2 }, { start: 1.5, end: 2 }], segments: timed }).cuts).toHaveLength(1);
    expect(coalesceCuts({ cuts: [{ start: 1, end: 1.5 }, { start: 2.2, end: 2.6 }], segments: timed }).cuts).toHaveLength(2);
  });
});

describe('what it reports', () => {
  it('names every fragment it swallowed rather than doing it silently', () => {
    const result = coalesceCuts({
      cuts: [{ start: 1, end: 2 }, { start: 2.05, end: 3 }],
      segments: segments('one two three four five six seven eight nine ten eleven twelve'),
    });
    expect(result.swallowed[0]).toMatchObject({ start: 2, end: 2.05 });
    expect(result.swallowed[0]!.seconds).toBeCloseTo(0.05, 3);
    expect(result.swallowed[0]!.reason.length).toBeGreaterThan(10);
  });

  it('is a no-op on a single cut, or none', () => {
    expect(coalesceCuts({ cuts: [] }).cuts).toEqual([]);
    expect(coalesceCuts({ cuts: [{ start: 1, end: 2 }] }).cuts).toEqual([{ start: 1, end: 2 }]);
    expect(coalesceCuts({ cuts: [{ start: 1, end: 2 }] }).swallowed).toEqual([]);
  });

  it('never removes less than it was asked to', () => {
    const cuts = [{ start: 1, end: 2 }, { start: 2.1, end: 3 }, { start: 8, end: 9 }];
    const result = coalesceCuts({ cuts });
    const asked = cuts.reduce((total, cut) => total + (cut.end - cut.start), 0);
    const got = result.cuts.reduce((total, cut) => total + (cut.end - cut.start), 0);
    expect(got).toBeGreaterThanOrEqual(asked - 0.001);
  });
});
