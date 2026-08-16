'use client';

/**
 * Measuring a reference video's editing style.
 *
 * Everything here runs in the browser on the decoded file: frames onto a small
 * canvas, samples through an AudioContext. No upload, no provider, no cost —
 * and no model guessing at what it sees.
 *
 * The picture is sampled rather than decoded frame by frame. A `<video>` can be
 * seeked and painted far faster than it can be played, and ~8 samples a second
 * is enough to catch a cut while keeping a three-minute reference under a
 * minute of analysis. That sampling rate is also the honest limit of what this
 * can claim: a transition shorter than ~120 ms is measured as a hard cut, and
 * the profile says so.
 */
import { envelopeFromBuffer, type LoudnessEnvelope } from '@/features/analysis/audioAnalysis';
import type { CaptionBand, StyleProfile, TransitionStyle } from './profile';

const SAMPLE_FPS = 8;
const FRAME_WIDTH = 160;
/** Above this mean absolute difference, two frames are different shots. */
const CUT_THRESHOLD = 0.18;
/** Below this, nothing moved at all. */
const STATIC_THRESHOLD = 0.012;
/** Luma below this is "black" for dip detection; above 0.93 is "white". */
const DIP_DARK = 0.07;
const DIP_BRIGHT = 0.93;

export interface AnalyseOptions {
  onProgress?: (message: string, fraction?: number) => void;
  signal?: AbortSignal;
}

interface FrameSample {
  time: number;
  /** Mean absolute difference from the previous sample, 0..1. */
  change: number;
  /** Mean luma, 0..1. */
  luma: number;
  /** Edge energy per horizontal band — the caption signal. */
  bands: [number, number, number];
}

/**
 * Reads a reference video and returns a measured style profile.
 *
 * The video is analysed from a blob URL, so it never leaves the browser. That
 * matters for a reference in particular: it is usually someone else's finished
 * work, and this needs nothing from it but statistics.
 */
export async function analyseReference(
  file: File | Blob,
  name: string,
  options: AnalyseOptions = {},
): Promise<StyleProfile> {
  const url = URL.createObjectURL(file);
  try {
    options.onProgress?.('Loading the reference…', 0);
    const frames = await sampleFrames(url, options);
    options.onProgress?.('Reading the audio…', 0.85);
    const audio = await sampleAudio(file, options).catch(() => null);
    options.onProgress?.('Working out the style…', 0.95);
    return buildProfile(name, frames, audio);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ------------------------------------------------------------------ video --

async function sampleFrames(url: string, options: AnalyseOptions): Promise<FrameSample[]> {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('That file could not be read as a video.'));
  });

  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('That video has no readable duration.');
  }

  const height = Math.max(2, Math.round((FRAME_WIDTH * video.videoHeight) / Math.max(1, video.videoWidth)));
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot read frames from a video.');

  const step = 1 / SAMPLE_FPS;
  const samples: FrameSample[] = [];
  let previous: Float32Array | null = null;

  for (let time = 0; time < duration; time += step) {
    options.signal?.throwIfAborted();
    const painted = await seekAndPaint(video, ctx, time, FRAME_WIDTH, height);
    if (!painted) continue;

    const { data } = ctx.getImageData(0, 0, FRAME_WIDTH, height);
    const luma = lumaPlane(data, FRAME_WIDTH, height);

    samples.push({
      time,
      change: previous ? meanAbsoluteDifference(previous, luma) : 0,
      luma: mean(luma),
      bands: bandEnergy(luma, FRAME_WIDTH, height),
    });
    previous = luma;

    if (samples.length % 16 === 0) {
      options.onProgress?.(`Reading frames… ${Math.round((time / duration) * 100)}%`, (time / duration) * 0.85);
    }
  }

  video.src = '';
  return samples;
}

