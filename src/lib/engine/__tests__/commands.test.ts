import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  EditorHistory,
  interpolate,
  makeClip,
  makeSequence,
  sequenceDuration,
  snapTargets,
  snapTime,
  splitClipAt,
  validateCommand,
  type Sequence,
} from '../index';

function seqWithClip(): Sequence {
  const seq = makeSequence('s1', 'Test');
  return applyCommand(seq, {
    type: 'ADD_CLIP',
    trackId: 's1-v1',
    clip: makeClip({ id: 'c1', kind: 'video', start: 0, duration: 10, assetId: 'a1', name: 'main' }),
  });
}

describe('commands', () => {
  it('adds and deletes clips', () => {
    const seq = seqWithClip();
    expect(sequenceDuration(seq)).toBe(10);
    const after = applyCommand(seq, { type: 'DELETE_CLIP', clipId: 'c1' });
    expect(sequenceDuration(after)).toBe(0);
  });

  it('moves clips across tracks', () => {
    const seq = seqWithClip();
    const after = applyCommand(seq, { type: 'MOVE_CLIP', clipId: 'c1', trackId: 's1-v2', start: 5 });
    expect(after.tracks.find((t) => t.id === 's1-v1')!.clips).toHaveLength(0);
    const moved = after.tracks.find((t) => t.id === 's1-v2')!.clips[0]!;
    expect(moved.start).toBe(5);
  });

  it('trims and adjusts sourceIn on left-edge trim', () => {
    const seq = seqWithClip();
    const after = applyCommand(seq, { type: 'TRIM_CLIP', clipId: 'c1', start: 2, duration: 6 });
    const clip = after.tracks[0]!.clips[0]!;
    expect(clip.start).toBe(2);
    expect(clip.duration).toBe(6);
    expect(clip.sourceIn).toBe(2);
  });

  it('splits preserving source mapping', () => {
    const clip = makeClip({ id: 'c1', kind: 'video', start: 2, duration: 8, sourceIn: 1, speed: 2 });
    const [left, right] = splitClipAt(clip, 6, 'c2');
    expect(left.duration).toBe(4);
    expect(right.start).toBe(6);
    expect(right.duration).toBe(4);
    expect(right.sourceIn).toBe(1 + 4 * 2);
  });

  it('REMOVE_RANGE with ripple closes the gap and splits spanning clips', () => {
    const seq = seqWithClip();
    const after = applyCommand(seq, { type: 'REMOVE_RANGE', start: 3, end: 5, ripple: true });
    const clips = after.tracks[0]!.clips;
    expect(clips).toHaveLength(2);
    expect(clips[0]!.duration).toBe(3);
    expect(clips[1]!.start).toBe(3);
    expect(clips[1]!.duration).toBe(5);
    expect(clips[1]!.sourceIn).toBe(5);
    expect(sequenceDuration(after)).toBe(8);
  });

  it('speed change preserves source range', () => {
    const seq = seqWithClip();
    const after = applyCommand(seq, { type: 'CHANGE_SPEED', clipId: 'c1', speed: 2 });
    const clip = after.tracks[0]!.clips[0]!;
    expect(clip.duration).toBe(5);
    expect(clip.speed).toBe(2);
  });

  it('adds captions with words', () => {
    const seq = seqWithClip();
    const after = applyCommand(seq, {
      type: 'ADD_CAPTION',
      trackId: 's1-c1',
      clipId: 'cap1',
      text: 'hello world',
      start: 1,
      duration: 2,
      words: [
        { text: 'hello', start: 0, end: 0.8 },
        { text: 'world', start: 0.9, end: 1.8 },
      ],
      style: 'karaoke',
    });
    const cap = after.tracks.find((t) => t.kind === 'caption')!.clips[0]!;
    expect(cap.captionWords).toHaveLength(2);
    expect(cap.captionStyle).toBe('karaoke');
  });

  it('changes aspect ratio and dimensions', () => {
    const seq = seqWithClip();
    const after = applyCommand(seq, { type: 'CHANGE_ASPECT_RATIO', aspect: '9:16' });
    expect(after.width).toBe(1080);
    expect(after.height).toBe(1920);
  });
});

describe('history', () => {
  it('undo/redo restores state including AI batches', () => {
    const history = new EditorHistory();
    let seq = seqWithClip();
    seq = history.apply(
      seq,
      [
        { type: 'REMOVE_RANGE', start: 1, end: 2, ripple: true },
        { type: 'REMOVE_RANGE', start: 4, end: 5, ripple: true },
      ],
      'AI: remove silence',
    );
    expect(sequenceDuration(seq)).toBe(8);
    const undone = history.undo(seq)!;
    expect(sequenceDuration(undone)).toBe(10);
    const redone = history.redo(undone)!;
    expect(sequenceDuration(redone)).toBe(8);
  });
});

describe('snapping', () => {
  it('snaps to clip boundaries within threshold', () => {
    const seq = seqWithClip();
    const targets = snapTargets(seq, 7.5);
    expect(snapTime(9.9, targets, 0.2).time).toBe(10);
    expect(snapTime(9.5, targets, 0.2).snapped).toBe(false);
    expect(snapTime(7.4, targets, 0.2).time).toBe(7.5); // playhead
  });
});

describe('keyframes', () => {
  it('interpolates linearly', () => {
    const kfs = [
      { time: 0, value: 0 },
      { time: 2, value: 100 },
    ];
    expect(interpolate(kfs, 1, 50)).toBe(50);
    expect(interpolate(kfs, 3, 0)).toBe(100);
    expect(interpolate(undefined, 1, 42)).toBe(42);
  });
});

describe('AI command validation', () => {
  it('rejects unknown commands and bad references', () => {
    const seq = seqWithClip();
    expect(validateCommand(seq, { type: 'EVIL' }).ok).toBe(false);
    expect(validateCommand(seq, { type: 'DELETE_CLIP', clipId: 'nope' }).ok).toBe(false);
    expect(validateCommand(seq, { type: 'REMOVE_RANGE', start: 5, end: 3, ripple: true }).ok).toBe(false);
    expect(validateCommand(seq, { type: 'DELETE_CLIP', clipId: 'c1' }).ok).toBe(true);
  });
});
