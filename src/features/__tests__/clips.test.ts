import { describe, expect, it } from 'vitest';
import {
  appendPoint,
  closeGapsCommands,
  isContinuous,
  joinCommands,
  moveInOrder,
  orderedClips,
  reorderCommands,
} from '@/features/edit/clips';
import { applyCommand, makeClip, makeSequence, trackByRole, type Sequence } from '@/lib/engine';

/** A project of back-to-back takes, the normal multi-clip case. */
function project(durations: number[]): Sequence {
  let seq = makeSequence('s', 'test');
  const track = trackByRole(seq, 'video')!;
  let start = 0;
  for (const [index, duration] of durations.entries()) {
    seq = applyCommand(seq, {
      type: 'ADD_CLIP',
      trackId: track.id,
      clip: makeClip({
        id: `c${index}`,
        kind: 'video',
        name: `take ${index + 1}`,
        assetId: `a${index}`,
        start,
        duration,
      }),
    });
    start += duration;
  }
  return seq;
}

const ids = (seq: Sequence) => orderedClips(seq).map((entry) => entry.clip.id);
const starts = (seq: Sequence) => orderedClips(seq).map((entry) => +entry.start.toFixed(3));

function run(seq: Sequence, commands: ReturnType<typeof reorderCommands>): Sequence {
  return commands.reduce((current, command) => applyCommand(current, command), seq);
}

describe('the running order', () => {
  it('reads the video track in play order', () => {
    expect(ids(project([3, 4, 5]))).toEqual(['c0', 'c1', 'c2']);
  });

  it('appends the next clip after the last one', () => {
    expect(appendPoint(project([3, 4, 5]))).toBe(12);
    expect(appendPoint(makeSequence('s', 'test'))).toBe(0);
  });

  it('ignores clips that are not source media', () => {
    const seq = project([3]);
    const text = trackByRole(seq, 'text')!;
    const withText = applyCommand(seq, {
      type: 'ADD_TEXT',
      trackId: text.id,
      clipId: 't1',
      text: 'hello',
      start: 0,
      duration: 2,
    });
    expect(ids(withText)).toEqual(['c0']);
  });
});

describe('reordering', () => {
  it('moves a clip and re-lays the rest butt-joined', () => {
    const seq = project([3, 4, 5]);
    const after = run(seq, reorderCommands(seq, ['c2', 'c0', 'c1']));
    expect(ids(after)).toEqual(['c2', 'c0', 'c1']);
    expect(starts(after)).toEqual([0, 5, 8]);
    expect(isContinuous(after)).toBe(true);
  });

  it('emits nothing when the order is already right', () => {
    const seq = project([3, 4, 5]);
    expect(reorderCommands(seq, ['c0', 'c1', 'c2'])).toEqual([]);
  });

  it('only moves the clips that actually shift', () => {
    // Swapping the last two leaves the first where it is, so it should not be
    // rewritten — an undo of a reorder should not un-move untouched clips.
    const seq = project([3, 4, 5]);
    const commands = reorderCommands(seq, ['c0', 'c2', 'c1']);
    expect(commands.map((c) => (c as { clipId: string }).clipId)).not.toContain('c0');
  });

  it('never drops a clip the caller forgot to name', () => {
    const seq = project([3, 4, 5]);
    const after = run(seq, reorderCommands(seq, ['c2']));
    expect(ids(after).sort()).toEqual(['c0', 'c1', 'c2']);
    expect(isContinuous(after)).toBe(true);
  });

  it('closes the hole a deleted clip leaves behind', () => {
    const seq = project([3, 4, 5]);
    const gapped = applyCommand(seq, { type: 'DELETE_CLIP', clipId: 'c1' });
    expect(isContinuous(gapped)).toBe(false);
    const closed = run(gapped, closeGapsCommands(gapped));
    expect(starts(closed)).toEqual([0, 3]);
    expect(isContinuous(closed)).toBe(true);
  });
});

