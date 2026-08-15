'use client';

/**
 * Making the cuts sound and look smooth.
 *
 * A jump cut in a talking head fails in two ways, and they need different
 * fixes. The audible failure is a click: the waveform is severed mid-cycle and
 * the ear hears the discontinuity. A few frames of fade on each side removes it
 * completely, and is inaudible in itself. The visible failure is the speaker's
 * head snapping to a new position, and the standard fix is not a transition at
 * all — it is a small change of framing across the cut, so the edit reads as a
 * second camera angle rather than a mistake.
 *
 * That is why the default here is not a dissolve. Dissolving a talking head to
 * itself looks like a ghost, and this editor cannot do a true cross-dissolve at
 * a same-source seam anyway: both sides come from one file and the media pool
 * holds one element per asset.
 */
import { seamTimes } from '@/features/ai/cutTransitions';
import { applyCommand, type Clip, type EditorCommand, type Sequence } from '@/lib/engine';
import type { Range } from '@/features/analysis/audioAnalysis';

export type SmoothingStyle = 'none' | 'audio' | 'subtle' | 'dip';

export const SMOOTHING_STYLES: { id: SmoothingStyle; label: string; description: string }[] = [
  { id: 'subtle', label: 'Natural', description: 'Audio fade plus a slight reframe. Barely noticeable.' },
  { id: 'audio', label: 'Audio only', description: 'Removes the click, leaves the picture alone.' },
  { id: 'dip', label: 'Soft dip', description: 'A very short fade through black at each cut.' },
  { id: 'none', label: 'Leave as is', description: 'Hard cuts, nothing added.' },
];

/** A few frames. Long enough to kill the click, short enough to be inaudible. */
const AUDIO_FADE_SECONDS = 0.045;
/** How much the framing shifts across a cut. Above ~6% it starts to read as an effect. */
const PUNCH_SCALE = 1.035;
const DIP_SECONDS = 0.12;
/** A clip too short to carry a fade is left alone rather than fading end to end. */
const MIN_CLIP_FOR_FADE = 0.25;

export interface SmoothingResult {
  commands: EditorCommand[];
  /** Joins that got audio treatment. */
  seams: number;
  /** Clips that got a reframe. */
  reframed: number;
}

/**
 * Builds the smoothing commands for a set of cuts.
 *
 * `sequence` is the timeline before the cuts; the cut commands are replayed
 * against a copy so the smoothing lands on the clips that survive.
 */
export function smoothingCommands(input: {
  sequence: Sequence;
  cutCommands: EditorCommand[];
  cuts: Range[];
  style: SmoothingStyle;
  trackIds?: string[];
}): SmoothingResult {
  const empty: SmoothingResult = { commands: [], seams: 0, reframed: 0 };
  if (input.style === 'none') return empty;

  let cut: Sequence;
  try {
    cut = input.cutCommands.reduce(applyCommand, input.sequence);
  } catch {
    return empty;
  }

  return smoothSeams({ sequence: cut, seams: seamTimes(input.cuts), style: input.style, trackIds: input.trackIds });
}

/** Smooths joins that are already on the timeline, at the given times. */
export function smoothSeams(input: {
  sequence: Sequence;
  seams: number[];
  style: SmoothingStyle;
  trackIds?: string[];
}): SmoothingResult {
  const { style } = input;
  if (style === 'none') return { commands: [], seams: 0, reframed: 0 };

  const tracks = input.trackIds
    ? input.sequence.tracks.filter((track) => input.trackIds?.includes(track.id))
    : input.sequence.tracks;

  const commands: EditorCommand[] = [];
  const fades = new Map<string, { fadeIn?: number; fadeOut?: number }>();
  const reframed = new Set<string>();
  let seams = 0;

  for (const track of tracks) {
    if (track.kind !== 'video' && track.kind !== 'audio') continue;

    // Framing alternates along the track so consecutive cuts do not drift ever
    // further in; the picture goes near, far, near.
    let alternate = false;

    for (const time of input.seams) {
      const outgoing = track.clips.find((clip) => Math.abs(clip.start + clip.duration - time) < 0.02);
      const incoming = track.clips.find((clip) => Math.abs(clip.start - time) < 0.02);
      if (!outgoing || !incoming || outgoing.id === incoming.id) continue;
      seams += 1;

      queueFade(fades, outgoing, 'fadeOut', AUDIO_FADE_SECONDS);
      queueFade(fades, incoming, 'fadeIn', AUDIO_FADE_SECONDS);

      if (style === 'subtle' && track.kind === 'video') {
        alternate = !alternate;
        // Only the incoming side moves: the outgoing shot keeps whatever framing
        // it already had, so the change happens exactly on the cut.
        if (!reframed.has(incoming.id)) {
          reframed.add(incoming.id);
          commands.push({
            type: 'CHANGE_TRANSFORM',
            clipId: incoming.id,
            transform: { scale: incoming.transform.scale * (alternate ? PUNCH_SCALE : 1) },
          });
        }
      }

      if (style === 'dip' && track.kind === 'video') {
        const outSeconds = Math.min(DIP_SECONDS / 2, outgoing.duration * 0.4);
        const inSeconds = Math.min(DIP_SECONDS / 2, incoming.duration * 0.4);
        commands.push({
          type: 'ADD_TRANSITION',
          clipId: outgoing.id,
          position: 'out',
          transition: { kind: 'dip-to-black', duration: outSeconds, position: 'out' },
        });
        commands.push({
          type: 'ADD_TRANSITION',
          clipId: incoming.id,
          position: 'in',
          transition: { kind: 'dip-to-black', duration: inSeconds, position: 'in' },
        });
      }
    }
  }

  // One SET_FADE per clip: a clip between two cuts needs both sides set at once.
  for (const [clipId, fade] of fades) {
    commands.push({ type: 'SET_FADE', clipId, ...fade });
  }

  return { commands, seams: Math.round(seams / Math.max(1, countedTracks(tracks))), reframed: reframed.size };
}

function countedTracks(tracks: { kind: string }[]): number {
  return Math.max(1, tracks.filter((track) => track.kind === 'video').length);
}

function queueFade(
  fades: Map<string, { fadeIn?: number; fadeOut?: number }>,
  clip: Clip,
  side: 'fadeIn' | 'fadeOut',
  seconds: number,
): void {
  if (clip.duration < MIN_CLIP_FOR_FADE) return;
  const entry = fades.get(clip.id) ?? {};
  // Never let the two fades meet in the middle of a short clip.
  entry[side] = Math.min(seconds, clip.duration * 0.3);
  fades.set(clip.id, entry);
}
