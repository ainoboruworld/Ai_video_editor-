/**
 * Turning a decision about one seam into engine commands.
 *
 * Each technique here is a real edit on the real timeline — the preview and the
 * exported file read the same clips, so nothing in this file can look right in
 * one and wrong in the other.
 *
 * The two new ones are worth explaining:
 *
 * **Punch-in** is a small change of scale on the incoming clip. It works because
 * a viewer reads a reframe as a second camera rather than as an effect, which is
 * exactly what a jump cut fails to be. It has to stay small — five percent — and
 * it has to alternate, or a run of punch-ins walks the framing steadily tighter
 * until the speaker is in close-up for no reason.
 *
 * **J and L cuts** separate the sound from the picture. At a change between two
 * recordings the picture is going to jump whatever we do, so the fix is to stop
 * the ear noticing at the same moment as the eye: the outgoing audio holds over
 * the new picture (L), or the incoming audio arrives before its picture does
 * (J). The bridging audio is a real clip on the audio track, sourced from the
 * same asset at the same source time, so it is the same performance rather than
 * a fabrication.
 */
import { makeClip, trackByRole, type Clip, type EditorCommand, type Sequence } from '@/lib/engine';
import type { CutJudgement } from './cutJudgement';

/** A seam, resolved to the clips either side of it. */
export interface ResolvedSeam {
  time: number;
  outgoing: Clip;
  incoming: Clip;
  trackId: string;
}

const AUDIO_FADE_SECONDS = 0.045;
const MIN_CLIP_FOR_FADE = 0.25;

export interface TechniqueResult {
  commands: EditorCommand[];
  /** Techniques that produced nothing, and why — surfaced rather than hidden. */
  skipped: { time: number; reason: string }[];
}

/**
 * Builds the commands for a set of judged seams.
 *
 * Fades are collected per clip and emitted once at the end, because a clip
 * between two treated seams needs both its sides set in a single command.
 * `newId` is injected so the caller controls id generation and tests stay
 * deterministic.
 */
export function techniqueCommands(input: {
  sequence: Sequence;
  seams: { seam: ResolvedSeam; judgement: CutJudgement }[];
  newId: (prefix: string) => string;
}): TechniqueResult {
  const commands: EditorCommand[] = [];
  const skipped: { time: number; reason: string }[] = [];
  const fades = new Map<string, { fadeIn?: number; fadeOut?: number }>();
  // Alternates so a run of punch-ins does not creep the framing tighter.
  let punchDirection = 1;

  for (const { seam, judgement } of input.seams) {
    switch (judgement.technique) {
      case 'clean':
        // Deliberately nothing. This is the point of the whole exercise.
        break;

      case 'audio-crossfade':
        queueFade(fades, seam.outgoing, 'fadeOut', judgement.parameters.seconds ?? AUDIO_FADE_SECONDS);
        queueFade(fades, seam.incoming, 'fadeIn', judgement.parameters.seconds ?? AUDIO_FADE_SECONDS);
        break;

      case 'punch-in': {
        const scale = judgement.parameters.scale ?? 1.05;
        // Away from whatever the outgoing clip was at, so consecutive punches
        // go in and then back out rather than compounding.
        const target = punchDirection > 0 ? scale : 1;
        punchDirection *= -1;
        commands.push({
          type: 'CHANGE_TRANSFORM',
          clipId: seam.incoming.id,
          transform: { scale: round(target) },
        });
        queueFade(fades, seam.outgoing, 'fadeOut', AUDIO_FADE_SECONDS);
        queueFade(fades, seam.incoming, 'fadeIn', AUDIO_FADE_SECONDS);
        break;
      }

      case 'dissolve': {
        const span = judgement.parameters.seconds ?? 0;
        if (span <= 0) {
          skipped.push({ time: seam.time, reason: 'No removed footage to dissolve through.' });
          break;
        }
        commands.push(...dissolveCommands(seam, span));
        queueFade(fades, seam.incoming, 'fadeIn', AUDIO_FADE_SECONDS);
        break;
      }

      case 'l-cut':
      case 'j-cut': {
        const bridge = audioBridge(input.sequence, seam, judgement, input.newId);
        if (!bridge) {
          skipped.push({
            time: seam.time,
            reason: 'No audio track free at this moment, so the audio could not be carried across.',
          });
          queueFade(fades, seam.outgoing, 'fadeOut', AUDIO_FADE_SECONDS);
          queueFade(fades, seam.incoming, 'fadeIn', AUDIO_FADE_SECONDS);
          break;
        }
        commands.push(...bridge);
        break;
      }

      case 'broll':
        // Proposed, never placed: B-roll is a content decision and belongs to
        // the B-roll step, where the user picks the shot.
        skipped.push({ time: seam.time, reason: 'Proposed for B-roll cover — pick a clip in the B-roll step.' });
        break;
    }
  }

  for (const [clipId, fade] of fades) {
    commands.push({ type: 'SET_FADE', clipId, ...fade });
  }

  return { commands, skipped };
}

