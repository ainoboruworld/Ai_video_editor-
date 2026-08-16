/**
 * Deciding how to handle each cut, one cut at a time.
 *
 * The version this replaces applied one technique to every seam. That is the
 * thing a professional editor never does: most cuts in a talking head need
 * nothing at all, a few need help, and the handful that need real help each
 * need a different kind. Adding a dissolve to a cut that was already invisible
 * makes it *more* noticeable, not less.
 *
 * So every seam is scored first — how obvious will this actually be? — and the
 * technique is chosen to be the least intrusive thing that fixes what is wrong
 * with *that* seam. A cut that already reads well is left alone.
 *
 * The scoring is built from measurements, not vibes: pixel difference across
 * the join, where the motion sits, brightness shift, audio level continuity,
 * and whether the cut lands on a sentence boundary. What it cannot see — whose
 * face it is, what expression they are wearing, where their hands are — it does
 * not pretend to see. `subjectShift` is the movement centroid, a proxy, and
 * says so.
 */

/** How a seam gets handled. Ordered roughly by how visible each one is. */
export type CutTechnique =
  | 'clean'
  | 'audio-crossfade'
  | 'punch-in'
  | 'dissolve'
  | 'j-cut'
  | 'l-cut'
  | 'broll';

export type EditStyle = 'conservative' | 'natural' | 'dynamic';

export interface EditStyleProfile {
  id: EditStyle;
  label: string;
  blurb: string;
  /**
   * How obvious a cut has to be before anything is done about it. Higher means
   * more cuts are left alone.
   */
  tolerance: number;
  /** Share of eligible seams that may get a punch-in, 0..1. */
  punchBudget: number;
  /** Whether B-roll is proposed for the difficult ones. */
  suggestBroll: boolean;
}

export const EDIT_STYLES: EditStyleProfile[] = [
  {
    id: 'conservative',
    label: 'Conservative',
    blurb: 'Fewer cuts, almost no visual treatment, natural pauses kept.',
    tolerance: 0.5,
    punchBudget: 0,
    suggestBroll: false,
  },
  {
    id: 'natural',
    label: 'Natural',
    blurb: 'Obvious fillers go, jump cuts get hidden, the odd punch-in. The default.',
    tolerance: 0.32,
    punchBudget: 0.25,
    suggestBroll: true,
  },
  {
    id: 'dynamic',
    label: 'Dynamic',
    blurb: 'Tighter pacing, more visual variation, more B-roll and punch-ins.',
    tolerance: 0.22,
    punchBudget: 0.5,
    suggestBroll: true,
  },
];

export const DEFAULT_EDIT_STYLE: EditStyle = 'natural';

export function editStyle(id: EditStyle): EditStyleProfile {
  return EDIT_STYLES.find((entry) => entry.id === id) ?? EDIT_STYLES[1]!;
}

/** Everything measured about one seam, before deciding anything. */
export interface CutContext {
  id: string;
  /** Timeline position of the join. */
  time: number;
  /** Seconds of removed material available to dissolve through. 0 at a splice. */
  handle: number;

  // ---- picture ----
  /** Mean pixel difference across the join, 0..1. */
  visualJump: number;
  /** Absolute brightness change across the join, 0..1. */
  brightnessShift: number;
  /** How far the movement centroid moved, 0..1 of frame width. A proxy. */
  subjectShift: number;
  /** Movement in the second before the cut, 0..1. */
  motionBefore: number;
  /** Movement in the second after, 0..1. */
  motionAfter: number;
  /** False when the two sides are different recordings. */
  sameSource: boolean;

  // ---- sound ----
  /** Audio level change across the join, 0..1. */
  levelJump: number;
  /** True when the join sits in a gap rather than mid-phrase. */
  inSilence: boolean;

  // ---- speech ----
  /** True when the cut lands where a sentence ends. */
  atSentenceBoundary: boolean;
  /** True when a single sentence runs across the join. */
  midSentence: boolean;

  // ---- what is available ----
  brollAvailable: boolean;
  outgoingDuration: number;
  incomingDuration: number;
}

export interface CutJudgement {
  id: string;
  time: number;
  technique: CutTechnique;
  /** 0..1 — how obvious this cut is with nothing done about it. */
  noticeability: number;
  /** 0..1 — the estimate after the chosen technique. */
  residual: number;
  /** Why this technique, in a sentence the user can disagree with. */
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  /** Technique parameters: dissolve length, punch scale, bridge length. */
  parameters: { seconds?: number; scale?: number };
}

// A dissolve shorter than this is a flicker rather than a blend.
const MIN_DISSOLVE = 0.06;
const MAX_DISSOLVE = 0.18;
/** Punch-ins stay inside this range. Beyond it the viewer sees a zoom. */
const PUNCH_SCALE = 1.05;
/** How long audio bridges a picture change on a J or L cut. */
const BRIDGE_SECONDS = 0.32;
/** Below this, movement across the join is noise rather than a shift. */
const SHIFT_FLOOR = 0.06;

