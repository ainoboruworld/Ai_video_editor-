'use client';

/**
 * Making the cuts disappear.
 *
 * A jump cut in a talking head fails in two ways. The audible failure is a
 * click: the waveform is severed mid-cycle and the ear hears the
 * discontinuity. A few frames of fade removes it and is itself inaudible.
 *
 * The visible failure is the speaker's head snapping to a new position, and the
 * only thing that actually hides it is a short cross-dissolve. Nothing else
 * comes close: a dip through black replaces one visible event with a different
 * visible event, and a small change of framing — which an earlier version of
 * this file used — is worse than either, because a few percent of scale is too
 * little to read as a second camera angle and too much to go unnoticed. It is a
 * visible pop introduced in the name of hiding one.
 *
 * The dissolve is built from the material the cut removed. Both halves of a
 * recut seam come from one file, so a dissolve needs frames from either side of
 * the join at the same moment — exactly what the filler word or pause that was
 * deleted provides. The outgoing clip is extended forward into that removed
 * material and the incoming clip fades up over it, so the blend happens across
 * footage nobody wanted, no kept speech is lost, and nothing downstream moves.
 * The extension is silenced with a volume envelope, so the removed "um" is seen
 * for a fraction of a second under a fading picture and never heard.
 */
import { CUT_TRANSITIONS, seamTimes, type CutTransitionKind } from '@/features/ai/cutTransitions';
import { applyCommand, type Clip, type EditorCommand, type Sequence } from '@/lib/engine';
import { mergeRanges, type Range } from '@/features/analysis/audioAnalysis';

export type SmoothingStyle = 'none' | 'audio' | 'dissolve';

export const SMOOTHING_STYLES: { id: SmoothingStyle; label: string; description: string }[] = [
  { id: 'dissolve', label: 'Invisible', description: 'Short cross-dissolve across each join. The default.' },
  { id: 'audio', label: 'Audio only', description: 'Removes the click, leaves the picture cutting hard.' },
  { id: 'none', label: 'Leave as is', description: 'Hard cuts, nothing added.' },
];

/**
 * Everything that can be put on a seam a cut leaves behind, in one list.
 *
 * Smoothing and a decorative transition cannot both own the same join — one
 * extends the outgoing clip into the removed footage, the other ramps opacity
 * across it, and stacking them produces a visible mess. So they are offered as
 * a single choice rather than two controls that quietly fight.
 *
 * Invisible is first and is the default: for a recut of one recording it is
 * almost always the right answer, and everything below it is a visible effect
 * the viewer will notice.
 */
export interface SeamOption {
  id: string;
  label: string;
  description: string;
  smoothing: SmoothingStyle;
  transition: CutTransitionKind;
}

export const SEAM_OPTIONS: SeamOption[] = [
  {
    id: 'invisible',
    label: 'Invisible',
    description: 'Cross-dissolve built from the footage the cut removed',
    smoothing: 'dissolve',
    transition: 'none',
  },
  {
    id: 'audio',
    label: 'Audio only',
    description: 'Kills the click, picture cuts hard',
    smoothing: 'audio',
    transition: 'none',
  },
  { id: 'none', label: 'Hard cut', description: 'Leave the joins untouched', smoothing: 'none', transition: 'none' },
  ...CUT_TRANSITIONS.filter((entry) => entry.kind !== 'none').map((entry) => ({
    id: entry.kind,
    label: entry.label,
    description: entry.description,
    smoothing: 'none' as SmoothingStyle,
    transition: entry.kind,
  })),
];

export const DEFAULT_SEAM_OPTION = SEAM_OPTIONS[0]!;

export function seamOption(id: string): SeamOption {
  return SEAM_OPTIONS.find((entry) => entry.id === id) ?? DEFAULT_SEAM_OPTION;
}

/** Long enough to hide a head jump, short enough not to read as an effect. */
const DISSOLVE_SECONDS = 0.18;
/** A few frames. Long enough to kill the click, short enough to be inaudible. */
const AUDIO_FADE_SECONDS = 0.045;
/** Below this a dissolve is just a flicker; fall back to fading the audio only. */
const MIN_DISSOLVE_SECONDS = 0.06;
/** A dissolve never takes more than this share of either clip it joins. */
const MAX_CLIP_SHARE = 0.4;
/** A clip too short to carry a fade is left alone rather than fading end to end. */
const MIN_CLIP_FOR_FADE = 0.25;

export interface SmoothingResult {
  commands: EditorCommand[];
  /** Joins that got audio treatment. */
  seams: number;
  /** Joins that got a real cross-dissolve. */
  dissolved: number;
}

/**
 * Builds the smoothing commands for a set of cuts.
 *
 * `sequence` is the timeline before the cuts; the cut commands are replayed
 * against a copy so the smoothing lands on the clips that survive. The cut
 * lengths matter: they are the handles the dissolve is made from, so a seam can
 * only dissolve for as long as the material removed there.
 */
