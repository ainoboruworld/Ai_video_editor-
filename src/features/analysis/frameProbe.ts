'use client';

/**
 * Looking at the actual frames either side of a cut.
 *
 * Deciding how to hide a cut needs to know how big the jump is, and that is a
 * question about pixels rather than about the transcript. A `<video>` can be
 * seeked and painted onto a small canvas far faster than it can be played, so
 * a handful of frames around each seam costs a fraction of a second.
 *
 * What this can honestly measure, and what it cannot:
 *
 * - **Can**: how different two frames are, where in the frame they differ,
 *   whether the picture got brighter or darker, and how much the subject was
 *   moving either side of the cut.
 * - **Cannot**: whose face it is, what expression they are wearing, or where
 *   their hands are. That needs a vision model this product does not ship.
 *   `motionCentroid` is a *proxy* for the speaker's position — in a talking
 *   head, the thing that moves is the person — and it is named and reported as
 *   a proxy rather than dressed up as face tracking.
 */

/** Frames are compared at this width; enough for a jump, cheap enough to seek. */
export const PROBE_WIDTH = 160;

export interface ProbedFrame {
  /** Source time this frame was taken from. */
  time: number;
  luma: Float32Array;
  width: number;
  height: number;
  /** Mean luma, 0..1. */
  brightness: number;
}

export interface FrameDelta {
  /** Mean absolute luma difference, 0..1. The size of the visual jump. */
  difference: number;
  /** Signed brightness change, -1..1. A lighting or exposure shift. */
  brightnessShift: number;
  /**
   * Where the difference sits, 0..1 across and down the frame. Meaningless
   * when `difference` is tiny, so callers should gate on that first.
   */
  centroidX: number;
  centroidY: number;
  /** Share of the difference in the top third — where a head would be. */
  upperShare: number;
}

interface VideoHandle {
  video: HTMLVideoElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  duration: number;
  release: () => void;
}

/**
 * Opens a video for probing. The caller must `release()` it.
 *
 * Kept separate from `probeFrames` so a caller sampling many seams in one file
 * pays the load cost once.
 */
export async function openVideo(url: string): Promise<VideoHandle> {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.src = url;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('That file could not be read as a video.'));
  });

  const height = Math.max(2, Math.round((PROBE_WIDTH * video.videoHeight) / Math.max(1, video.videoWidth)));
  const canvas = document.createElement('canvas');
  canvas.width = PROBE_WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot read frames from a video.');

  return {
    video,
    ctx,
    width: PROBE_WIDTH,
    height,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    release: () => {
      video.onseeked = null;
      video.src = '';
    },
  };
}

/** Samples the given source times. Times that never decode are skipped. */
export async function probeFrames(
  handle: VideoHandle,
  times: number[],
  signal?: AbortSignal,
): Promise<ProbedFrame[]> {
  const out: ProbedFrame[] = [];
  for (const time of times) {
    signal?.throwIfAborted();
    if (time < 0 || (handle.duration > 0 && time > handle.duration)) continue;
    const painted = await seekAndPaint(handle, time);
    if (!painted) continue;
    const { data } = handle.ctx.getImageData(0, 0, handle.width, handle.height);
    const luma = lumaPlane(data, handle.width, handle.height);
    out.push({ time, luma, width: handle.width, height: handle.height, brightness: mean(luma) });
  }
  return out;
}

/** Seeks to a time and paints that frame, resolving false if it never arrives. */
export function seekAndPaint(handle: VideoHandle, time: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      handle.video.onseeked = null;
      clearTimeout(timer);
      resolve(ok);
    };
    // A seek that never lands must not stall the whole pass.
    const timer = setTimeout(() => done(false), 2500);
    handle.video.onseeked = () => {
      try {
        handle.ctx.drawImage(handle.video, 0, 0, handle.width, handle.height);
        done(true);
      } catch {
        done(false);
      }
    };
    handle.video.currentTime = time;
  });
}

/** Rec. 601 luma — what "how bright is this pixel" means for video. */
export function lumaPlane(data: Uint8ClampedArray, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i += 1) {
    const p = i * 4;
    out[i] = (0.299 * (data[p] ?? 0) + 0.587 * (data[p + 1] ?? 0) + 0.114 * (data[p + 2] ?? 0)) / 255;
  }
  return out;
}

export function meanAbsoluteDifference(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let total = 0;
  for (let i = 0; i < length; i += 1) total += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return total / length;
}

export function mean(values: Float32Array): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/**
 * How two frames differ, and where.
 *
 * The centroid is weighted by how much each pixel changed, so it lands on
 * whatever actually moved. In a locked-off talking head that is the speaker;
 * in a handheld shot it is the whole frame, which is exactly why callers also
 * look at the overall difference before trusting the position.
 */
export function frameDelta(a: ProbedFrame, b: ProbedFrame): FrameDelta {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  if (width === 0 || height === 0) {
    return { difference: 0, brightnessShift: 0, centroidX: 0.5, centroidY: 0.5, upperShare: 0 };
  }

  let total = 0;
  let weightedX = 0;
  let weightedY = 0;
  let upper = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const change = Math.abs((a.luma[index] ?? 0) - (b.luma[index] ?? 0));
      if (change < 0.04) continue; // Sensor noise, not movement.
      total += change;
      weightedX += change * x;
      weightedY += change * y;
      if (y < height / 3) upper += change;
    }
  }

  const difference = total / (width * height);
  if (total <= 0) {
    return { difference: 0, brightnessShift: b.brightness - a.brightness, centroidX: 0.5, centroidY: 0.5, upperShare: 0 };
  }

  return {
    difference,
    brightnessShift: b.brightness - a.brightness,
    centroidX: weightedX / total / Math.max(1, width - 1),
    centroidY: weightedY / total / Math.max(1, height - 1),
    upperShare: upper / total,
  };
}

/**
 * How much the subject was moving over a run of frames.
 *
 * Averaged consecutive differences: a speaker mid-gesture scores high, a
 * speaker holding still scores near zero. This is what tells the difference
 * between "cutting during movement", which hides an edit, and "cutting on a
 * held pose", which exposes one.
 */
export function motionEnergy(frames: ProbedFrame[]): number {
  if (frames.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < frames.length; i += 1) {
    total += meanAbsoluteDifference(frames[i - 1]!.luma, frames[i]!.luma);
  }
  return total / (frames.length - 1);
}

/**
 * Where the movement is, averaged over a run of frames.
 *
 * A *proxy* for where the speaker is — in a talking head the thing that moves
 * is the person. It is not face detection and is never reported as such.
 */
export function motionCentroid(frames: ProbedFrame[]): { x: number; y: number; strength: number } {
  if (frames.length < 2) return { x: 0.5, y: 0.5, strength: 0 };
  let x = 0;
  let y = 0;
  let strength = 0;
  for (let i = 1; i < frames.length; i += 1) {
    const delta = frameDelta(frames[i - 1]!, frames[i]!);
    const weight = delta.difference;
    x += delta.centroidX * weight;
    y += delta.centroidY * weight;
    strength += weight;
  }
  if (strength <= 0) return { x: 0.5, y: 0.5, strength: 0 };
  return { x: x / strength, y: y / strength, strength: strength / (frames.length - 1) };
}