describe('moveInOrder', () => {
  it('moves an item forward and back', () => {
    expect(moveInOrder(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveInOrder(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('leaves the list alone for a no-op or an out-of-range index', () => {
    expect(moveInOrder(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(moveInOrder(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});

describe('joins between clips', () => {
  it('fades both sides of every join but not the head or the tail', () => {
    const seq = project([3, 4, 5]);
    const after = run(seq, joinCommands(seq));
    const [first, middle, last] = orderedClips(after).map((entry) => entry.clip);
    expect(first!.fadeIn).toBe(0);
    expect(first!.fadeOut).toBeGreaterThan(0);
    expect(middle!.fadeIn).toBeGreaterThan(0);
    expect(middle!.fadeOut).toBeGreaterThan(0);
    expect(last!.fadeIn).toBeGreaterThan(0);
    expect(last!.fadeOut).toBe(0);
  });

  it('does nothing at all to a single clip', () => {
    expect(joinCommands(project([6]))).toEqual([]);
  });

  it('adds a dissolve only when asked, and only to incoming clips', () => {
    const seq = project([3, 4]);
    expect(joinCommands(seq).some((c) => c.type === 'ADD_TRANSITION')).toBe(false);

    const after = run(seq, joinCommands(seq, { dissolve: true }));
    const [first, second] = orderedClips(after).map((entry) => entry.clip);
    expect(first!.transitionIn).toBeNull();
    expect(second!.transitionIn?.kind).toBe('cross-dissolve');
  });

  it('never lets a transition eat a short clip', () => {
    // A 0.5s clip cannot carry a 0.25s dissolve without becoming mostly blend.
    const seq = project([3, 0.5, 3]);
    const after = run(seq, joinCommands(seq, { dissolve: true }));
    const short = orderedClips(after)[1]!.clip;
    expect(short.transitionIn!.duration).toBeLessThanOrEqual(0.5 / 3 + 0.001);
    expect(short.fadeIn).toBeLessThanOrEqual(0.5 / 3 + 0.001);
  });

  it('is idempotent — smoothing twice changes nothing the second time', () => {
    const seq = project([3, 4, 5]);
    const once = run(seq, joinCommands(seq));
    expect(joinCommands(once)).toEqual([]);
  });
});

describe('joins versus cut seams', () => {
  /** One recording ripple-cut in the middle: two clips, one asset, contiguous. */
  function splitTake(): Sequence {
    let seq = makeSequence('s', 'test');
    const track = trackByRole(seq, 'video')!;
    seq = applyCommand(seq, {
      type: 'ADD_CLIP',
      trackId: track.id,
      clip: makeClip({ id: 'h1', kind: 'video', assetId: 'same', start: 0, duration: 4, sourceIn: 0 }),
    });
    return applyCommand(seq, {
      type: 'ADD_CLIP',
      trackId: track.id,
      clip: makeClip({ id: 'h2', kind: 'video', assetId: 'same', start: 4, duration: 4, sourceIn: 4 }),
    });
  }

  it('leaves a seam inside one recording completely alone', () => {
    // Cut smoothing owns this boundary; touching it here would fight that.
    expect(joinCommands(splitTake(), { dissolve: true })).toEqual([]);
  });

  it('still treats a boundary between two different files as a join', () => {
    expect(joinCommands(project([4, 4]), { dissolve: true }).length).toBeGreaterThan(0);
  });

  it('leaves a discontinuous jump within one file to cut smoothing too', () => {
    // A ripple delete produces exactly this shape, so it cannot be told apart
    // from a deliberate splice — and cut smoothing is the right owner of both.
    let seq = makeSequence('s', 'test');
    const track = trackByRole(seq, 'video')!;
    seq = applyCommand(seq, {
      type: 'ADD_CLIP',
      trackId: track.id,
      clip: makeClip({ id: 'j1', kind: 'video', assetId: 'same', start: 0, duration: 4, sourceIn: 0 }),
    });
    seq = applyCommand(seq, {
      type: 'ADD_CLIP',
      trackId: track.id,
      clip: makeClip({ id: 'j2', kind: 'video', assetId: 'same', start: 4, duration: 4, sourceIn: 34 }),
    });
    expect(joinCommands(seq, { dissolve: true })).toEqual([]);
  });

  it('clears a dissolve it added when asked for hard joins', () => {
    const seq = project([4, 4]);
    const dissolved = run(seq, joinCommands(seq, { dissolve: true }));
    expect(orderedClips(dissolved)[1]!.clip.transitionIn).not.toBeNull();

    const hard = run(dissolved, joinCommands(dissolved, { dissolve: false }));
    expect(orderedClips(hard)[1]!.clip.transitionIn).toBeNull();
  });

  it('stays idempotent in both directions', () => {
    const seq = project([4, 4]);
    const dissolved = run(seq, joinCommands(seq, { dissolve: true }));
    expect(joinCommands(dissolved, { dissolve: true })).toEqual([]);
    const hard = run(dissolved, joinCommands(dissolved, { dissolve: false }));
    expect(joinCommands(hard, { dissolve: false })).toEqual([]);
  });
});
