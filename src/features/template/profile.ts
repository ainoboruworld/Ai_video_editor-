/**
 * What an editing style actually is, measured.
 *
 * A "template" here is not a project to copy — copying the reference's media
 * would be taking someone else's footage. It is a description of *how* the
 * reference was cut, in numbers that can be read off the file itself: how often
 * it cuts, how long its shots are, whether the joins are hard or dissolved,
 * where its captions sit, whether music runs under the voice and how far it is
 * ducked.
 *
 * Everything in this file is measurable. Things that sound like style but
 * cannot be measured from pixels and samples — why a cut happened, what the
 * B-roll was of — are deliberately absent rather than guessed at, because a
 * confident number nobody can check is worse than no number.
 */

/** Where burned-in captions sit in the frame. */
export type CaptionBand = 'top' | 'centre' | 'lower' | 'none';

/** The dominant join between shots. */
export type TransitionStyle = 'hard' | 'dissolve' | 'dip';

export interface StyleProfile {
  id: string;
  name: string;
  createdAt: string;
  /** The file it was measured from, for the user's own reference. */
  sourceName: string;
  durationSeconds: number;

  pacing: {
    cutsPerMinute: number;
    averageShotSeconds: number;
    medianShotSeconds: number;
    shortestShotSeconds: number;
    /** 0 = every shot the same length, 1 = wildly varied. */
    variation: number;
  };

  transitions: {
    style: TransitionStyle;
    /** Share of joins that were gradual rather than instant, 0..1. */
    dissolveShare: number;
    /** Share of joins that passed through black or white, 0..1. */
    dipShare: number;
    averageSeconds: number;
  };

  motion: {
    /** Mean frame-to-frame change inside shots, 0..1. Locked-off talking head ≈ 0. */
    energy: number;
    /** Share of sampled frames that barely changed at all. */
    staticShare: number;
  };

  captions: {
    present: boolean;
    band: CaptionBand;
    /** Share of the video that carried on-screen text, 0..1. */
    coverage: number;
  };

  music: {
    present: boolean;
    /**
     * The music level between phrases, 0..1.
     *
     * This is measurable because nothing else is sounding: the floor in a gap
     * *is* the bed. How far the reference ducks that bed under a voice is not
     * measurable — music and speech share one track, and RMS cannot separate
     * them — so it is deliberately absent rather than guessed at.
     */
    bedLevel: number;
  };

  structure: {
    /** Seconds at the head with no speech — a title card or a music intro. */
    introSeconds: number;
    /** Seconds at the tail with no speech — an outro or end card. */
    outroSeconds: number;
  };

  /** Anything the analysis could not measure on this particular file. */
  caveats: string[];
}

/** How far towards the reference an apply should move the project. */
export type TemplateIntensity = 'low' | 'medium' | 'high';

export const INTENSITY_WEIGHT: Record<TemplateIntensity, number> = {
  low: 0.34,
  medium: 0.67,
  high: 1,
};

export const INTENSITY_LABELS: { id: TemplateIntensity; label: string; blurb: string }[] = [
  { id: 'low', label: 'Low', blurb: 'A nudge towards this style. Your pacing mostly survives.' },
  { id: 'medium', label: 'Medium', blurb: 'Meets the reference halfway. The usual choice.' },
  { id: 'high', label: 'High', blurb: 'Match the reference as closely as the footage allows.' },
];

/** One line describing a profile, for the card in the panel. */
export function describeProfile(profile: StyleProfile): string {
  const parts = [
    `${profile.pacing.cutsPerMinute.toFixed(1)} cuts/min`,
    `${profile.pacing.averageShotSeconds.toFixed(1)}s shots`,
    profile.transitions.style === 'hard' ? 'hard cuts' : `${profile.transitions.style} joins`,
  ];
  if (profile.captions.present) parts.push(`${profile.captions.band} captions`);
  if (profile.music.present) parts.push(`music bed ${Math.round(profile.music.bedLevel * 100)}%`);
  return parts.join(' · ');
}
