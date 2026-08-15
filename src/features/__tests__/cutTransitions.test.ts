import { describe, expect, it } from 'vitest';
import { countSeams, cutTransitionCommands, seamTimes } from '@/features/ai/cutTransitions';
import { cutsToCommands } from '@/features/ai/autoEdit';
import { applyCommand, makeClip, makeSequence, type Sequence } from '@/lib/engine';

/** One 30s video clip on the first video track. */
function timeline(): Sequence {
  const seq = makeSequence('seq', 'Test');
  const track = seq.tracks.find((t) => t.kind === 'video')!;
  const clip = makeClip({ id: 'main', kind: 'video', start: 0, duration: 30, assetId: 'asset' });
  return {
    ...seq,
    tracks: seq.tracks.map((t) => (t.id === track.id ? { ...t, clips: [clip] } : t)),
  };
}

describe('seamTimes', () => {
  it('shifts each seam back by the cuts before it', () => {
    // Cutting 2s at 5s and 3s at 20s: the first seam stays at 5, the second
    // arrives 2s earlier than its original position.
    expect(seamTimes([{ start: 5, end: 7 }, { start: 20, end: 23 }])).toEqual([5, 18]);
  });

  it('merges touching cuts into a single seam', () => {
    expect(seamTimes([{ start: 5, end: 7 }, { start: 7, end: 9 }])).toEqual([5]);
  });

  it('is empty when nothing is cut', () => {
    expect(seamTimes([])).toEqual([]);
  });
});

describe('cutTransitionCommands', () => {
  const cuts = [{ start: 10, end: 12 }];

  it('puts a transition on both sides of each seam', () => {
    const sequence = timeline();
    const commands = cutTransitionCommands({
      sequence,
      cutCommands: cutsToCommands(cuts),
      cuts,
      choice: { kind: 'dip-to-black', seconds: 0.4 },
    });

    expect(countSeams(commands)).toBe(1);
    expect(commands).toHaveLength(2);
    const positions = commands.map((c) => (c.type === 'ADD_TRANSITION' ? c.position : null));
    expect(positions).toEqual(['out', 'in']);
    for (const command of commands) {
      if (command.type !== 'ADD_TRANSITION') throw new Error('expected ADD_TRANSITION');
      expect(command.transition?.kind).toBe('dip-to-black');
      // Split evenly across the join.
      expect(command.transition?.duration).toBeCloseTo(0.2, 5);
    }
  });

  it('lands on clips that survive the cut, so the commands apply cleanly', () => {
    const sequence = timeline();
    const cutCommands = cutsToCommands(cuts);
    const commands = cutTransitionCommands({
      sequence,
      cutCommands,
      cuts,
      choice: { kind: 'fade', seconds: 0.3 },
    });

    const result = [...cutCommands, ...commands].reduce(applyCommand, sequence);
    const clips = result.tracks.find((t) => t.kind === 'video')!.clips;
    expect(clips).toHaveLength(2);
    expect(clips[0]!.transitionOut?.kind).toBe('fade');
    expect(clips[1]!.transitionIn?.kind).toBe('fade');
    // The join itself is untouched: the two halves still meet exactly.
    expect(clips[0]!.start + clips[0]!.duration).toBeCloseTo(clips[1]!.start, 5);
  });

  it('returns nothing for a hard cut', () => {
    const sequence = timeline();
    expect(
      cutTransitionCommands({
        sequence,
        cutCommands: cutsToCommands(cuts),
        cuts,
        choice: { kind: 'none', seconds: 0.4 },
      }),
    ).toEqual([]);
  });

  it('skips a cut that runs off the end, which has only one side', () => {
    const sequence = timeline();
    const tail = [{ start: 28, end: 30 }];
    expect(
      cutTransitionCommands({
        sequence,
        cutCommands: cutsToCommands(tail),
        cuts: tail,
        choice: { kind: 'fade', seconds: 0.4 },
      }),
    ).toEqual([]);
  });

  it('never lets a transition swallow the clip it sits on', () => {
    const sequence = timeline();
    // Leaves a 0.5s head before the seam.
    const early = [{ start: 0.5, end: 4 }];
    const commands = cutTransitionCommands({
      sequence,
      cutCommands: cutsToCommands(early),
      cuts: early,
      choice: { kind: 'fade', seconds: 1.2 },
    });

    const outgoing = commands.find((c) => c.type === 'ADD_TRANSITION' && c.position === 'out');
    if (outgoing?.type !== 'ADD_TRANSITION') throw new Error('expected an outgoing transition');
    // 0.6s would be half of the requested length, but the clip is only 0.5s.
    expect(outgoing.transition!.duration).toBeLessThanOrEqual(0.5 * 0.4 + 1e-6);
  });

  it('decorates every seam when several ranges are cut', () => {
    const sequence = timeline();
    const many = [
      { start: 4, end: 5 },
      { start: 12, end: 14 },
      { start: 20, end: 21 },
    ];
    const commands = cutTransitionCommands({
      sequence,
      cutCommands: cutsToCommands(many),
      cuts: many,
      choice: { kind: 'blur', seconds: 0.3 },
    });

    expect(countSeams(commands)).toBe(3);
  });
});
