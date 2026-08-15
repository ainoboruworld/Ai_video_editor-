import { describe, expect, it } from 'vitest';
import { parseTranscript } from '@/features/transcript/parse';
import { cuesToSegments, formatTimestamp, parseTimestamp, segmentsToCues } from '@/features/transcript/model';

describe('parseTranscript — timestamped ranges', () => {
  const ranged = `00:00 - 00:04
Today we're going to talk about AI marketing.

00:04 - 00:09
The way people search for information is changing.

00:09 - 00:15
That's why marketers need to understand AI.`;

  it('keeps the given timings and does not mark them estimated', () => {
    const result = parseTranscript(ranged);
    expect(result.estimatedTimings).toBe(false);
    expect(result.segments).toHaveLength(3);
    expect(result.segments[0]).toMatchObject({ start: 0, end: 4 });
    expect(result.segments[2]).toMatchObject({ start: 9, end: 15 });
    expect(result.segments[1]!.text).toBe('The way people search for information is changing.');
  });

  it('accepts SRT-style arrows, sequence numbers and hours', () => {
    const srt = `1
00:00:00,000 --> 00:00:04,500
First line

2
00:00:04,500 --> 00:00:09,000
Second line`;
    const result = parseTranscript(srt);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]!.end).toBeCloseTo(4.5, 3);
    expect(result.segments[0]!.text).toBe('First line');
  });

  it('joins multi-line blocks into one segment', () => {
    const result = parseTranscript('00:00 - 00:05\nfirst part\nsecond part');
    expect(result.segments[0]!.text).toBe('first part second part');
  });
});

describe('parseTranscript — single leading timestamps', () => {
  it('runs each segment until the next timestamp', () => {
    const result = parseTranscript('00:00 Hello there\n00:06 Second thing\n00:10 Third thing', 15);
    expect(result.estimatedTimings).toBe(false);
    expect(result.segments).toHaveLength(3);
    expect(result.segments[0]).toMatchObject({ start: 0, end: 6 });
    expect(result.segments[2]).toMatchObject({ start: 10, end: 15 });
  });

  it('does not treat a single stray timestamp as a timed transcript', () => {
    const result = parseTranscript('At 00:30 something happened and then it continued for a while.');
    expect(result.estimatedTimings).toBe(true);
  });
});

describe('parseTranscript — plain text', () => {
  const plain = `Today we're going to talk about AI marketing.
The way people search for information is changing.
That's why marketers need to understand AI.`;

  it('flags timings as estimated and says so', () => {
    const result = parseTranscript(plain, 30);
    expect(result.estimatedTimings).toBe(true);
    expect(result.note).toMatch(/estimated/i);
    expect(result.segments).toHaveLength(3);
  });

  it('spreads segments across the video duration without overlapping', () => {
    const result = parseTranscript(plain, 30);
    expect(result.segments[0]!.start).toBe(0);
    expect(result.segments[result.segments.length - 1]!.end).toBeCloseTo(30, 1);
    for (let i = 1; i < result.segments.length; i++) {
      expect(result.segments[i]!.start).toBeGreaterThanOrEqual(result.segments[i - 1]!.end - 0.01);
    }
  });

  it('gives longer sentences proportionally more time', () => {
    const result = parseTranscript('Hi.\n\nThis sentence is considerably longer than the first one by some margin.', 30);
    const [first, second] = result.segments;
    expect(second!.end - second!.start).toBeGreaterThan(first!.end - first!.start);
  });

  it('splits a single paragraph into sentences', () => {
    const result = parseTranscript('One thing happened. Then another thing. Finally a third.', 12);
    expect(result.segments).toHaveLength(3);
  });

  it('handles empty input', () => {
    const result = parseTranscript('   ');
    expect(result.segments).toHaveLength(0);
    expect(result.note).toMatch(/empty/i);
  });
});

describe('parseTranscript — clamping', () => {
  it('never produces times beyond the video duration', () => {
    const result = parseTranscript('00:00 - 00:20\nOverruns the clip', 10);
    expect(result.segments[0]!.end).toBeLessThanOrEqual(10);
  });
});

describe('timestamps', () => {
  it('round-trips mm:ss', () => {
    expect(parseTimestamp('01:05')).toBe(65);
    expect(formatTimestamp(65)).toBe('01:05');
  });

  it('parses hours and milliseconds', () => {
    expect(parseTimestamp('01:02:03')).toBe(3723);
    expect(parseTimestamp('00:04,500')).toBeCloseTo(4.5, 3);
  });

  it('rejects nonsense', () => {
    expect(parseTimestamp('later')).toBeNull();
  });
});

