import { describe, expect, it } from 'vitest';
import { techniqueCommands, type ResolvedSeam } from '@/features/edit/cutTechniques';
import { levelJumpAt, resolveClipJoins } from '@/features/edit/smoothPlan';
import type { CutJudgement, CutTechnique } from '@/features/edit/cutJudgement';
import { applyCommand, makeClip, makeSequence, trackByRole, type Clip, type Sequence } from '@/lib/engine';

let counter = 0;
const newId = (prefix: string) => `${prefix}_${(counter += 1)}`;

function timeline(options: { assets?: [string, string] } = {}): { sequence: Sequence; seam: ResolvedSeam } {
  const [a, b] = options.assets ?? ['same', 'same'];
  let seq = makeSequence('s', 'test');
  const track = trackByRole(seq, 'video')!;
  const outgoing = makeClip({ id: 'out', kind: 'video', assetId: a, start: 0, duration: 5, sourceIn: 0 });
  const incoming = makeClip({ id: 'in', kind: 'video', assetId: b, start: 5, duration: 5, sourceIn: 9 });
  seq = applyCommand(seq, { type: 'ADD_CLIP', trackId: track.id, clip: outgoing });
  seq = applyCommand(seq, { type: 'ADD_CLIP', trackId: track.id, clip: incoming });
  const clips = seq.tracks.find((t) => t.id === track.id)!.clips;
  return {
    sequence: seq,
    seam: {
      time: 5,
      outgoing: clips.find((c) => c.id === 'out')!,
      incoming: clips.find((c) => c.id === 'in')!,
      trackId: track.id,
    },
  };
}

function verdict(technique: CutTechnique, parameters: CutJudgement['parameters'] = {}): CutJudgement {
  return {
    id: 'x',
    time: 5,
    technique,
    noticeability: 0.5,
    residual: 0.2,
    reason: 'test',
    confidence: 'high',
    parameters,
  };
}

const run = (sequence: Sequence, seam: ResolvedSeam, judgement: CutJudgement) =>
  techniqueCommands({ sequence, seams: [{ seam, judgement }], newId });

const applyAll = (sequence: Sequence, commands: ReturnType<typeof run>['commands']) =>
  commands.reduce(applyCommand, sequence);

const clipById = (sequence: Sequence, id: string): Clip =>
  sequence.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;

describe('a clean cut', () => {
  it('emits nothing at all', () => {
    const { sequence, seam } = timeline();
    expect(run(sequence, seam, verdict('clean')).commands).toEqual([]);
  });
});

describe('audio crossfade', () => {
  it('fades both sides and touches nothing visual', () => {
    const { sequence, seam } = timeline();
    const { commands } = run(sequence, seam, verdict('audio-crossfade', { seconds: 0.045 }));
    expect(commands.every((c) => c.type === 'SET_FADE')).toBe(true);

    const after = applyAll(sequence, commands);
    expect(clipById(after, 'out').fadeOut).toBeCloseTo(0.045, 3);
    expect(clipById(after, 'in').fadeIn).toBeCloseTo(0.045, 3);
    expect(clipById(after, 'in').transform.scale).toBe(1);
  });
});

describe('punch-in', () => {
  it('reframes the incoming clip, subtly', () => {
    const { sequence, seam } = timeline();
    const after = applyAll(sequence, run(sequence, seam, verdict('punch-in', { scale: 1.05 })).commands);
    expect(clipById(after, 'in').transform.scale).toBeCloseTo(1.05, 3);
  });

  it('alternates so a run of them does not creep the framing tighter', () => {
    const { sequence, seam } = timeline();
    const { commands } = techniqueCommands({
      sequence,
      seams: [
        { seam, judgement: verdict('punch-in', { scale: 1.05 }) },
        { seam, judgement: verdict('punch-in', { scale: 1.05 }) },
        { seam, judgement: verdict('punch-in', { scale: 1.05 }) },
      ],
      newId,
    });
    const scales = commands
      .filter((c): c is Extract<typeof c, { type: 'CHANGE_TRANSFORM' }> => c.type === 'CHANGE_TRANSFORM')
      .map((c) => c.transform.scale);
    expect(scales).toEqual([1.05, 1, 1.05]);
  });
});

describe('dissolve', () => {
  it('extends the outgoing picture and silences the extension', () => {
    const { sequence, seam } = timeline();
    const after = applyAll(sequence, run(sequence, seam, verdict('dissolve', { seconds: 0.18 })).commands);
    const out = clipById(after, 'out');
    const incoming = clipById(after, 'in');

    expect(out.duration).toBeCloseTo(5.18, 3);
    expect(incoming.transitionIn?.kind).toBe('cross-dissolve');
    // The last keyframe silences the extension, so the removed words are seen
    // for a moment and never heard.
    expect(out.keyframes.volume?.at(-1)?.value).toBe(0);
  });

  it('does nothing when there is no material to dissolve through', () => {
    const { sequence, seam } = timeline();
    const result = run(sequence, seam, verdict('dissolve', { seconds: 0 }));
    expect(result.commands).toEqual([]);
    expect(result.skipped[0]!.reason).toMatch(/no removed footage/i);
  });
});