export function smoothingCommands(input: {
  sequence: Sequence;
  cutCommands: EditorCommand[];
  cuts: Range[];
  style: SmoothingStyle;
  trackIds?: string[];
}): SmoothingResult {
  const empty: SmoothingResult = { commands: [], seams: 0, dissolved: 0 };
  if (input.style === 'none') return empty;

  let cut: Sequence;
  try {
    cut = input.cutCommands.reduce(applyCommand, input.sequence);
  } catch {
    return empty;
  }

  const merged = mergeRanges(input.cuts).sort((a, b) => a.start - b.start);
  const seams = seamTimes(input.cuts).map((time, index) => ({
    time,
    // How much footage was removed here, and so how long a dissolve can run.
    handle: merged[index] ? merged[index]!.end - merged[index]!.start : 0,
  }));

  return smooth({ sequence: cut, seams, style: input.style, trackIds: input.trackIds });
}

/**
 * Smooths joins already on the timeline, where the size of the removed material
 * is no longer known. The handle is assumed to be whatever the outgoing clip's
 * source continues into.
 */
export function smoothSeams(input: {
  sequence: Sequence;
  seams: number[];
  style: SmoothingStyle;
  trackIds?: string[];
}): SmoothingResult {
  return smooth({
    sequence: input.sequence,
    seams: input.seams.map((time) => ({ time, handle: DISSOLVE_SECONDS })),
    style: input.style,
    trackIds: input.trackIds,
  });
}

function smooth(input: {
  sequence: Sequence;
  seams: { time: number; handle: number }[];
  style: SmoothingStyle;
  trackIds?: string[];
}): SmoothingResult {
  const { style } = input;
  if (style === 'none') return { commands: [], seams: 0, dissolved: 0 };

  const tracks = input.trackIds
    ? input.sequence.tracks.filter((track) => input.trackIds?.includes(track.id))
    : input.sequence.tracks;

  const commands: EditorCommand[] = [];
  const fades = new Map<string, { fadeIn?: number; fadeOut?: number }>();
  let seamCount = 0;
  let dissolved = 0;

  for (const track of tracks) {
    if (track.kind !== 'video' && track.kind !== 'audio') continue;
    const visual = track.kind === 'video';

    for (const seam of input.seams) {
      const outgoing = track.clips.find((clip) => Math.abs(clip.start + clip.duration - seam.time) < 0.02);
      const incoming = track.clips.find((clip) => Math.abs(clip.start - seam.time) < 0.02);
      if (!outgoing || !incoming || outgoing.id === incoming.id) continue;
      if (visual) seamCount += 1;

      const span = dissolveSpan(seam.handle, outgoing, incoming);
      const canDissolve = style === 'dissolve' && visual && span >= MIN_DISSOLVE_SECONDS;

      if (!canDissolve) {
        queueFade(fades, outgoing, 'fadeOut', AUDIO_FADE_SECONDS);
        queueFade(fades, incoming, 'fadeIn', AUDIO_FADE_SECONDS);
        continue;
      }

      dissolved += 1;
      const extended = outgoing.duration + span;

      // Carry the outgoing picture on into the removed material…
      commands.push({ type: 'TRIM_CLIP', clipId: outgoing.id, start: outgoing.start, duration: extended });
      // …but not its sound: the envelope closes at the original cut point, so
      // the deleted filler is briefly seen and never heard.
      commands.push({
        type: 'SET_KEYFRAMES',
        clipId: outgoing.id,
        prop: 'volume',
        keyframes: [
          { time: 0, value: outgoing.volume },
          { time: Math.max(0, extended - span - AUDIO_FADE_SECONDS), value: outgoing.volume },
          { time: Math.max(0.01, extended - span), value: 0 },
          { time: extended, value: 0 },
        ],
      });
      // …while the incoming picture fades up over it.
      commands.push({
        type: 'ADD_TRANSITION',
        clipId: incoming.id,
        position: 'in',
        transition: { kind: 'cross-dissolve', duration: span, position: 'in' },
      });
      queueFade(fades, incoming, 'fadeIn', AUDIO_FADE_SECONDS);
    }
  }

  // One SET_FADE per clip: a clip between two cuts needs both sides set at once.
  for (const [clipId, fade] of fades) {
    commands.push({ type: 'SET_FADE', clipId, ...fade });
  }

  return { commands, seams: seamCount, dissolved };
}

/**
 * How long the dissolve can run here.
 *
 * Bounded by the material the cut removed — dissolving for longer than that
 * would reach into speech that was kept — and by both clips, so a short one is
 * never mostly transition.
 */
function dissolveSpan(handle: number, outgoing: Clip, incoming: Clip): number {
  return Math.min(
    DISSOLVE_SECONDS,
    handle * 0.9,
    outgoing.duration * MAX_CLIP_SHARE,
    incoming.duration * MAX_CLIP_SHARE,
  );
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
