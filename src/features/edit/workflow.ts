/**
 * The editing workflow.
 *
 * The product has one job — get a talking-head recording edited faster — and
 * this is the order that job happens in. The steps are a guide, not a wizard:
 * every one of them is optional except having a video, the user can jump
 * backwards at any point, and each step's "done" state is read off the actual
 * project rather than remembered, so undoing an edit un-completes its step.
 */
import { sequenceDuration, trackByRole, type Sequence } from '@/lib/engine';

export type StepId =
  | 'video'
  | 'transcript'
  | 'fillers'
  | 'lines'
  | 'pauses'
  | 'smooth'
  | 'template'
  | 'music'
  | 'broll'
  | 'captions'
  | 'export';

export interface StepDefinition {
  id: StepId;
  title: string;
  /** One line on why this step exists. */
  blurb: string;
  /** False for the one step that is not optional. */
  optional: boolean;
}

export const STEPS: StepDefinition[] = [
  { id: 'video', title: 'Your clips', blurb: 'Upload one recording or several, in the order they play.', optional: false },
  { id: 'transcript', title: 'Transcript', blurb: 'Everything downstream reads from this.', optional: true },
  { id: 'fillers', title: 'Remove fillers', blurb: 'Cut the ums and ahs you agree with.', optional: true },
  {
    id: 'lines',
    title: 'Cut unnecessary lines',
    blurb: 'Repeats, false starts, corrections and rambling — reviewed one by one.',
    optional: true,
  },
  { id: 'pauses', title: 'Trim pauses', blurb: 'Shorten the dead air without flattening the pacing.', optional: true },
  { id: 'smooth', title: 'Smooth the cuts', blurb: 'Take the click and the jump out of each join.', optional: true },
  {
    id: 'template',
    title: 'Reference style',
    blurb: 'Match the pacing and look of a video you like. Style only, never its footage.',
    optional: true,
  },
  { id: 'music', title: 'Background music', blurb: 'Add a bed that ducks under the voice.', optional: true },
  { id: 'broll', title: 'B-roll', blurb: 'Cover the moments that need a picture.', optional: true },
  { id: 'captions', title: 'Captions', blurb: 'Built from the final transcript.', optional: true },
  { id: 'export', title: 'Preview and export', blurb: 'Watch it back, then write the file.', optional: true },
];

export interface StepState {
  /** Whether the project shows evidence this step has been done. */
  done: boolean;
  /** Short status line, e.g. "6 cuts" or "not yet". */
  detail: string;
}

export interface WorkflowInput {
  sequence: Sequence | null;
  transcriptSegments: number;
  /** Filler candidates the user has accepted and applied. */
  appliedCuts: number;
  hasPauseCuts: boolean;
  /** Smart-cut candidates found in the transcript, and how many are accepted. */
  lineCandidates?: number;
  linesAccepted?: number;
  /** Name of the template applied to this project, if any. */
  templateApplied?: string | null;
}

/**
 * Reads each step's state out of the project.
 *
 * Deliberately derived rather than stored: if the user undoes the cuts, the
 * step stops being complete, and the flow stays honest about where they are.
 */
export function workflowState(input: WorkflowInput): Record<StepId, StepState> {
  const seq = input.sequence;
  const duration = seq ? sequenceDuration(seq) : 0;

  const videoClips = seq
    ? seq.tracks.filter((track) => track.kind === 'video').flatMap((track) => track.clips)
    : [];
  const primaryClips = videoClips.filter((clip) => clip.assetId);
  const brollTrack = seq ? trackByRole(seq, 'broll') : null;
  const musicTrack = seq ? trackByRole(seq, 'music') : null;
  const captionTrack = seq ? trackByRole(seq, 'caption') : null;

  const smoothed = videoClips.filter(
    (clip) => clip.fadeIn > 0 || clip.fadeOut > 0 || clip.transitionIn || clip.transitionOut,
  ).length;
  const musicClips = musicTrack?.clips ?? [];
  const ducked = musicClips.filter((clip) => (clip.keyframes.volume?.length ?? 0) > 1).length;

  return {
    video: {
      done: primaryClips.length > 0,
      detail:
        primaryClips.length === 0
          ? 'no video yet'
          : primaryClips.length === 1
            ? formatDuration(duration)
            : `${primaryClips.length} clips · ${formatDuration(duration)}`,
    },
    transcript: {
      done: input.transcriptSegments > 0,
      detail: input.transcriptSegments > 0 ? `${input.transcriptSegments} segments` : 'not yet',
    },
    fillers: {
      done: input.appliedCuts > 0,
      detail: input.appliedCuts > 0 ? `${input.appliedCuts} cuts applied` : 'not yet',
    },
    lines: {
      done: (input.linesAccepted ?? 0) > 0,
      detail:
        (input.lineCandidates ?? 0) === 0
          ? input.transcriptSegments > 0
            ? 'nothing found'
            : 'needs a transcript'
          : `${input.linesAccepted ?? 0} of ${input.lineCandidates} selected`,
    },
    pauses: {
      done: input.hasPauseCuts,
      detail: input.hasPauseCuts ? 'trimmed' : 'not yet',
    },
    smooth: {
      done: smoothed > 0,
      detail: smoothed > 0 ? `${smoothed} clips smoothed` : 'not yet',
    },
    template: {
      done: Boolean(input.templateApplied),
      detail: input.templateApplied ?? 'none',
    },
    music: {
      done: musicClips.length > 0,
      detail: musicClips.length === 0 ? 'none' : ducked > 0 ? 'added, ducking on' : 'added',
    },
    broll: {
      done: (brollTrack?.clips.length ?? 0) > 0,
      detail: brollTrack?.clips.length ? `${brollTrack.clips.length} clips` : 'none',
    },
    captions: {
      done: (captionTrack?.clips.length ?? 0) > 0,
      detail: captionTrack?.clips.length ? `${captionTrack.clips.length} cues` : 'none',
    },
    export: {
      done: false,
      detail: primaryClips.length > 0 ? formatDuration(duration) : 'nothing to export',
    },
  };
}

/** The step the user should look at next: the first unfinished one that can run. */
export function suggestedStep(state: Record<StepId, StepState>): StepId {
  if (!state.video.done) return 'video';
  if (!state.transcript.done) return 'transcript';
  if (!state.fillers.done) return 'fillers';
  if (!state.lines.done) return 'lines';
  if (!state.pauses.done) return 'pauses';
  if (!state.smooth.done) return 'smooth';
  if (!state.captions.done) return 'captions';
  return 'export';
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
