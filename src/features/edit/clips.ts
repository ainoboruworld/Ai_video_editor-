/**
 * Several recordings as one continuous edit.
 *
 * A talking-head video is rarely one take. The editor's job is to treat four
 * clips as one piece of material — one transcript, one set of cuts, one export
 * — while never losing which frames came from which file, because that is what
 * keeps every clip's own audio and video in sync.
 *
 * So clips stay separate objects on the main video track, butt-joined in order,
 * and everything downstream works in *timeline* time. Reordering is a batch of
 * moves, not a rebuild: the clips keep their ids, their trims and their
 * transitions, so undo takes the whole reorder back in one step.
 */
import type { Clip, EditorCommand, Sequence } from '@/lib/engine';
import { trackByRole } from '@/lib/engine';

export interface OrderedClip {
  clip: Clip;
  trackId: string;
  /** Position in the running order, from 0. */
  index: number;
  start: number;
  duration: number;
}

/** Two clips of one recording are joined this softly by default. */
export const JOIN_FADE_SECONDS = 0.04;
export const JOIN_DISSOLVE_SECONDS = 0.25;

/**
 * The source clips, in running order.
 *
 * Only clips with media count: text, graphics and captions live on other
 * tracks, and a gap left by a ripple delete is not a clip.
 */
export function orderedClips(sequence: Sequence): OrderedClip[] {
  const track = trackByRole(sequence, 'video');
  if (!track) return [];
  return [...track.clips]
    .filter((clip) => clip.assetId && (clip.kind === 'video' || clip.kind === 'image'))
    .sort((a, b) => a.start - b.start)
    .map((clip, index) => ({ clip, trackId: track.id, index, start: clip.start, duration: clip.duration }));
}

/** Where a new clip should land so it follows the ones already there. */
export function appendPoint(sequence: Sequence): number {
  const clips = orderedClips(sequence);
  const last = clips[clips.length - 1];
  return last ? round(last.start + last.duration) : 0;
}

/**
 * Lays the video track out in a given order, butt-joined from zero.
 *
 * Returns only the moves that actually change something, so reordering two
 * clips out of six does not rewrite the other four — and an order that is
 * already correct produces no commands at all rather than a no-op edit in the
 * undo stack.
 */
export function reorderCommands(sequence: Sequence, order: string[]): EditorCommand[] {
  const clips = orderedClips(sequence);
  const byId = new Map(clips.map((entry) => [entry.clip.id, entry]));

  // Anything the caller did not name keeps its relative position at the end,
  // so a partial order can never silently drop a clip off the timeline.
  const named = order.filter((id) => byId.has(id));
  const rest = clips.filter((entry) => !named.includes(entry.clip.id)).map((entry) => entry.clip.id);
  const full = [...named, ...rest];

  const commands: EditorCommand[] = [];
  let cursor = 0;
  for (const id of full) {
    const entry = byId.get(id);
    if (!entry) continue;
    if (Math.abs(entry.start - cursor) > 0.001) {
      commands.push({ type: 'MOVE_CLIP', clipId: id, start: round(cursor) });
    }
    cursor += entry.duration;
  }
  return commands;
}

/** The order with one clip moved to a new index. */
export function moveInOrder(ids: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || from >= ids.length) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return ids;
  next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
  return next;
}

/**
 * Closes any gaps between clips without changing their order.
 *
 * Deleting a clip from the middle leaves a hole, and a hole in the middle of a
 * talking head is a black frame. This is the same operation as a reorder that
 * keeps the current order.
 */
export function closeGapsCommands(sequence: Sequence): EditorCommand[] {
  return reorderCommands(
    sequence,
    orderedClips(sequence).map((entry) => entry.clip.id),
  );
}

/**
 * A join is where two *different* recordings meet.
 *
 * This is the distinction that keeps two features from fighting. A seam left
 * behind by a ripple delete also sits on a clip's `transitionIn`, but it is a
 * different problem with a different fix — cut smoothing dissolves it through
 * the footage the cut removed. Only a boundary between two separate takes is a
 * join, so that is the only place this touches.
 */
export function isJoin(previous: OrderedClip | undefined, entry: OrderedClip): boolean {
  if (!previous) return false;
  // Different files, and nothing else.
  //
  // A ripple delete inside one recording leaves two clips of the same asset
  // whose source times are *also* discontinuous — geometrically identical to a
  // deliberate splice of that file. Since the two cannot be told apart, both
  // are left to cut smoothing, which is the better treatment for either: it has
  // the removed footage to dissolve through, and this does not.
  return previous.clip.assetId !== entry.clip.assetId;
}

/**
 * The joins between clips, made quiet.
 *
 * A join between two different recordings is not the same problem as a join a
 * cut left behind. There is no removed footage to dissolve through, and the two
 * sides genuinely are different shots — so the honest treatment is a short
 * audio fade on both sides (which removes the click of two unrelated waveforms
 * being spliced) and, optionally, a short dissolve on the incoming clip.
 *
 * Nothing flashy, nothing at all on the first clip's head or the last clip's
 * tail — those are the start and end of the video, not joins — and nothing on a
 * seam a cut produced, which cut smoothing owns.
 *
 * Asking for no dissolve *clears* one this function previously added, so the
 * operation is symmetric: it sets the join treatment rather than only ever
 * adding to it.
 */
export function joinCommands(
  sequence: Sequence,
  options: { dissolve?: boolean; fadeSeconds?: number; dissolveSeconds?: number } = {},
): EditorCommand[] {
  const clips = orderedClips(sequence);
  if (clips.length < 2) return [];

  const fade = options.fadeSeconds ?? JOIN_FADE_SECONDS;
  const dissolveSeconds = options.dissolveSeconds ?? JOIN_DISSOLVE_SECONDS;
  const commands: EditorCommand[] = [];

  for (const [index, entry] of clips.entries()) {
    const headIsJoin = isJoin(clips[index - 1], entry);
    const tailIsJoin = isJoin(entry, clips[index + 1] ?? entry) && clips[index + 1] !== undefined;

    // A transition can never take more than a third of the clip it sits on, or
    // a two-second clip would be more dissolve than picture.
    const room = entry.duration / 3;
    const fadeIn = headIsJoin ? Math.min(fade, room) : entry.clip.fadeIn;
    const fadeOut = tailIsJoin ? Math.min(fade, room) : entry.clip.fadeOut;

    if (Math.abs(fadeIn - entry.clip.fadeIn) > 0.001 || Math.abs(fadeOut - entry.clip.fadeOut) > 0.001) {
      commands.push({ type: 'SET_FADE', clipId: entry.clip.id, fadeIn, fadeOut });
    }

    if (!headIsJoin) continue;

    if (options.dissolve) {
      const duration = Math.min(dissolveSeconds, room);
      if (duration > 0.04 && entry.clip.transitionIn?.duration !== round(duration)) {
        commands.push({
          type: 'ADD_TRANSITION',
          clipId: entry.clip.id,
          position: 'in',
          transition: { kind: 'cross-dissolve', duration: round(duration), position: 'in' },
        });
      }
    } else if (entry.clip.transitionIn) {
      commands.push({ type: 'ADD_TRANSITION', clipId: entry.clip.id, position: 'in', transition: null });
    }
  }

  return commands;
}

/** True when the clips sit end to end with no gaps and no overlaps. */
export function isContinuous(sequence: Sequence): boolean {
  const clips = orderedClips(sequence);
  let cursor = 0;
  for (const entry of clips) {
    if (Math.abs(entry.start - cursor) > 0.011) return false;
    cursor += entry.duration;
  }
  return true;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