/**
 * How obvious this cut will be if nothing is done.
 *
 * Weighted towards the picture, because a jump cut is seen before it is heard,
 * and towards *movement* over raw difference: a speaker who was mid-gesture on
 * both sides hides an edit that the same speaker holding two different poses
 * would expose.
 */
export function noticeability(ctx: CutContext): number {
  const visual = clamp(ctx.visualJump / 0.28, 0, 1) * 0.34;
  const shift = clamp(Math.max(0, ctx.subjectShift - SHIFT_FLOOR) / 0.24, 0, 1) * 0.26;
  const light = clamp(ctx.brightnessShift / 0.12, 0, 1) * 0.1;
  const level = clamp(ctx.levelJump / 0.35, 0, 1) * 0.16;

  // Cutting mid-sentence is more exposed than cutting where a thought ends.
  const speech = ctx.atSentenceBoundary ? 0 : ctx.midSentence ? 0.1 : 0.05;

  // A cut made while the subject was already moving is partly camouflaged; one
  // made between two still poses has nothing to hide behind.
  const stillness = 1 - clamp((ctx.motionBefore + ctx.motionAfter) / 2 / 0.05, 0, 1);
  const exposure = stillness * 0.14;

  return round(clamp(visual + shift + light + level + speech + exposure, 0, 1));
}

/**
 * Picks the least intrusive technique that fixes what is actually wrong.
 *
 * `punchesUsed` and `punchBudget` are passed in so the caller can keep the
 * whole edit in proportion — a punch-in on every third cut is variation, a
 * punch-in on every cut is a tic.
 */
export function judgeCut(
  ctx: CutContext,
  style: EditStyleProfile,
  budget: { punchesUsed: number; punchesAllowed: number } = { punchesUsed: 0, punchesAllowed: 0 },
): CutJudgement {
  const score = noticeability(ctx);
  const base = { id: ctx.id, time: ctx.time, noticeability: score };

  // ---- 10. Nothing needed -------------------------------------------------
  // The cut already reads as natural. Adding anything here would introduce a
  // visible event to hide one that was not visible.
  if (score <= style.tolerance * 0.55 && ctx.levelJump < 0.12) {
    return {
      ...base,
      technique: 'clean',
      residual: score,
      reason: 'Already reads as a clean cut — nothing added.',
      confidence: 'high',
      parameters: {},
    };
  }

  // ---- 1. Small visual change --------------------------------------------
  // The picture is fine; only the waveform is severed. A few frames of fade is
  // inaudible and fixes the click, and no visual treatment is warranted.
  if (score <= style.tolerance) {
    return {
      ...base,
      technique: 'audio-crossfade',
      residual: round(Math.max(0, score - 0.08)),
      reason: ctx.levelJump >= 0.12
        ? 'Picture barely changes; the audio needs a short crossfade to lose the click.'
        : 'Small visual change — a short audio crossfade is all it needs.',
      confidence: 'high',
      parameters: { seconds: 0.045 },
    };
  }

  // ---- 8 / 3. Large change, and B-roll can cover it ----------------------
  const large = score >= style.tolerance + 0.28 || ctx.subjectShift >= 0.3;
  if (large && ctx.brollAvailable && style.suggestBroll) {
    return {
      ...base,
      technique: 'broll',
      residual: 0.05,
      reason: 'Big jump, and there is relevant B-roll for this moment — covering it hides the edit completely while your audio keeps running.',
      confidence: 'high',
      parameters: {},
    };
  }

  // ---- 4. A sentence runs across a clip change ---------------------------
  // Audio continuity is what carries a viewer over a picture change. Only
  // meaningful between different recordings: within one take the sound is
  // already continuous.
  if (!ctx.sameSource && ctx.midSentence) {
    const technique: CutTechnique = ctx.inSilence ? 'j-cut' : 'l-cut';
    return {
      ...base,
      technique,
      residual: round(Math.max(0.08, score - 0.3)),
      reason:
        technique === 'l-cut'
          ? 'A sentence carries across this clip change — holding the outgoing audio over the new picture makes the change almost unnoticeable.'
          : 'The next clip’s audio starts before its picture, so the ear arrives before the eye does.',
      confidence: 'medium',
      parameters: { seconds: BRIDGE_SECONDS },
    };
  }

  // ---- 2. Moderate position change ---------------------------------------
  // A small change of framing reads as a second angle and hides a shifted head
  // far better than a dissolve does. Rationed, and never over existing motion:
  // a punch-in during a gesture competes with the gesture.
  const punchRoom = budget.punchesUsed < budget.punchesAllowed;
  const moderate = ctx.subjectShift >= 0.1 && ctx.subjectShift < 0.3;
  const stillEnough = Math.max(ctx.motionBefore, ctx.motionAfter) < 0.05;
  if (moderate && punchRoom && stillEnough && ctx.incomingDuration > 1.2) {
    return {
      ...base,
      technique: 'punch-in',
      residual: round(Math.max(0.1, score - 0.24)),
      reason: `The speaker sits ${Math.round(ctx.subjectShift * 100)}% of a frame off across this cut — a ${Math.round((PUNCH_SCALE - 1) * 100)}% reframe reads as a second angle and hides it.`,
      confidence: 'medium',
      parameters: { scale: PUNCH_SCALE },
    };
  }

  // ---- 5 / 6 / 7. A cut inside one take, with material to blend through ---
  //
  // A dissolve is a *visible* treatment, so being merely above the "leave it
  // alone" line does not earn one — the cut has to be clearly noticeable. This
  // is what stops a conservative pass from escalating to a dissolve every time
  // it declines to reframe, which would be the opposite of conservative.
  const span = Math.min(MAX_DISSOLVE, ctx.handle * 0.9, ctx.outgoingDuration * 0.4, ctx.incomingDuration * 0.4);
  const worthTreating = score >= style.tolerance + 0.08;
  if (ctx.sameSource && span >= MIN_DISSOLVE && worthTreating) {
    return {
      ...base,
      technique: 'dissolve',
      residual: round(Math.max(0.08, score - 0.28)),
      reason: 'Enough removed footage here to dissolve through, which hides the head jump without reading as an effect.',
      confidence: 'high',
      parameters: { seconds: round(span) },
    };
  }

  // ---- 9. Clip-to-clip, nothing else applies ------------------------------
  // Deliberately not an automatic dissolve. Two different recordings genuinely
  // are two different shots, and a hard cut between two shots is normal
  // filmmaking; a dissolve announces itself.
  if (!ctx.sameSource) {
    return {
      ...base,
      technique: 'audio-crossfade',
      residual: round(Math.max(0.12, score - 0.1)),
      reason: 'Different recordings either side. A hard cut between two shots is normal — only the audio join needs softening.',
      confidence: 'medium',
      parameters: { seconds: 0.045 },
    };
  }

  // Above the line, but not far enough above it for this style to spend a
  // visible treatment on. Restraint is the decision, not a failure to decide.
  if (!worthTreating) {
    return {
      ...base,
      technique: 'audio-crossfade',
      residual: round(Math.max(0, score - 0.06)),
      reason: 'Slightly noticeable, but not enough to justify a visible treatment at this editing style.',
      confidence: 'medium',
      parameters: { seconds: 0.045 },
    };
  }

  // Nothing left that would help: no handle to dissolve through, no B-roll, no
  // room to reframe. Saying so is better than doing something visible.
  return {
    ...base,
    technique: 'audio-crossfade',
    residual: score,
    reason: 'Noticeable, but nothing here would hide it without being more obvious than the cut. Consider B-roll over this moment.',
    confidence: 'low',
    parameters: { seconds: 0.045 },
  };
}

