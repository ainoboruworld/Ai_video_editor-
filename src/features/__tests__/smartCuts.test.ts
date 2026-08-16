import { describe, expect, it } from 'vitest';
import { defaultAcceptedCuts, detectSmartCuts, type SmartCut } from '@/features/edit/smartCuts';
import type { TranscriptSegment } from '@/features/transcript/model';

/** Segments at a steady four seconds each, which is a normal speaking pace. */
function segments(...texts: string[]): TranscriptSegment[] {
  return texts.map((text, index) => ({
    id: `s${index}`,
    start: index * 4,
    end: index * 4 + 3.6,
    text,
  }));
}

const kinds = (cuts: SmartCut[]) => cuts.map((cut) => cut.kind);
const find = (cuts: SmartCut[], kind: SmartCut['kind']) => cuts.find((cut) => cut.kind === kind);

describe('repeated sentences', () => {
  it('treats an immediate repeat as a retake and cuts the first attempt', () => {
    const cuts = detectSmartCuts({
      segments: segments(
        'The whole point of this is to save you time in the edit.',
        'The whole point of this is to save you time in the edit.',
        'And that is why we built it.',
      ),
    });
    const cut = find(cuts, 'repeated-sentence')!;
    expect(cut.verdict).toBe('remove');
    expect(cut.start).toBe(0);
    // The surviving copy is the later one — the take the speaker settled on.
    expect(cut.end).toBeLessThanOrEqual(4);
  });

  it('treats a distant repeat as a deliberate recap and only asks', () => {
    const filler = Array.from({ length: 6 }, (_, i) => `Here is some entirely different material number ${i}.`);
    const cuts = detectSmartCuts({
      segments: segments(
        'The whole point of this is to save you time in the edit.',
        ...filler,
        'The whole point of this is to save you time in the edit.',
      ),
    });
    const cut = find(cuts, 'repeated-sentence')!;
    expect(cut.verdict).toBe('review');
    expect(cut.confidence).toBe('low');
  });

  it('ignores two short sentences that merely rhyme', () => {
    expect(kinds(detectSmartCuts({ segments: segments('Yes it is.', 'Yes it is.') }))).not.toContain(
      'repeated-sentence',
    );
  });
});

describe('false starts', () => {
  it('cuts the abandoned half of a restart inside one segment', () => {
    const cuts = detectSmartCuts({
      segments: segments('We need to, we need to focus on the thing that actually matters here.'),
    });
    const cut = find(cuts, 'false-start')!;
    expect(cut.verdict).toBe('remove');
    expect(cut.text.toLowerCase()).toContain('we need to');
  });

  it('cuts an unfinished segment that the next one restarts', () => {
    const cuts = detectSmartCuts({
      segments: segments(
        'So the thing that really matters',
        'So the thing that really matters is how long the edit takes you.',
      ),
    });
    const cut = find(cuts, 'false-start')!;
    expect(cut.verdict).toBe('remove');
    expect(cut.segmentIds).toEqual(['s0']);
  });

  it('leaves a finished sentence alone even when the next one echoes it', () => {
    const cuts = detectSmartCuts({
      segments: segments('So the thing that matters is speed.', 'So the thing that matters is speed of editing.'),
    });
    expect(find(cuts, 'false-start')).toBeUndefined();
  });

  it('does not read deliberate structure as a stumble', () => {
    // "more data, more problems" repeats a phrase on purpose.
    const cuts = detectSmartCuts({ segments: segments('It is more data, more problems, every single time.') });
    expect(find(cuts, 'false-start')).toBeUndefined();
  });
});

describe('corrections', () => {
  it('cuts the thrown-away attempt before an explicit restart', () => {
    const cuts = detectSmartCuts({
      segments: segments('We shipped it in Jan— let me start again. We shipped the product in January.'),
    });
    const cut = find(cuts, 'correction')!;
    expect(cut.verdict).toBe('remove');
    expect(cut.confidence).toBe('high');
    expect(cut.text).toContain('let me start again');
    expect(cut.text).not.toContain('We shipped the product in January');
  });

  it('only asks about a bare "sorry"', () => {
    const cuts = detectSmartCuts({
      segments: segments('It was about thirty, sorry, it was about forty people in the room.'),
    });
    expect(find(cuts, 'correction')!.verdict).toBe('review');
  });

  it('ignores a restart marker with nothing after it to correct', () => {
    expect(find(detectSmartCuts({ segments: segments('And that is the end. Sorry.') }), 'correction')).toBeUndefined();
  });
});