/**
 * The invisible dissolve: the outgoing picture carries on into the footage the
 * cut removed while the incoming picture fades up over it, and a volume
 * envelope silences the extension so the removed words are never heard.
 */
function dissolveCommands(seam: ResolvedSeam, span: number): EditorCommand[] {
  const { outgoing, incoming } = seam;
  const extended = outgoing.duration + span;
  return [
    { type: 'TRIM_CLIP', clipId: outgoing.id, start: outgoing.start, duration: extended },
    {
      type: 'SET_KEYFRAMES',
      clipId: outgoing.id,
      prop: 'volume',
      keyframes: [
        { time: 0, value: outgoing.volume },
        { time: Math.max(0, extended - span - AUDIO_FADE_SECONDS), value: outgoing.volume },
        { time: Math.max(0.01, extended - span), value: 0 },
        { time: extended, value: 0 },
      ],
    },
    {
      type: 'ADD_TRANSITION',
      clipId: incoming.id,
      position: 'in',
      transition: { kind: 'cross-dissolve', duration: round(span), position: 'in' },
    },
  ];
}

/**
 * Carries sound across a picture change.
 *
 * An **L-cut** holds the outgoing clip's audio over the start of the new shot;
 * a **J-cut** brings the new clip's audio in before its picture. Either way the
 * bridging audio is a real clip on the audio track, taken from the same asset at
 * the source time that audio actually occupies, and the video clip it came from
 * is faded under it so the same sound is not heard twice.
 *
 * Returns null when there is no room on the audio track, which is a real
 * outcome rather than something to paper over.
 */
function audioBridge(
  sequence: Sequence,
  seam: ResolvedSeam,
  judgement: CutJudgement,
  newId: (prefix: string) => string,
): EditorCommand[] | null {
  const track = trackByRole(sequence, 'voiceover') ?? trackByRole(sequence, 'audio');
  if (!track) return null;

  const isL = judgement.technique === 'l-cut';
  const donor = isL ? seam.outgoing : seam.incoming;
  if (!donor.assetId) return null;

  const span = Math.min(
    judgement.parameters.seconds ?? 0.32,
    seam.outgoing.duration * 0.4,
    seam.incoming.duration * 0.4,
  );
  if (span < 0.08) return null;

  // Where the bridge sits on the timeline, and which source seconds it plays.
  const start = isL ? seam.time : seam.time - span;
  const sourceIn = isL
    ? // The outgoing performance continuing past where its picture stops.
      donor.sourceIn + donor.duration * donor.speed
    : // The incoming performance's opening, pulled earlier than its picture.
      donor.sourceIn;

  if (start < 0) return null;
  const clash = track.clips.some((clip) => start < clip.start + clip.duration && clip.start < start + span);
  if (clash) return null;

  const bridge = makeClip({
    id: newId('bridge'),
    kind: 'audio',
    name: isL ? 'L-cut bridge' : 'J-cut bridge',
    assetId: donor.assetId,
    start: round(start),
    duration: round(span),
    sourceIn: round(Math.max(0, sourceIn)),
    speed: donor.speed,
    volume: donor.volume,
    fadeIn: isL ? 0 : Math.min(0.08, span * 0.3),
    fadeOut: isL ? Math.min(0.12, span * 0.4) : 0,
  });

  const commands: EditorCommand[] = [{ type: 'ADD_CLIP', trackId: track.id, clip: bridge }];

  // Duck the clip whose own audio the bridge is standing in for, so the two do
  // not sound at once.
  const under = isL ? seam.incoming : seam.outgoing;
  commands.push({
    type: 'SET_KEYFRAMES',
    clipId: under.id,
    prop: 'volume',
    keyframes: isL
      ? [
          { time: 0, value: 0 },
          { time: Math.min(span, under.duration), value: under.volume },
          { time: under.duration, value: under.volume },
        ]
      : [
          { time: 0, value: under.volume },
          { time: Math.max(0, under.duration - span), value: under.volume },
          { time: under.duration, value: 0 },
        ],
  });

  return commands;
}

function queueFade(
  fades: Map<string, { fadeIn?: number; fadeOut?: number }>,
  clip: Clip,
  side: 'fadeIn' | 'fadeOut',
  seconds: number,
): void {
  if (clip.duration < MIN_CLIP_FOR_FADE) return;
  const entry = fades.get(clip.id) ?? {};
  entry[side] = Math.min(seconds, clip.duration * 0.3);
  fades.set(clip.id, entry);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
