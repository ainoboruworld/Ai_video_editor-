'use client';

/**
 * Applying a measured style to the real timeline.
 *
 * A template changes *how* this project is cut, never what is in it. It can
 * make the pacing tighter, decide whether joins are hard or dissolved, put the
 * captions where the reference puts them, and set how far music ducks. It
 * cannot add shots the footage does not contain, and it never touches the
 * reference's own media — that footage belongs to whoever made it.
 *
 * Intensity is a single weight applied to every setting: Low moves a third of
 * the way from where the project is now to where the reference sits, High goes
 * all the way. That keeps "apply at Low" meaning the same thing everywhere
 * rather than being a different rule per setting.
 */
import { trackByRole, type EditorCommand, type Sequence } from '@/lib/engine';
import { isJoin, joinCommands, orderedClips } from '@/features/edit/clips';
import { DUCKING_DEFAULTS } from '@/features/edit/ducking';
import { DEFAULT_AGGRESSION } from '@/features/edit/pauses';
import type { SmoothingStyle } from '@/features/edit/smoothing';
import { INTENSITY_WEIGHT, type StyleProfile, type TemplateIntensity } from './profile';
import type { CaptionStyleName } from '@/lib/engine';

export interface TemplatePlan {
  /** Pause-trim aggression the template wants, 0..1. */
  aggression: number;
  /** How the seams a cut leaves behind should be treated. */
  smoothing: SmoothingStyle;
  /** Whether joins between separate clips get a dissolve. */
  joinDissolve: boolean;
  /** Caption preset to switch existing captions to, if any. */
  captionStyle: CaptionStyleName | null;
  /** Music levels, when the reference had music. */
  ducking: { bed: number; ducked: number } | null;
  /** Commands that can be applied right now, as one undoable batch. */
  commands: EditorCommand[];
  /** What this will actually do, in the user's words. */
  effects: string[];
  /** What it will not do, and why. */
  skipped: string[];
}

/** Which caption preset sits closest to a measured band. */
const BAND_PRESET: Record<string, CaptionStyleName> = {
  // Presets differ in vertical position; these are the closest matches.
  lower: 'minimal',
  centre: 'dynamic',
  top: 'dynamic',
};

/**
 * Works out what applying this profile would do, without doing it.
 *
 * Returned rather than executed so the panel can show the plan first: a style
 * transplant that silently retimes someone's video is exactly the kind of
 * "magic" that makes an editor stop trusting the tool.
 */
