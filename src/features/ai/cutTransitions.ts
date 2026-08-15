'use client';

/**
 * Transitions at recut seams.
 *
 * Removing a range leaves the two surviving halves butt-joined, which reads as
 * a jump cut. This module finds those seams after the cuts have been applied
 * and attaches a transition to each side of them.
 *
 * The two sides of a recut seam come from the *same* source file, and the media
 * pool holds one element per asset, so there is no second decode to blend
 * against — a true cross-dissolve is not available here and is not offered.
 * What is offered are the transitions that genuinely work on a butt joint: the
 * outgoing side plays out over the first half and the incoming side plays in
 * over the second, which is exactly how a dip or a fade is built.
 */
import { mergeRanges, type Range } from '@/features/analysis/audioAnalysis';
import { applyCommand, type EditorCommand, type Sequence, type TransitionKind } from '@/lib/engine';

/** `none` leaves the hard cut alone; the rest are engine transition kinds. */
export type CutTransitionKind = 'none' | Extract<TransitionKind, 'fade' | 'dip-to-black' | 'dip-to-white' | 'slide' | 'zoom' | 'blur'>;

export interface CutTransitionChoice {
  kind: CutTransitionKind;
  /** Total length of the transition, split evenly across the seam. */
  seconds: number;
}

export const CUT_TRANSITIONS: { kind: CutTransitionKind; label: string; description: string }[] = [
  { kind: 'none', label: 'Hard cut', description: 'Leave the joins untouched' },
  { kind: 'fade', label: 'Fade', description: 'Out and back through the background' },
  { kind: 'dip-to-black', label: 'Dip to black', description: 'Through black' },
  { kind: 'dip-to-white', label: 'Flash', description: 'Through white' },
  { kind: 'blur', label: 'Blur', description: 'Soften across the join' },
  { kind: 'slide', label: 'Slide', description: 'Push horizontally' },
  { kind: 'zoom', label: 'Zoom', description: 'Punch in and settle' },
];

export const DEFAULT_CUT_TRANSITION: CutTransitionChoice = { kind: 'fade', seconds: 0.3 };

/** Shortest seam a transition is worth putting on, and the longest it may run. */
const MIN_TRANSITION_SECONDS = 0.08;
export const MAX_TRANSITION_SECONDS = 1.5;
/** A transition never eats more than this share of the clip it sits on. */
const MAX_CLIP_SHARE = 0.4;
const EPSILON = 0.02;

/**
 * Where the joins land once the cuts have been applied.
 *
 * Each ripple delete pulls everything after it earlier by its own length, so a
 * cut's seam ends up at its start minus the total length of every earlier cut.
 * A cut that runs off either end of the timeline is not a seam — it has only
 * one side — and the caller's clip lookup drops it.
 */
export function seamTimes(cuts: Range[]): number[] {
  const merged = mergeRanges(cuts).sort((a, b) => a.start - b.start);
  const seams: number[] = [];
  let removed = 0;
  for (const cut of merged) {
    seams.push(cut.start - removed);
    removed += cut.end - cut.start;
  }
  return seams;
}

/**
 * Builds the `ADD_TRANSITION` commands for a set of cuts.
 *
 * `sequence` is the timeline *before* the cuts; the cut commands are replayed
 * against a throwaway copy so the seams can be matched to the clips that
 * actually survive, rather than to clips the cuts are about to destroy.
 */
export function cutTransitionCommands(input: {
  sequence: Sequence;
  cutCommands: EditorCommand[];
  cuts: Range[];
  choice: CutTransitionChoice;
  trackIds?: string[];
}): EditorCommand[] {
  const { sequence, cutCommands, cuts, choice } = input;
  if (choice.kind === 'none') return [];

  const seconds = Math.min(MAX_TRANSITION_SECONDS, Math.max(0, choice.seconds));
  if (seconds < MIN_TRANSITION_SECONDS) return [];

  let cutSequence: Sequence;
  try {
    cutSequence = cutCommands.reduce(applyCommand, sequence);
  } catch {
    // If the cuts themselves will not apply there is nothing to decorate; the
    // caller's own apply() will surface the failure.
    return [];
  }

  const tracks = input.trackIds
    ? cutSequence.tracks.filter((track) => input.trackIds?.includes(track.id))
    : cutSequence.tracks;
  const half = seconds / 2;
  const commands: EditorCommand[] = [];

  for (const time of seamTimes(cuts)) {
    for (const track of tracks) {
      if (track.kind !== 'video') continue;

      const outgoing = track.clips.find((clip) => Math.abs(clip.start + clip.duration - time) < EPSILON);
      const incoming = track.clips.find((clip) => Math.abs(clip.start - time) < EPSILON);
      // A seam needs both sides. Cuts at the very start or end of the timeline
      // have only one, and fading the open edge would be a different edit than
      // the one the user asked for.
      if (!outgoing || !incoming || outgoing.id === incoming.id) continue;

      const outSeconds = Math.min(half, outgoing.duration * MAX_CLIP_SHARE);
      const inSeconds = Math.min(half, incoming.duration * MAX_CLIP_SHARE);
      if (outSeconds < MIN_TRANSITION_SECONDS / 2 || inSeconds < MIN_TRANSITION_SECONDS / 2) continue;

      commands.push({
        type: 'ADD_TRANSITION',
        clipId: outgoing.id,
        position: 'out',
        transition: { kind: choice.kind, duration: outSeconds, position: 'out' },
      });
      commands.push({
        type: 'ADD_TRANSITION',
        clipId: incoming.id,
        position: 'in',
        transition: { kind: choice.kind, duration: inSeconds, position: 'in' },
      });
    }
  }

  return commands;
}

/** How many seams a transition choice would actually decorate. */
export function countSeams(commands: EditorCommand[]): number {
  return commands.filter((command) => command.type === 'ADD_TRANSITION' && command.position === 'in').length;
}

export function cutTransitionLabel(kind: CutTransitionKind): string {
  return CUT_TRANSITIONS.find((entry) => entry.kind === kind)?.label ?? kind;
}