describe('redundancy and rambling', () => {
  it('flags a restatement of the previous sentence, for review only', () => {
    const cuts = detectSmartCuts({
      segments: segments(
        'The editing takes longer than the filming does.',
        'In other words, editing takes longer than filming.',
      ),
    });
    const cut = find(cuts, 'redundant')!;
    expect(cut.verdict).toBe('review');
  });

  it('flags a long stretch that adds nothing new, for review only', () => {
    // Rambling is not repetition: no two of these sentences are alike, and none
    // restates the one before it. What they have in common is that after the
    // first two, twenty seconds go by without a single new idea.
    const cuts = detectSmartCuts({
      segments: segments(
        'Editing footage takes hours of careful manual work every single week.',
        'The timeline review process eats another whole afternoon before export.',
        'Manual editing work eats whole afternoon hours.',
        'Timeline review takes another careful week.',
        'Footage export process single hours manual.',
        'Whole afternoon editing work timeline review.',
        'Careful week another takes footage export.',
        'Nobody warned us about client feedback rounds destroying deadlines.',
      ),
    });
    const cut = find(cuts, 'rambling');
    expect(cut?.verdict).toBe('review');
    expect(cut!.end - cut!.start).toBeGreaterThan(12);
    // The run ends where a new idea arrives, not at the end of the transcript.
    expect(cut!.end).toBeLessThan(28);
  });

  it('says nothing about a passage that keeps introducing new ideas', () => {
    const cuts = detectSmartCuts({
      segments: segments(
        'Editing footage takes hours of manual work.',
        'Pricing pressure has changed how agencies staff projects.',
        'Meanwhile distribution moved almost entirely to vertical video.',
        'Hiring editors became the biggest constraint on growth.',
      ),
    });
    expect(kinds(cuts)).not.toContain('rambling');
  });
});

describe('off-topic tangents', () => {
  it('flags a marked aside the speaker returns from', () => {
    const cuts = detectSmartCuts({
      segments: segments(
        'Video editing takes hours of manual work every single week.',
        'Editing workflows are the biggest cost in video production teams.',
        'Manual video editing work is where the hours actually go.',
        'Side note, my dog completely destroyed the kitchen bin yesterday.',
        'He chewed through the plastic lid and scattered rubbish everywhere.',
        'Anyway, video editing workflows are what we should be talking about.',
        'Editing production teams lose hours to manual video work.',
      ),
    });
    const cut = find(cuts, 'off-topic');
    expect(cut?.verdict).toBe('review');
    expect(cut!.text.toLowerCase()).toContain('dog');
  });

  it('does not flag an aside that is still about the subject', () => {
    const cuts = detectSmartCuts({
      segments: segments(
        'Video editing takes hours of manual work every week.',
        'Editing workflows are the biggest cost for video teams.',
        'Side note, video editing tools rarely help with the editing workflows.',
        'Anyway, video editing workflows are the real manual cost.',
        'Manual editing work in video teams takes hours weekly.',
      ),
    });
    expect(kinds(cuts)).not.toContain('off-topic');
  });
});

describe('the review contract', () => {
  it('pre-ticks only the confident removals', () => {
    const cuts = detectSmartCuts({
      segments: segments(
        'We shipped it in Jan— let me start again. We shipped the product in January.',
        'The editing takes longer than the filming does.',
        'In other words, editing takes longer than filming.',
      ),
    });
    const accepted = defaultAcceptedCuts(cuts);
    for (const cut of cuts) {
      expect(accepted.has(cut.id)).toBe(cut.verdict === 'remove');
    }
    expect([...accepted].length).toBeGreaterThan(0);
  });

  it('gives every candidate a real span, a reason and an id', () => {
    const cuts = detectSmartCuts({
      segments: segments(
        'We need to, we need to focus on what actually matters to the viewer.',
        'The editing takes longer than the filming does every single time.',
        'In other words, the editing takes longer than the filming.',
      ),
    });
    expect(cuts.length).toBeGreaterThan(0);
    const ids = new Set(cuts.map((cut) => cut.id));
    expect(ids.size).toBe(cuts.length);
    for (const cut of cuts) {
      expect(cut.end).toBeGreaterThan(cut.start);
      expect(cut.reason.length).toBeGreaterThan(10);
      expect(cut.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('never returns two cuts covering the same seconds', () => {
    const cuts = detectSmartCuts({
      segments: segments(
        'The whole point here is to save you time in the edit.',
        'The whole point here is to save you time in the edit.',
        'In other words the whole point is saving time in the edit.',
      ),
    });
    for (let i = 1; i < cuts.length; i += 1) {
      expect(cuts[i]!.start).toBeGreaterThanOrEqual(cuts[i - 1]!.end - 0.05);
    }
  });

  it('returns nothing for a clean transcript', () => {
    expect(
      detectSmartCuts({
        segments: segments(
          'Today I want to show you how the editor handles a long recording.',
          'It reads the transcript first, then proposes the cuts it can justify.',
          'You decide which ones happen.',
        ),
      }),
    ).toEqual([]);
  });
});
