'use client';

/**
 * Audio analysis for editing an existing recording.
 *
 * Everything here runs in the browser on decoded samples: no upload, no API
 * key, no cost. It produces the loudness envelope the auto-editor uses to find
 * dead air, so "remove silences" works even with nothing configured.
 */

export interface LoudnessEnvelope {
  /** RMS per window, 0..1. */
  values: Float32Array;
  /** Seconds per window. */
  windowSeconds: number;
  duration: number;
  /** Loudest window in the recording, used to normalise thresholds. */
  peak: number;
}

export interface Range {
  start: number;
  end: number;
}

export interface SilenceOptions {
  /** Relative to the recording's own peak: 0.06 ≈ -24 dBFS of peak. */
  thresholdRatio?: number;
  /** Ignore silences shorter than this — they are natural speech gaps. */
  minSilenceSeconds?: number;
  /** Leave this much of the silence attached to each side of a cut. */
  paddingSeconds?: number;
  /** Never produce a kept segment shorter than this. */
  minKeepSeconds?: number;
}

const DEFAULTS: Required<SilenceOptions> = {
  thresholdRatio: 0.06,
  minSilenceSeconds: 0.45,
  paddingSeconds: 0.12,
  minKeepSeconds: 0.35,
};

/** Decodes an audio/video URL and measures loudness over time. */
export async function analyseLoudness(url: string, windowSeconds = 0.02, signal?: AbortSignal): Promise<LoudnessEnvelope> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not read the media (${response.status})`);
  const bytes = await response.arrayBuffer();

  const AudioCtor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioCtor();
  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(bytes);
  } catch {
    throw new Error('This file has no decodable audio track, so it cannot be analysed for silence.');
  } finally {
    void context.close().catch(() => undefined);
  }

  return envelopeFromBuffer(buffer, windowSeconds);
}

/** Pure part of the analysis, so it can be unit tested without Web Audio. */
export function envelopeFromBuffer(buffer: AudioBuffer, windowSeconds: number): LoudnessEnvelope {
  const channels = Math.min(2, buffer.numberOfChannels);
  const windowSize = Math.max(1, Math.floor(buffer.sampleRate * windowSeconds));
  const windowCount = Math.max(1, Math.ceil(buffer.length / windowSize));
  const values = new Float32Array(windowCount);

  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c));

  let peak = 0;
  for (let w = 0; w < windowCount; w++) {
    const start = w * windowSize;
    const end = Math.min(buffer.length, start + windowSize);
    let sum = 0;
    let count = 0;
    for (let i = start; i < end; i++) {
      for (const channel of data) {
        const sample = channel[i] ?? 0;
        sum += sample * sample;
        count++;
      }
    }
    const rms = count > 0 ? Math.sqrt(sum / count) : 0;
    values[w] = rms;
    if (rms > peak) peak = rms;
  }

  return { values, windowSeconds, duration: buffer.duration, peak };
}

/**
 * Finds stretches quieter than the threshold for longer than `minSilence`.
 * The threshold is relative to the recording's own peak, so a quietly recorded
 * voice memo and a loud interview both work without the user tuning anything.
 */
export function detectSilences(envelope: LoudnessEnvelope, options: SilenceOptions = {}): Range[] {
  const config = { ...DEFAULTS, ...options };
  const threshold = Math.max(0.0015, envelope.peak * config.thresholdRatio);
  const silences: Range[] = [];

  let runStart: number | null = null;
  for (let i = 0; i < envelope.values.length; i++) {
    const quiet = (envelope.values[i] ?? 0) < threshold;
    const time = i * envelope.windowSeconds;
    if (quiet && runStart === null) {
      runStart = time;
    } else if (!quiet && runStart !== null) {
      pushSilence(silences, runStart, time, config);
      runStart = null;
    }
  }
  if (runStart !== null) pushSilence(silences, runStart, envelope.duration, config);

  return silences;
}

function pushSilence(out: Range[], start: number, end: number, config: Required<SilenceOptions>): void {
  if (end - start < config.minSilenceSeconds) return;
  // Keep a little air either side so cuts do not clip the start of words.
  const padded = { start: start + config.paddingSeconds, end: end - config.paddingSeconds };
  if (padded.end - padded.start > 0.05) out.push(padded);
}

/** The complement of the silences: the parts worth keeping. */
export function speechRanges(envelope: LoudnessEnvelope, silences: Range[], minKeepSeconds = DEFAULTS.minKeepSeconds): Range[] {
  const kept: Range[] = [];
  let cursor = 0;
  for (const silence of silences) {
    if (silence.start - cursor >= minKeepSeconds) kept.push({ start: cursor, end: silence.start });
    cursor = Math.max(cursor, silence.end);
  }
  if (envelope.duration - cursor >= minKeepSeconds) kept.push({ start: cursor, end: envelope.duration });
  return kept;
}

export function totalDuration(ranges: Range[]): number {
  return ranges.reduce((sum, range) => sum + Math.max(0, range.end - range.start), 0);
}

/** Merges ranges that touch or overlap, so cuts never fight each other. */
export function mergeRanges(ranges: Range[], gap = 0.02): Range[] {
  const sorted = [...ranges].filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start - last.end <= gap) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** Inverts a set of keep-ranges into the cuts needed to produce them. */
export function invertRanges(keep: Range[], duration: number): Range[] {
  const merged = mergeRanges(keep);
  const cuts: Range[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start - cursor > 0.02) cuts.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (duration - cursor > 0.02) cuts.push({ start: cursor, end: duration });
  return cuts;
}

/** Words an editor usually strips from a talking-head recording. */
export const FILLER_WORDS = ['um', 'uh', 'erm', 'ah', 'like', 'you know', 'i mean', 'sort of', 'kind of', 'basically', 'actually', 'literally'];

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
}

/** Finds filler words in transcript timings so they can be cut. */
export function detectFillers(words: TranscriptWord[], fillers: string[] = FILLER_WORDS): Range[] {
  const normalised = (value: string) => value.toLowerCase().replace(/[^a-z' ]/g, '').trim();
  const single = new Set(fillers.filter((f) => !f.includes(' ')));
  const phrases = fillers.filter((f) => f.includes(' ')).map((f) => f.split(' '));
  const found: Range[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word) continue;
    if (single.has(normalised(word.text))) {
      found.push({ start: word.start, end: word.end });
      continue;
    }
    for (const phrase of phrases) {
      const slice = words.slice(i, i + phrase.length);
      if (slice.length !== phrase.length) continue;
      if (slice.every((w, index) => normalised(w.text) === phrase[index])) {
        found.push({ start: slice[0]!.start, end: slice[slice.length - 1]!.end });
        break;
      }
    }
  }
  return mergeRanges(found, 0.05);
}
