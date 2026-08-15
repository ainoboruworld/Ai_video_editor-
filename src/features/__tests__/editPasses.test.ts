import { describe, expect, it } from 'vitest';
import { DEFAULT_AGGRESSION, pauseCuts, pauseProfile } from '@/features/edit/pauses';
import { duckingKeyframes, DUCKING_DEFAULTS } from '@/features/edit/ducking';
import { smoothingCommands, smoothSeams } from '@/features/edit/smoothing';
import { workflowState } from '@/features/edit/workflow';
import { applyCommand, makeClip, makeSequence, trackByRole, type Sequence } from '@/lib/engine';

describe('pauseCuts', () => {
  const duration = 60;

  it('leaves a beat behind rather than closing the gap', () => {
    const [cut] = pauseCuts({ silences: [{ start: 10, end: 13 }], duration, aggression: 0.5 });
    expect(cut).toBeDefined();
    const removed = cut!.end - cut!.start;
    expect(removed).toBeCloseTo(3 - cut!.keptSeconds, 5);
    expect(cut!.keptSeconds).toBeGreaterThan(0);
  });

  it('takes the cut out of the middle so both phrases keep air', () => {
    const [cut] = pauseCuts({ silences: [{ start: 10, end: 14 }], duration, aggression: 0.5 });
    const centre = (cut!.start + cut!.end) / 2;
    expect(centre).toBeCloseTo(12, 5);
  });

  it('ignores pauses under the threshold', () => {
    // Natural end of the slider only touches pauses over two seconds.
    expect(pauseCuts({ silences: [{ start: 10, end: 11 }], duration, aggression: 0 })).toHaveLength(0);
    expect(pauseCuts({ silences: [{ start: 10, end: 11 }], duration, aggression: 1 })).toHaveLength(1);
  });

  it('leaves head and tail silence to the user', () => {
    expect(pauseCuts({ silences: [{ start: 0, end: 3 }], duration, aggression: 1 })).toHaveLength(0);
    expect(pauseCuts({ silences: [{ start: 57, end: 60 }], duration, aggression: 1 })).toHaveLength(0);
  });

  it('defaults to the conservative end of the slider', () => {
    expect(DEFAULT_AGGRESSION).toBeLessThan(0.5);
    expect(pauseProfile(DEFAULT_AGGRESSION).threshold).toBeGreaterThan(1);
  });

  it('gets more aggressive as the slider moves', () => {
    const natural = pauseProfile(0);
    const tight = pauseProfile(1);
    expect(tight.threshold).toBeLessThan(natural.threshold);
    expect(tight.keep).toBeLessThan(natural.keep);
  });
});

describe('duckingKeyframes', () => {
  const clip = makeClip({ id: 'music', kind: 'audio', start: 0, duration: 30, assetId: 'a' });

  it('drops the music while the speaker talks and lifts it after', () => {
    const keyframes = duckingKeyframes({ clip, speech: [{ start: 5, end: 10 }] });
    const at = (time: number) => {
      const before = [...keyframes].reverse().find((point) => point.time <= time);
      return before?.value ?? 0;
    };
    expect(at(7)).toBeCloseTo(DUCKING_DEFAULTS.ducked, 5);
    expect(at(2)).toBeCloseTo(DUCKING_DEFAULTS.bed, 5);
    expect(at(25)).toBeCloseTo(DUCKING_DEFAULTS.bed, 5);
  });

  it('ramps rather than jumping, so it does not pump', () => {
    const keyframes = duckingKeyframes({ clip, speech: [{ start: 5, end: 10 }] });
    const drop = keyframes.filter((point) => point.time > 4 && point.time <= 5);
    expect(drop.length).toBeGreaterThanOrEqual(2);
  });

  it('holds the duck through a short breath between phrases', () => {
    const keyframes = duckingKeyframes({ clip, speech: [{ start: 5, end: 8 }, { start: 8.2, end: 11 }] });
    const between = [...keyframes].reverse().find((point) => point.time <= 8.1)?.value ?? 0;
    expect(between).toBeCloseTo(DUCKING_DEFAULTS.ducked, 5);
  });

  it('stays inside the clip', () => {
    const keyframes = duckingKeyframes({ clip, speech: [{ start: 28, end: 40 }] });
    for (const point of keyframes) {
      expect(point.time).toBeGreaterThanOrEqual(0);
      expect(point.time).toBeLessThanOrEqual(clip.duration);
    }
  });

  it('never leaves the music louder than the bed', () => {
    const keyframes = duckingKeyframes({ clip, speech: [{ start: 1, end: 3 }] });
    for (const point of keyframes) expect(point.value).toBeLessThanOrEqual(DUCKING_DEFAULTS.bed);
  });
});

