'use client';

/**
 * The pass that looks at the footage before deciding anything.
 *
 * This is what turns a list of cuts into an edit plan: for every seam the cuts
 * will leave behind, sample the frames either side, read the audio envelope
 * across it, check the transcript for where the sentence was, ask whether
 * B-roll could cover it — then let `judgeCut` choose, and `reviseJudgement`
 * second-guess the choice.
 *
 * The frame sampling is the expensive part, so it is bounded: seams are probed
 * in source order per asset, each video opened once, four frames per seam. A
 * two-minute recording with twenty cuts costs about a second.
 *
 * Everything degrades rather than fails. With no frames (audio-only asset, a
 * decode error, a blocked URL) the visual measurements come back at zero and the
 * judgement falls back to what the audio and transcript can support — which is
 * still better than treating every cut identically.
 */
import { applyCommand, type Clip, type EditorCommand, type Sequence } from '@/lib/engine';
import { mergeRanges, type LoudnessEnvelope, type Range } from '@/features/analysis/audioAnalysis';
import { seamTimes } from '@/features/ai/cutTransitions';
import {
  frameDelta,
  motionCentroid,
  motionEnergy,
  openVideo,
  probeFrames,
  type ProbedFrame,
} from '@/features/analysis/frameProbe';
import type { TranscriptSegment } from '@/features/transcript/model';
import type { Asset } from '@/types';
import {
  editStyle,
  judgeCut,
  reviseJudgement,
  type CutContext,
  type CutJudgement,
  type EditStyle,
} from './cutJudgement';
import { techniqueCommands, type ResolvedSeam } from './cutTechniques';

export interface SmoothPlan {
  entries: { seam: ResolvedSeam; context: CutContext; judgement: CutJudgement }[];
  commands: EditorCommand[];
  skipped: { time: number; reason: string }[];
  /** How many seams were left completely alone — the number to be proud of. */
  untouched: number;
  /** True when no frames could be read, so the picture was judged blind. */
  visualBlind: boolean;
}

