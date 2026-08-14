import type { Sequence } from './types.js';

export interface SnapResult {
  time: number;
  snapped: boolean;
  target: number | null;
}

/** Collect all snap targets: clip boundaries, markers, playhead, sequence start/end. */
export function snapTargets(seq: Sequence, playhead: number, excludeClipIds: Set<string> = new Set()): number[] {
  const targets = new Set<number>([0, playhead]);
  let end = 0;
  for (const track of seq.tracks) {
    for (const clip of track.clips) {
      end = Math.max(end, clip.start + clip.duration);
      if (excludeClipIds.has(clip.id)) continue;
      targets.add(clip.start);
      targets.add(clip.start + clip.duration);
    }
  }
  targets.add(end);
  for (const m of seq.markers) targets.add(m.time);
  return [...targets].sort((a, b) => a - b);
}

/** Snap a candidate time to the nearest target within threshold (seconds). */
export function snapTime(time: number, targets: number[], threshold: number): SnapResult {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const t of targets) {
    const d = Math.abs(t - time);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  if (best !== null && bestDist <= threshold) {
    return { time: best, snapped: true, target: best };
  }
  return { time, snapped: false, target: null };
}