describe('segmentsToCues', () => {
  it('splits long segments into readable cues covering the same span', () => {
    const segments = [{ id: 'a', start: 0, end: 12, text: 'one two three four five six seven eight nine ten eleven twelve' }];
    const cues = segmentsToCues(segments, 6);
    expect(cues).toHaveLength(2);
    expect(cues[0]!.start).toBe(0);
    expect(cues[cues.length - 1]!.end).toBe(12);
  });

  it('round-trips through cues', () => {
    const segments = cuesToSegments([{ text: 'hello there', start: 1, end: 3, words: [] }]);
    expect(segments[0]).toMatchObject({ start: 1, end: 3, text: 'hello there' });
  });
});

describe('recut proposals', () => {
  it('derives removals from the kept spans and keeps the model reasons', async () => {
    const { proposalFromAi } = await import('@/features/ai/recut');
    const proposal = proposalFromAi(
      [
        { start: 4, end: 9, reason: 'The actual point' },
        { start: 14, end: 22, reason: 'Payoff' },
      ],
      [
        { start: 0, end: 4, reason: 'Greeting' },
        { start: 9, end: 14, reason: 'False start' },
      ],
      22,
      'Tightened',
    );
    expect(proposal.origin).toBe('ai');
    expect(proposal.remove).toHaveLength(2);
    expect(proposal.remove[0]).toMatchObject({ start: 0, end: 4, reason: 'Greeting' });
    expect(proposal.remove[1]).toMatchObject({ start: 9, end: 14, reason: 'False start' });
    expect(proposal.removedSeconds).toBeCloseTo(9, 5);
    expect(proposal.resultSeconds).toBeCloseTo(13, 5);
  });

  it('still produces removals when the model only returned keeps', async () => {
    const { proposalFromAi } = await import('@/features/ai/recut');
    const proposal = proposalFromAi([{ start: 5, end: 10, reason: 'good' }], [], 20, '');
    expect(proposal.remove.map((span) => [span.start, span.end])).toEqual([
      [0, 5],
      [10, 20],
    ]);
  });
});

describe('smartAutoCut', () => {
  const segments = [
    { id: '1', start: 0, end: 1, text: 'Um' },
    { id: '2', start: 1, end: 6, text: 'Today we are talking about AI marketing and how it works.' },
    { id: '3', start: 6, end: 7, text: 'So' },
    { id: '4', start: 7, end: 14, text: 'The way people search for information is changing quickly now.' },
  ];

  it('cuts filler-only segments and keeps real speech', async () => {
    const { smartAutoCut } = await import('@/features/ai/recut');
    const proposal = smartAutoCut({ segments, duration: 14 });
    expect(proposal.origin).toBe('smart');
    expect(proposal.remove.map((span) => [span.start, span.end])).toEqual([
      [0, 1],
      [6, 7],
    ]);
    expect(proposal.removedSeconds).toBeCloseTo(2, 5);
  });

  it('is never labelled as AI', async () => {
    const { smartAutoCut } = await import('@/features/ai/recut');
    const proposal = smartAutoCut({ segments, duration: 14 });
    expect(proposal.summary.toLowerCase()).not.toContain('ai');
  });

  it('includes long pauses from the audio analysis', async () => {
    const { smartAutoCut } = await import('@/features/ai/recut');
    const proposal = smartAutoCut({
      segments: [segments[1]!, segments[3]!],
      duration: 14,
      analysis: {
        envelope: { values: Float32Array.from([]), windowSeconds: 0.1, duration: 14, peak: 1 },
        silences: [{ start: 6, end: 7 }],
        speech: [],
        removableSeconds: 1,
      },
    });
    expect(proposal.remove.some((span) => span.reason === 'Long pause')).toBe(true);
  });

  it('says so plainly when there is nothing to cut', async () => {
    const { smartAutoCut } = await import('@/features/ai/recut');
    const proposal = smartAutoCut({ segments: [segments[1]!], duration: 6 });
    expect(proposal.remove).toHaveLength(0);
    expect(proposal.summary).toMatch(/nothing obvious/i);
  });
});

describe('segments outside the video', () => {
  it('reports how many were dropped instead of hiding them', () => {
    const result = parseTranscript('00:00 - 00:04\nIn range\n\n00:20 - 00:25\nBeyond the end', 10);
    expect(result.segments).toHaveLength(1);
    expect(result.droppedOutsideVideo).toBe(1);
    expect(result.note).toMatch(/fell outside/i);
  });

  it('says nothing about drops when everything fits', () => {
    const result = parseTranscript('00:00 - 00:04\nIn range', 10);
    expect(result.droppedOutsideVideo).toBe(0);
    expect(result.note).not.toMatch(/fell outside/i);
  });
});