/**
 * The final pass: would a professional keep this?
 *
 * Every technique has its own cost, and a technique whose cost exceeds the jump
 * it hides is worse than doing nothing. This catches the cases the per-cut
 * rules cannot see on their own — a dissolve too short to read as anything but
 * a flicker, a punch-in on a clip too brief to settle, a treatment applied to a
 * cut that was fine to begin with.
 */
export function reviseJudgement(judgement: CutJudgement, ctx: CutContext): CutJudgement {
  const downgrade = (reason: string): CutJudgement => ({
    ...judgement,
    technique: 'audio-crossfade',
    residual: judgement.noticeability,
    reason,
    confidence: 'medium',
    parameters: { seconds: 0.045 },
  });

  if (judgement.technique === 'dissolve') {
    const span = judgement.parameters.seconds ?? 0;
    if (span < MIN_DISSOLVE) {
      return downgrade('Too little removed footage to dissolve through — it would flicker rather than blend, so the picture cuts clean.');
    }
    if (span > ctx.outgoingDuration * 0.4 || span > ctx.incomingDuration * 0.4) {
      return downgrade('The clips either side are too short to carry a dissolve without becoming mostly transition.');
    }
  }

  if (judgement.technique === 'punch-in') {
    if (ctx.incomingDuration < 1.2) {
      return downgrade('The next shot is too short for a reframe to settle before it ends.');
    }
    if (Math.max(ctx.motionBefore, ctx.motionAfter) >= 0.05) {
      return downgrade('The speaker is already moving here, so a reframe would compete with the movement instead of hiding it.');
    }
  }

  if ((judgement.technique === 'j-cut' || judgement.technique === 'l-cut') && ctx.sameSource) {
    return downgrade('Both sides come from one recording, so the audio is already continuous — a J/L cut would do nothing.');
  }

  // The blunt version of the question: is the cure worse than the disease?
  if (judgement.residual >= judgement.noticeability && judgement.technique !== 'clean' && judgement.technique !== 'audio-crossfade') {
    return downgrade('The treatment would be more noticeable than the cut it hides.');
  }

  return judgement;
}

/** Human-readable name, for the review list. */
export const TECHNIQUE_LABELS: Record<CutTechnique, string> = {
  clean: 'Clean cut',
  'audio-crossfade': 'Audio crossfade',
  'punch-in': 'Punch-in',
  dissolve: 'Dissolve',
  'j-cut': 'J-cut',
  'l-cut': 'L-cut',
  broll: 'B-roll',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