function cutTimeline(): Sequence {
  const seq = makeSequence('s', 'test');
  const track = seq.tracks.find((t) => t.kind === 'video')!;
  return {
    ...seq,
    tracks: seq.tracks.map((t) =>
      t.id === track.id
        ? {
            ...t,
            clips: [
              makeClip({ id: 'a', kind: 'video', start: 0, duration: 4, assetId: 'x' }),
              makeClip({ id: 'b', kind: 'video', start: 4, duration: 4, assetId: 'x' }),
              makeClip({ id: 'c', kind: 'video', start: 8, duration: 4, assetId: 'x' }),
            ],
          }
        : t,
    ),
  };
}

describe('smoothing', () => {
  const cuts = [{ start: 4, end: 4.5 }];

  it('fades the audio on both sides of every join', () => {
    const sequence = cutTimeline();
    const result = smoothSeams({ sequence, seams: [4, 8], style: 'audio' });
    const after = result.commands.reduce(applyCommand, sequence);
    const clips = after.tracks.find((t) => t.kind === 'video')!.clips;

    expect(clips[0]!.fadeOut).toBeGreaterThan(0);
    expect(clips[1]!.fadeIn).toBeGreaterThan(0);
    expect(clips[1]!.fadeOut).toBeGreaterThan(0);
    expect(clips[2]!.fadeIn).toBeGreaterThan(0);
    // The open ends of the timeline are left alone.
    expect(clips[0]!.fadeIn).toBe(0);
    expect(clips[2]!.fadeOut).toBe(0);
  });

  it('touches only the audio in audio-only mode', () => {
    const result = smoothSeams({ sequence: cutTimeline(), seams: [4], style: 'audio' });
    expect(result.commands.every((command) => command.type === 'SET_FADE')).toBe(true);
    expect(result.dissolved).toBe(0);
  });

  it('overlaps the two halves so they can dissolve into each other', () => {
    const sequence = cutTimeline();
    const result = smoothSeams({ sequence, seams: [4], style: 'dissolve' });
    const after = result.commands.reduce(applyCommand, sequence);
    const clips = after.tracks.find((t) => t.kind === 'video')!.clips;

    expect(result.dissolved).toBe(1);
    // The outgoing clip now runs past where the incoming one starts.
    expect(clips[0]!.start + clips[0]!.duration).toBeGreaterThan(clips[1]!.start);
    expect(clips[1]!.transitionIn?.kind).toBe('cross-dissolve');
    // Only the incoming side ramps: two ramps would dip through the background
    // instead of blending one picture into the other.
    expect(clips[0]!.transitionOut).toBeNull();
  });

  it('does not push anything downstream when it extends a clip', () => {
    const sequence = cutTimeline();
    const before = sequence.tracks.find((t) => t.kind === 'video')!.clips.map((c) => c.start);
    const result = smoothSeams({ sequence, seams: [4, 8], style: 'dissolve' });
    const after = result.commands.reduce(applyCommand, sequence);
    expect(after.tracks.find((t) => t.kind === 'video')!.clips.map((c) => c.start)).toEqual(before);
  });

  it('silences the extension, so the removed filler is never heard', () => {
    const sequence = cutTimeline();
    const result = smoothSeams({ sequence, seams: [4], style: 'dissolve' });
    const after = result.commands.reduce(applyCommand, sequence);
    const outgoing = after.tracks.find((t) => t.kind === 'video')!.clips[0]!;
    const envelope = outgoing.keyframes.volume!;

    expect(envelope.length).toBeGreaterThan(2);
    expect(envelope[envelope.length - 1]!.value).toBe(0);
    // Silent from the original cut point onwards, not from the new end.
    const closesAt = envelope.find((point) => point.value === 0)!.time;
    expect(closesAt).toBeLessThanOrEqual(4.001);
  });

  it('never dissolves for longer than the cut removed', () => {
    // Only 0.5s was taken out here, so that is all the handle there is.
    const sequence = cutTimeline();
    const result = smoothingCommands({
      sequence,
      cutCommands: [],
      cuts: [{ start: 4, end: 4.12 }],
      style: 'dissolve',
    });
    const transition = result.commands.find((c) => c.type === 'ADD_TRANSITION');
    if (transition && transition.type === 'ADD_TRANSITION') {
      expect(transition.transition!.duration).toBeLessThanOrEqual(0.12);
    }
  });

  it('falls back to fading the audio when there is no handle to dissolve over', () => {
    const sequence = cutTimeline();
    const result = smoothingCommands({
      sequence,
      cutCommands: [],
      cuts: [{ start: 4, end: 4.01 }],
      style: 'dissolve',
    });
    expect(result.dissolved).toBe(0);
    expect(result.commands.every((command) => command.type === 'SET_FADE')).toBe(true);
  });

  it('does nothing when smoothing is off', () => {
    expect(smoothSeams({ sequence: cutTimeline(), seams: [4], style: 'none' }).commands).toEqual([]);
  });

  it('never fades a clip end to end', () => {
    const seq = makeSequence('s', 'test');
    const track = seq.tracks.find((t) => t.kind === 'video')!;
    const tiny: Sequence = {
      ...seq,
      tracks: seq.tracks.map((t) =>
        t.id === track.id
          ? {
              ...t,
              clips: [
                makeClip({ id: 'a', kind: 'video', start: 0, duration: 4, assetId: 'x' }),
                makeClip({ id: 'b', kind: 'video', start: 4, duration: 0.15, assetId: 'x' }),
              ],
            }
          : t,
      ),
    };
    const result = smoothSeams({ sequence: tiny, seams: [4], style: 'audio' });
    const after = result.commands.reduce(applyCommand, tiny);
    const clips = after.tracks.find((t) => t.kind === 'video')!.clips;
    expect(clips[1]!.fadeIn).toBe(0);
  });

  void cuts;
});