/** Seeks to a time and paints that frame, resolving false if it never arrives. */
function seekAndPaint(
  video: HTMLVideoElement,
  ctx: CanvasRenderingContext2D,
  time: number,
  width: number,
  height: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      video.onseeked = null;
      clearTimeout(timer);
      resolve(ok);
    };

    // A seek that never lands must not stall the whole analysis.
    const timer = setTimeout(() => done(false), 2500);

    video.onseeked = () => {
      try {
        ctx.drawImage(video, 0, 0, width, height);
        done(true);
      } catch {
        done(false);
      }
    };
    video.currentTime = time;
  });
}

function lumaPlane(data: Uint8ClampedArray, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i += 1) {
    const p = i * 4;
    // Rec. 601 luma, which is what "how bright is this" means for video.
    out[i] = (0.299 * (data[p] ?? 0) + 0.587 * (data[p + 1] ?? 0) + 0.114 * (data[p + 2] ?? 0)) / 255;
  }
  return out;
}

function meanAbsoluteDifference(a: Float32Array, b: Float32Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return total / a.length;
}

function mean(values: Float32Array): number {
  let total = 0;
  for (const value of values) total += value;
  return total / Math.max(1, values.length);
}

/**
 * Edge energy in the top, middle and lower third.
 *
 * Burned-in captions are small, high-contrast shapes that sit in the same band
 * for a second or two and then change. Horizontal gradient energy is what
 * separates them from the picture behind: a face has soft edges, lettering does
 * not.
 */
function bandEnergy(luma: Float32Array, width: number, height: number): [number, number, number] {
  const bands: [number, number, number] = [0, 0, 0];
  const counts: [number, number, number] = [0, 0, 0];

  for (let y = 0; y < height; y += 1) {
    const band = y < height / 3 ? 0 : y < (height * 2) / 3 ? 1 : 2;
    for (let x = 1; x < width; x += 1) {
      const here = luma[y * width + x] ?? 0;
      const left = luma[y * width + x - 1] ?? 0;
      const edge = Math.abs(here - left);
      // Only steep edges count. Anything softer is picture, not lettering.
      if (edge > 0.25) bands[band] += edge;
      counts[band] += 1;
    }
  }

  return [bands[0] / Math.max(1, counts[0]), bands[1] / Math.max(1, counts[1]), bands[2] / Math.max(1, counts[2])];
}

// ------------------------------------------------------------------ audio --