describe('J and L cuts', () => {
  it('an L-cut holds the outgoing audio over the new picture', () => {
    const { sequence, seam } = timeline({ assets: ['takeA', 'takeB'] });
    const after = applyAll(sequence, run(sequence, seam, verdict('l-cut', { seconds: 0.32 })).commands);
    const bridge = after.tracks.flatMap((t) => t.clips).find((c) => c.name === 'L-cut bridge')!;

    expect(bridge).toBeDefined();
    expect(bridge.kind).toBe('audio');
    // Sits after the picture cut, sourced from where the outgoing take carries on.
    expect(bridge.start).toBeCloseTo(5, 2);
    expect(bridge.assetId).toBe('takeA');
    expect(bridge.sourceIn).toBeCloseTo(5, 2);
    // The incoming clip's own audio comes up underneath rather than doubling it.
    expect(clipById(after, 'in').keyframes.volume?.[0]?.value).toBe(0);
  });

  it('a J-cut brings the next audio in before its picture', () => {
    const { sequence, seam } = timeline({ assets: ['takeA', 'takeB'] });
    const after = applyAll(sequence, run(sequence, seam, verdict('j-cut', { seconds: 0.32 })).commands);
    const bridge = after.tracks.flatMap((t) => t.clips).find((c) => c.name === 'J-cut bridge')!;

    expect(bridge.start).toBeLessThan(5);
    expect(bridge.assetId).toBe('takeB');
    expect(bridge.sourceIn).toBeCloseTo(9, 2);
    // The outgoing clip's audio falls away as the new one arrives.
    expect(clipById(after, 'out').keyframes.volume?.at(-1)?.value).toBe(0);
  });

  it('falls back to a plain crossfade when the audio track is occupied', () => {
    const { sequence, seam } = timeline({ assets: ['takeA', 'takeB'] });
    const audio = trackByRole(sequence, 'voiceover')!;
    const blocked = applyCommand(sequence, {
      type: 'ADD_CLIP',
      trackId: audio.id,
      clip: makeClip({ id: 'busy', kind: 'audio', assetId: 'music', start: 4, duration: 4 }),
    });
    const result = run(blocked, seam, verdict('l-cut', { seconds: 0.32 }));
    expect(result.commands.every((c) => c.type === 'SET_FADE')).toBe(true);
    expect(result.skipped[0]!.reason).toMatch(/no audio track free/i);
  });
});

describe('B-roll', () => {
  it('is proposed and never placed', () => {
    const { sequence, seam } = timeline();
    const result = run(sequence, seam, verdict('broll'));
    expect(result.commands).toEqual([]);
    expect(result.skipped[0]!.reason).toMatch(/pick a clip/i);
  });
});

describe('levelJumpAt', () => {
  const envelope = {
    values: Float32Array.from(Array.from({ length: 200 }, (_, i) => (i < 100 ? 0.9 : 0.1))),
    windowSeconds: 0.02,
    duration: 4,
    peak: 1,
  };

  it('reads a cliff in the waveform as a jump', () => {
    expect(levelJumpAt(2, envelope)).toBeGreaterThan(0.5);
  });

  it('reads a steady passage as no jump', () => {
    expect(levelJumpAt(1, envelope)).toBeLessThan(0.1);
    expect(levelJumpAt(3, envelope)).toBeLessThan(0.1);
  });

  it('is zero with no envelope at all', () => {
    expect(levelJumpAt(2, null)).toBe(0);
  });
});

describe('which joins get judged', () => {
  it('includes a join between two different recordings, with no handle', () => {
    let seq = makeSequence('s', 'test');
    const track = trackByRole(seq, 'video')!;
    seq = applyCommand(seq, {
      type: 'ADD_CLIP',
      trackId: track.id,
      clip: makeClip({ id: 'a', kind: 'video', assetId: 'takeA', start: 0, duration: 5 }),
    });
    seq = applyCommand(seq, {
      type: 'ADD_CLIP',
      trackId: track.id,
      clip: makeClip({ id: 'b', kind: 'video', assetId: 'takeB', start: 5, duration: 5 }),
    });

    const joins = resolveClipJoins(seq);
    expect(joins).toHaveLength(1);
    expect(joins[0]!.seam.time).toBe(5);
    // No removed footage at a splice, so a dissolve is impossible by construction.
    expect(joins[0]!.handle).toBe(0);
  });

  it('does not treat two halves of one recording as a clip join', () => {
    // That is a cut seam, and cut smoothing owns it.
    let seq = makeSequence('s', 'test');
    const track = trackByRole(seq, 'video')!;
    seq = applyCommand(seq, {
      type: 'ADD_CLIP',
      trackId: track.id,
      clip: makeClip({ id: 'a', kind: 'video', assetId: 'same', start: 0, duration: 5 }),
    });
    seq = applyCommand(seq, {
      type: 'ADD_CLIP',
      trackId: track.id,
      clip: makeClip({ id: 'b', kind: 'video', assetId: 'same', start: 5, duration: 5, sourceIn: 9 }),
    });
    expect(resolveClipJoins(seq)).toHaveLength(0);
  });

  it('ignores a gap between two clips, which is not a join', () => {
    let seq = makeSequence('s', 'test');
    const track = trackByRole(seq, 'video')!;
    seq = applyCommand(seq, {
      type: 'ADD_CLIP',
      trackId: track.id,
      clip: makeClip({ id: 'a', kind: 'video', assetId: 'takeA', start: 0, duration: 5 }),
    });
    seq = applyCommand(seq, {
      type: 'ADD_CLIP',
      trackId: track.id,
      clip: makeClip({ id: 'b', kind: 'video', assetId: 'takeB', start: 7, duration: 5 }),
    });
    expect(resolveClipJoins(seq)).toHaveLength(0);
  });
});