describe('workflowState', () => {
  it('reads each step off the project rather than remembering it', () => {
    let sequence = makeSequence('s', 'test');
    const video = sequence.tracks.find((t) => t.kind === 'video')!;
    sequence = applyCommand(sequence, {
      type: 'ADD_CLIP',
      trackId: video.id,
      clip: makeClip({ id: 'v', kind: 'video', start: 0, duration: 10, assetId: 'a' }),
    });

    const before = workflowState({ sequence, transcriptSegments: 0, appliedCuts: 0, hasPauseCuts: false });
    expect(before.video.done).toBe(true);
    expect(before.transcript.done).toBe(false);
    expect(before.captions.done).toBe(false);

    const caption = trackByRole(sequence, 'caption')!;
    sequence = applyCommand(sequence, {
      type: 'ADD_CAPTION',
      trackId: caption.id,
      clipId: 'c1',
      text: 'hello',
      start: 0,
      duration: 1,
    });

    const after = workflowState({ sequence, transcriptSegments: 4, appliedCuts: 0, hasPauseCuts: false });
    expect(after.transcript.done).toBe(true);
    expect(after.captions.done).toBe(true);
  });

  it('reports nothing done for an empty project', () => {
    const state = workflowState({ sequence: null, transcriptSegments: 0, appliedCuts: 0, hasPauseCuts: false });
    expect(state.video.done).toBe(false);
    expect(state.video.detail).toBe('no video yet');
  });
});