async function sampleAudio(file: File | Blob, options: AnalyseOptions): Promise<LoudnessEnvelope> {
  const bytes = await file.arrayBuffer();
  options.signal?.throwIfAborted();
  const AudioCtor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioCtor();
  try {
    const buffer = await context.decodeAudioData(bytes);
    return envelopeFromBuffer(buffer, 0.05);
  } finally {
    void context.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------- profile --

/** Turns raw samples into the profile. Pure, so it is testable without a DOM. */
export function buildProfile(
  name: string,
  frames: FrameSample[],
  audio: LoudnessEnvelope | null,
): StyleProfile {
  const caveats: string[] = [];
  const duration = frames.length > 0 ? frames[frames.length - 1]!.time : 0;

  const { cuts, dissolves, dips } = findCuts(frames);
  const shots = shotLengths(cuts, duration);

  const totalJoins = cuts.length;
  const dissolveShare = totalJoins > 0 ? dissolves / totalJoins : 0;
  const dipShare = totalJoins > 0 ? dips / totalJoins : 0;
  const style: TransitionStyle = dipShare > 0.3 ? 'dip' : dissolveShare > 0.35 ? 'dissolve' : 'hard';

  const withinShot = frames.filter((frame) => frame.change < CUT_THRESHOLD).map((frame) => frame.change);
  const energy = withinShot.length > 0 ? clamp(average(withinShot) / 0.08, 0, 1) : 0;
  const staticShare = withinShot.length > 0 ? withinShot.filter((c) => c < STATIC_THRESHOLD).length / withinShot.length : 0;

  const captions = detectCaptions(frames);
  const music = audio ? detectMusic(audio) : { present: false, bedLevel: 0 };
  const structure = audio ? detectStructure(audio) : { introSeconds: 0, outroSeconds: 0 };

  if (frames.length < 8) caveats.push('Too short to measure pacing reliably.');
  if (!audio) caveats.push('The audio could not be decoded, so music and structure were not measured.');
  if (totalJoins === 0) caveats.push('No cuts found — this reference is a single continuous shot.');
  caveats.push(`Sampled at ${SAMPLE_FPS} frames a second, so joins shorter than ${Math.round(1000 / SAMPLE_FPS)}ms read as hard cuts.`);
  if (music.present) {
    caveats.push('Music and speech share one track, so how far the reference ducks its music cannot be measured — only how loud the bed is between phrases.');
  }

  return {
    id: `tpl_${Math.round(duration * 1000).toString(36)}_${name.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`,
    name: name.replace(/\.[^.]+$/, ''),
    createdAt: new Date().toISOString(),
    sourceName: name,
    durationSeconds: round(duration),
    pacing: {
      cutsPerMinute: duration > 0 ? round((totalJoins / duration) * 60) : 0,
      averageShotSeconds: round(average(shots)),
      medianShotSeconds: round(median(shots)),
      shortestShotSeconds: round(shots.length > 0 ? Math.min(...shots) : 0),
      variation: round(variation(shots)),
    },
    transitions: {
      style,
      dissolveShare: round(dissolveShare),
      dipShare: round(dipShare),
      // A gradual join spans at least two samples; that is the resolution here.
      averageSeconds: style === 'hard' ? 0 : round(Math.max(2 / SAMPLE_FPS, 0.25)),
    },
    motion: { energy: round(energy), staticShare: round(staticShare) },
    captions,
    music,
    structure,
    caveats,
  };
}

/**
 * Shot boundaries, and what kind of join each one is.
 *
 * A hard cut is one sample of large change. A dissolve spreads that change
 * across several consecutive samples, none of them as violent. A dip shows the
 * frame passing through black or white on the way.
 */
function findCuts(frames: FrameSample[]): { cuts: number[]; dissolves: number; dips: number } {
  const cuts: number[] = [];
  let dissolves = 0;
  let dips = 0;

  let i = 1;
  while (i < frames.length) {
    const frame = frames[i]!;
    if (frame.change < CUT_THRESHOLD * 0.45) {
      i += 1;
      continue;
    }

    // How many consecutive samples are elevated? One is a cut; several is a blend.
    let run = 0;
    let j = i;
    let sawDip = false;
    while (j < frames.length && frames[j]!.change >= CUT_THRESHOLD * 0.45) {
      const luma = frames[j]!.luma;
      if (luma < DIP_DARK || luma > DIP_BRIGHT) sawDip = true;
      run += 1;
      j += 1;
    }

    const peak = Math.max(...frames.slice(i, j).map((f) => f.change));
    if (peak >= CUT_THRESHOLD || run >= 2) {
      cuts.push(frame.time);
      if (sawDip) dips += 1;
      else if (run >= 2 && peak < CUT_THRESHOLD * 1.6) dissolves += 1;
    }
    i = j;
  }

  return { cuts, dissolves, dips };
}

function shotLengths(cuts: number[], duration: number): number[] {
  if (cuts.length === 0) return duration > 0 ? [duration] : [];
  const lengths: number[] = [];
  let previous = 0;
  for (const cut of cuts) {
    lengths.push(cut - previous);
    previous = cut;
  }
  lengths.push(Math.max(0, duration - previous));
  return lengths.filter((length) => length > 0.05);
}

/**
 * Whether the reference burns in captions, and where.
 *
 * Presence is not "there is contrast in the lower third" — a bright shirt would
 * pass that. It is contrast in one band that *changes over time* while the band
 * keeps carrying it, which is what a caption track looks like and what a static
 * graphic does not.
 */
function detectCaptions(frames: FrameSample[]): StyleProfile['captions'] {
  if (frames.length < 8) return { present: false, band: 'none', coverage: 0 };

  const bandNames: CaptionBand[] = ['top', 'centre', 'lower'];
  let best: { band: CaptionBand; coverage: number; score: number } = { band: 'none', coverage: 0, score: 0 };

  for (const [index, band] of bandNames.entries()) {
    const series = frames.map((frame) => frame.bands[index] ?? 0);
    const baseline = percentile(series, 0.2);
    const busy = series.filter((value) => value > baseline * 2 + 0.004);
    const coverage = busy.length / series.length;
    // Text appears and disappears; a graphic that never changes is not a caption.
    const churn = changeRate(series, baseline * 2 + 0.004);
    const score = coverage * churn;
    if (score > best.score) best = { band, coverage, score };
  }

  // Both thresholds have to clear: enough of the video, and enough turnover.
  const present = best.score > 0.02 && best.coverage > 0.25;
  return present
    ? { present: true, band: best.band, coverage: round(best.coverage) }
    : { present: false, band: 'none', coverage: round(best.coverage) };
}

/** How often a series crosses a threshold — the "it keeps changing" signal. */
function changeRate(series: number[], threshold: number): number {
  let crossings = 0;
  for (let i = 1; i < series.length; i += 1) {
    const was = (series[i - 1] ?? 0) > threshold;
    const is = (series[i] ?? 0) > threshold;
    if (was !== is) crossings += 1;
  }
  return crossings / Math.max(1, series.length);
}

/**
 * Whether music runs underneath, and how loud its bed is.
 *
 * The floor between phrases is the giveaway: in a voice-only recording it sits
 * near zero, while a music bed holds it well above. That floor is the bed
 * level, and it is genuinely measurable because nothing else is sounding.
 *
 * How far the reference *ducks* that bed under a voice is not measurable and is
 * not attempted. Music and speech are summed into one waveform, so the level
 * during speech is the speech; dividing one by the other would produce a
 * confident number that means nothing. The editor applies its own ducking curve
 * at the measured bed level instead, and says so.
 */
function detectMusic(envelope: LoudnessEnvelope): StyleProfile['music'] {
  const values = Array.from(envelope.values);
  if (values.length < 20 || envelope.peak <= 0) return { present: false, bedLevel: 0 };

  const normalised = values.map((value) => value / envelope.peak);
  const quiet = normalised.filter((value) => value <= 0.25);
  if (quiet.length < 8) return { present: false, bedLevel: 0 };

  // The floor, not the mean: a few loud windows in a gap are a door slamming.
  const bedLevel = percentile(quiet, 0.6);
  // Real silence sits below about 2% of peak. A floor above that is a bed.
  return bedLevel > 0.02 ? { present: true, bedLevel: round(bedLevel) } : { present: false, bedLevel: round(bedLevel) };
}

/** Speechless head and tail — a title card, a music intro, an end screen. */
function detectStructure(envelope: LoudnessEnvelope): StyleProfile['structure'] {
  const values = Array.from(envelope.values);
  if (values.length === 0 || envelope.peak <= 0) return { introSeconds: 0, outroSeconds: 0 };
  const loud = values.map((value) => value / envelope.peak > 0.35);

  let intro = 0;
  while (intro < loud.length && !loud[intro]) intro += 1;
  let outro = 0;
  while (outro < loud.length && !loud[loud.length - 1 - outro]) outro += 1;

  return {
    introSeconds: round(intro * envelope.windowSeconds),
    outroSeconds: round(outro * envelope.windowSeconds),
  };
}

// ----------------------------------------------------------------- maths ---

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : sorted[middle] ?? 0;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[index] ?? 0;
}

/** Coefficient of variation, capped — 0 is metronomic, 1 is wildly varied. */
function variation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  if (mean <= 0) return 0;
  const spread = Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
  return clamp(spread / mean, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