export function planTemplate(input: {
  sequence: Sequence;
  profile: StyleProfile;
  intensity: TemplateIntensity;
  /** Where the pause slider is now, so Low can move part of the way from it. */
  currentAggression?: number;
}): TemplatePlan {
  const { sequence, profile } = input;
  const weight = INTENSITY_WEIGHT[input.intensity];
  const effects: string[] = [];
  const skipped: string[] = [];
  const commands: EditorCommand[] = [];

  // ---- pacing -------------------------------------------------------------
  const current = input.currentAggression ?? DEFAULT_AGGRESSION;
  const target = aggressionForShotLength(profile.pacing.averageShotSeconds);
  const aggression = round(current + (target - current) * weight);
  if (Math.abs(aggression - current) > 0.01) {
    effects.push(
      `Pause trimming moves to ${Math.round(aggression * 100)}% to match ${profile.pacing.averageShotSeconds.toFixed(1)}s shots.`,
    );
  } else {
    effects.push('Pacing already matches the reference.');
  }

  // ---- joins and seams ----------------------------------------------------
  const wantsDissolve = profile.transitions.style !== 'hard' && weight >= 0.5;
  const smoothing: SmoothingStyle = wantsDissolve ? 'dissolve' : 'audio';
  effects.push(
    wantsDissolve
      ? `Cut seams get a short dissolve — the reference dissolves ${Math.round(profile.transitions.dissolveShare * 100)}% of its joins.`
      : 'Cut seams stay hard, with an inaudible audio fade — the reference cuts hard.',
  );
  if (profile.transitions.style === 'dip') {
    skipped.push('The reference dips through black at some joins. A dissolve is used instead: dipping mid-sentence in a talking head reads as an error.');
  }

  // Count real joins, not clips: two halves of one recording left by a cut are
  // a seam that cut smoothing owns, not a join between takes.
  const clips = orderedClips(sequence);
  const joins = clips.filter((entry, index) => isJoin(clips[index - 1], entry)).length;
  if (joins > 0) {
    commands.push(...joinCommands(sequence, { dissolve: wantsDissolve }));
    effects.push(
      `The ${joins} join${joins === 1 ? '' : 's'} between your takes ${joins === 1 ? 'is' : 'are'} treated the same way. Seams left by cuts keep their own smoothing.`,
    );
  }

  // ---- captions -----------------------------------------------------------
  const captionTrack = trackByRole(sequence, 'caption');
  const captionClips = captionTrack?.clips ?? [];
  let captionStyle: CaptionStyleName | null = null;
  if (profile.captions.present) {
    captionStyle = BAND_PRESET[profile.captions.band] ?? 'bold';
    if (captionClips.length > 0) {
      for (const clip of captionClips) {
        commands.push({ type: 'SET_CAPTION_STYLE', clipId: clip.id, style: captionStyle });
      }
      effects.push(`${captionClips.length} captions restyled to sit ${profile.captions.band === 'lower' ? 'low in the frame' : 'centre-frame'}, like the reference.`);
    } else {
      effects.push(`Captions will use the ${captionStyle} preset when you generate them.`);
    }
  } else if (captionClips.length > 0) {
    skipped.push('The reference has no burned-in captions. Yours are left alone rather than deleted — that is your call, not the template’s.');
  }

  // ---- music --------------------------------------------------------------
  let ducking: TemplatePlan['ducking'] = null;
  if (profile.music.present) {
    const bed = round(mix(DUCKING_DEFAULTS.bed, clamp(profile.music.bedLevel, 0.05, 0.6), weight));
    // The bed level is measured; the duck ratio is this editor's own mixing
    // rule, because how far a reference ducks cannot be read off a mixed track.
    const ratio = DUCKING_DEFAULTS.ducked / DUCKING_DEFAULTS.bed;
    const ducked = round(bed * ratio);
    ducking = { bed, ducked };
    effects.push(
      `Music sits at ${Math.round(bed * 100)}%, the level measured in the reference, ducking to ${Math.round(ducked * 100)}% under speech.`,
    );
    skipped.push('How far the reference ducks its own music is not measurable from a mixed track, so this editor’s ducking curve is used at that level.');
  } else {
    skipped.push('The reference has no music bed, so no music settings are changed.');
  }

  // ---- what a template must not do ---------------------------------------
  if (profile.structure.introSeconds > 1) {
    skipped.push(
      `The reference opens with ${profile.structure.introSeconds.toFixed(1)}s before anyone speaks. An intro is content, not style — add one yourself if you want it.`,
    );
  }
  skipped.push('None of the reference’s footage, music or graphics is copied. Only the way it was cut.');

  return { aggression, smoothing, joinDissolve: wantsDissolve, captionStyle, ducking, commands, effects, skipped };
}

/**
 * Maps a reference's average shot length onto the pause-trim slider.
 *
 * The slider's own range runs from "cut pauses over 2.0s" at 0 to "over 0.28s"
 * at 1. A reference that holds eight-second shots wants the conservative end; a
 * two-second-shot edit wants the aggressive end. Anything faster than about a
 * second is beyond what pause trimming alone can produce, so it clamps rather
 * than pretending.
 */
export function aggressionForShotLength(averageShotSeconds: number): number {
  if (!Number.isFinite(averageShotSeconds) || averageShotSeconds <= 0) return DEFAULT_AGGRESSION;
  const SLOW = 8;
  const FAST = 1.5;
  const t = (SLOW - averageShotSeconds) / (SLOW - FAST);
  return round(clamp(t, 0, 1));
}

function mix(from: number, to: number, weight: number): number {
  return from + (to - from) * weight;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