export interface SmoothPlanInput {
  sequence: Sequence;
  /** The ripple-delete commands, replayed to find the surviving clips. */
  cutCommands: EditorCommand[];
  cuts: Range[];
  assets: Asset[];
  style: EditStyle;
  envelope?: LoudnessEnvelope | null;
  silences?: Range[];
  segments?: TranscriptSegment[];
  /** Timeline spans already covered by B-roll, or offered for it. */
  brollRanges?: Range[];
  newId: (prefix: string) => string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/** How far either side of a seam movement is measured. */
const MOTION_WINDOW = 0.5;

export async function buildSmoothPlan(input: SmoothPlanInput): Promise<SmoothPlan> {
  const style = editStyle(input.style);

  let cutSequence: Sequence;
  try {
    cutSequence = input.cutCommands.reduce(applyCommand, input.sequence);
  } catch {
    return { entries: [], commands: [], skipped: [], untouched: 0, visualBlind: true };
  }

  const merged = mergeRanges(input.cuts).sort((a, b) => a.start - b.start);
  const resolved = [
    ...resolveSeams(cutSequence, seamTimes(input.cuts), merged),
    // Joins between two separate recordings are cuts too — the user did not
    // make them with this tool, but the viewer still sees them, and item for
    // item they are the most exposed joins in the whole edit.
    ...resolveClipJoins(cutSequence),
  ]
    .filter((entry, index, all) => all.findIndex((other) => Math.abs(other.seam.time - entry.seam.time) < 0.02) === index)
    .sort((a, b) => a.seam.time - b.seam.time);
  if (resolved.length === 0) {
    return { entries: [], commands: [], skipped: [], untouched: 0, visualBlind: false };
  }

  const measurements = await measureSeams(resolved, input);
  const visualBlind = measurements.every((entry) => entry.frames === 0);

  // A punch-in budget for the whole edit, not per seam: variation is a few
  // reframes across a video, a tic is one at every join.
  const punchesAllowed = Math.round(resolved.length * style.punchBudget);
  let punchesUsed = 0;

  const entries: SmoothPlan['entries'] = [];
  for (const [index, seam] of resolved.map((entry) => entry.seam).entries()) {
    const measurement = measurements[index]!;
    const context = buildContext(seam, resolved[index]!.handle, measurement, input);
    const judgement = reviseJudgement(judgeCut(context, style, { punchesUsed, punchesAllowed }), context);
    if (judgement.technique === 'punch-in') punchesUsed += 1;
    entries.push({ seam, context, judgement });
  }

  const { commands, skipped } = techniqueCommands({
    sequence: cutSequence,
    seams: entries.map(({ seam, judgement }) => ({ seam, judgement })),
    newId: input.newId,
  });

  return {
    entries,
    commands,
    skipped,
    untouched: entries.filter((entry) => entry.judgement.technique === 'clean').length,
    visualBlind,
  };
}

/** Matches each cut's post-ripple position to the clips that actually survive. */
function resolveSeams(
  sequence: Sequence,
  times: number[],
  merged: Range[],
): { seam: ResolvedSeam; handle: number }[] {
  const out: { seam: ResolvedSeam; handle: number }[] = [];

  for (const [index, time] of times.entries()) {
    for (const track of sequence.tracks) {
      if (track.kind !== 'video') continue;
      const outgoing = track.clips.find((clip) => Math.abs(clip.start + clip.duration - time) < 0.02);
      const incoming = track.clips.find((clip) => Math.abs(clip.start - time) < 0.02);
      if (!outgoing || !incoming || outgoing.id === incoming.id) continue;
      const range = merged[index];
      out.push({
        seam: { time, outgoing, incoming, trackId: track.id },
        handle: range ? range.end - range.start : 0,
      });
      break;
    }
  }

  return out;
}

/**
 * Joins where two different recordings meet.
 *
 * There is no removed footage at one of these, so the handle is zero and a
 * dissolve is off the table by construction — which is the right answer anyway.
 * What is on the table is a clean cut, an audio bridge, a reframe or B-roll,
 * and the judgement rules pick between them on the same measurements as
 * everything else.
 */
function resolveClipJoins(sequence: Sequence): { seam: ResolvedSeam; handle: number }[] {
  const out: { seam: ResolvedSeam; handle: number }[] = [];

  for (const track of sequence.tracks) {
    if (track.kind !== 'video') continue;
    const clips = [...track.clips].sort((a, b) => a.start - b.start);
    for (let i = 1; i < clips.length; i += 1) {
      const outgoing = clips[i - 1]!;
      const incoming = clips[i]!;
      if (!outgoing.assetId || !incoming.assetId) continue;
      if (outgoing.assetId === incoming.assetId) continue;
      if (Math.abs(outgoing.start + outgoing.duration - incoming.start) > 0.02) continue;
      out.push({ seam: { time: incoming.start, outgoing, incoming, trackId: track.id }, handle: 0 });
    }
  }

  return out;
}

interface SeamMeasurement {
  frames: number;
  visualJump: number;
  brightnessShift: number;
  subjectShift: number;
  motionBefore: number;
  motionAfter: number;
}

const BLIND: SeamMeasurement = {
  frames: 0,
  visualJump: 0,
  brightnessShift: 0,
  subjectShift: 0,
  motionBefore: 0,
  motionAfter: 0,
};

/**
 * Samples frames around every seam, opening each asset once.
 *
 * The times probed are in *source* seconds, because that is what the video
 * element understands: the last frames the outgoing clip plays, and the first
 * the incoming clip plays.
 */
async function measureSeams(
  resolved: { seam: ResolvedSeam; handle: number }[],
  input: SmoothPlanInput,
): Promise<SeamMeasurement[]> {
  const results: SeamMeasurement[] = resolved.map(() => BLIND);
  const byAsset = new Map<string, number[]>();

  for (const [index, entry] of resolved.entries()) {
    const assetId = entry.seam.outgoing.assetId;
    if (!assetId || entry.seam.outgoing.kind !== 'video') continue;
    byAsset.set(assetId, [...(byAsset.get(assetId) ?? []), index]);
  }

  let done = 0;
  for (const [assetId, indices] of byAsset) {
    const asset = input.assets.find((entry) => entry.id === assetId);
    if (!asset) continue;

    let handle: Awaited<ReturnType<typeof openVideo>> | null = null;
    try {
      handle = await openVideo(asset.url);
    } catch {
      // Unreadable media is judged on sound alone rather than failing the pass.
      continue;
    }

    try {
      for (const index of indices) {
        input.signal?.throwIfAborted();
        const { seam } = resolved[index]!;
        // Only compare frames from the same asset; a clip change is measured
        // by the judgement rules rather than by pixels of two different rooms.
        if (seam.incoming.assetId !== assetId) continue;

        const outSource = seam.outgoing.sourceIn + seam.outgoing.duration * seam.outgoing.speed;
        const inSource = seam.incoming.sourceIn;

        const before = await probeFrames(
          handle,
          [Math.max(0, outSource - MOTION_WINDOW), Math.max(0, outSource - MOTION_WINDOW / 2), Math.max(0, outSource - 0.04)],
          input.signal,
        );
        const after = await probeFrames(
          handle,
          [inSource, inSource + MOTION_WINDOW / 2, inSource + MOTION_WINDOW],
          input.signal,
        );

        results[index] = summarise(before, after);
        done += 1;
        input.onProgress?.(done, resolved.length);
      }
    } finally {
      handle.release();
    }
  }

  return results;
}

function summarise(before: ProbedFrame[], after: ProbedFrame[]): SeamMeasurement {
  const last = before[before.length - 1];
  const first = after[0];
  if (!last || !first) return BLIND;

  const across = frameDelta(last, first);
  const centroidBefore = motionCentroid(before);
  const centroidAfter = motionCentroid(after);

  // Only compare positions when there was movement to locate on both sides;
  // a centroid derived from noise is not a subject position.
  const locatable = centroidBefore.strength > 0.004 && centroidAfter.strength > 0.004;
  const subjectShift = locatable
    ? Math.hypot(centroidAfter.x - centroidBefore.x, centroidAfter.y - centroidBefore.y)
    : across.difference > 0.12
      ? // No usable centroid, but the frame really did change: fall back to the
        // size of the change rather than reporting a confident zero.
        Math.min(1, across.difference)
      : 0;

  return {
    frames: before.length + after.length,
    visualJump: across.difference,
    brightnessShift: Math.abs(across.brightnessShift),
    subjectShift: Math.min(1, subjectShift),
    motionBefore: motionEnergy(before),
    motionAfter: motionEnergy(after),
  };
}

function buildContext(
  seam: ResolvedSeam,
  handle: number,
  measurement: SeamMeasurement,
  input: SmoothPlanInput,
): CutContext {
  const sameSource = seam.outgoing.assetId === seam.incoming.assetId;
  return {
    id: `seam_${seam.time.toFixed(3)}`,
    time: seam.time,
    handle,
    visualJump: measurement.visualJump,
    brightnessShift: measurement.brightnessShift,
    subjectShift: measurement.subjectShift,
    motionBefore: measurement.motionBefore,
    motionAfter: measurement.motionAfter,
    sameSource,
    levelJump: levelJumpAt(seam.time, input.envelope ?? null),
    inSilence: inRange(seam.time, input.silences ?? []),
    atSentenceBoundary: atBoundary(seam.time, input.segments ?? []),
    midSentence: insideSegment(seam.time, input.segments ?? []),
    brollAvailable: inRange(seam.time, input.brollRanges ?? []),
    outgoingDuration: seam.outgoing.duration,
    incomingDuration: seam.incoming.duration,
  };
}

/** How abruptly the sound level changes across the join, 0..1. */
function levelJumpAt(time: number, envelope: LoudnessEnvelope | null): number {
  if (!envelope || envelope.peak <= 0) return 0;
  const at = (t: number) => {
    const index = Math.floor(t / envelope.windowSeconds);
    return (envelope.values[Math.max(0, Math.min(envelope.values.length - 1, index))] ?? 0) / envelope.peak;
  };
  // A short window either side, so one quiet frame does not read as a cliff.
  const before = (at(time - 0.06) + at(time - 0.03)) / 2;
  const after = (at(time + 0.03) + at(time + 0.06)) / 2;
  return Math.min(1, Math.abs(after - before));
}

function inRange(time: number, ranges: Range[]): boolean {
  return ranges.some((range) => time >= range.start - 0.05 && time <= range.end + 0.05);
}

/** True when a segment ends within a breath of the cut. */
function atBoundary(time: number, segments: TranscriptSegment[]): boolean {
  return segments.some((segment) => Math.abs(segment.end - time) < 0.25 || Math.abs(segment.start - time) < 0.25);
}

/** True when the cut falls inside a segment rather than between two. */
function insideSegment(time: number, segments: TranscriptSegment[]): boolean {
  return segments.some((segment) => time > segment.start + 0.25 && time < segment.end - 0.25);
}

export { resolveSeams, resolveClipJoins, levelJumpAt, summarise };
