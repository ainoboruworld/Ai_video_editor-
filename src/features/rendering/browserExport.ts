/**
 * In-browser video export.
 *
 * The project is played back once through the same compositor the preview uses,
 * the canvas is captured as a video track, and the Web Audio mix is captured as
 * an audio track. MediaRecorder muxes both into a real file the user downloads.
 *
 * This is the export path that works on Vercel with zero external services —
 * no serverless function ever touches the media. For long-form or batch
 * rendering, `cloudExport` hands the same project document to a Remotion worker.
 */
import { sequenceDuration } from '@/lib/engine';
import type { PlaybackEngine } from '@/features/timeline/playback';
import type { ExportSettings } from '@/types';

export interface ExportProgress {
  phase: 'preparing' | 'rendering' | 'processing' | 'complete' | 'failed';
  progress: number;
  message: string;
}

export interface ExportResult {
  blob: Blob;
  url: string;
  filename: string;
  mimeType: string;
  durationSeconds: number;
  sizeBytes: number;
}

/**
 * MP4 candidates always name their codecs.
 *
 * Some Chromium builds report `isTypeSupported('video/mp4') === true` while
 * having no H.264 encoder, and then emit a file no player can open. Asking for
 * an explicit avc1/aac profile is the reliable probe: browsers that really can
 * record MP4 (desktop Chrome, Edge, Safari) answer yes, and the rest fall
 * through to WebM, which is always muxed correctly.
 */
const MP4_TYPES = [
  'video/mp4;codecs=avc1.4d002a,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=h264,aac',
];

const WEBM_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

/** The best container/codec this browser can actually record. */
export function pickMimeType(preferred: 'mp4' | 'webm'): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const ordered = preferred === 'mp4' ? [...MP4_TYPES, ...WEBM_TYPES] : [...WEBM_TYPES, ...MP4_TYPES];
  return ordered.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export function isBrowserExportSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

function bitrateFor(width: number, height: number, quality: 'standard' | 'high'): number {
  const pixels = width * height;
  const base = pixels >= 1920 * 1080 ? 9_000_000 : pixels >= 1280 * 720 ? 5_000_000 : 3_000_000;
  return quality === 'high' ? Math.round(base * 1.6) : base;
}

export interface BrowserExportInput {
  engine: PlaybackEngine;
  sequence: Parameters<PlaybackEngine['update']>[0];
  settings: ExportSettings;
  projectName: string;
  onProgress: (progress: ExportProgress) => void;
  signal?: AbortSignal;
}

/**
 * Records the timeline in real time. Returns a downloadable file — this is a
 * genuine encode, not a simulated progress bar.
 */
export async function exportInBrowser(input: BrowserExportInput): Promise<ExportResult> {
  const { engine, sequence, settings, onProgress, signal } = input;

  if (!isBrowserExportSupported()) {
    throw new Error('This browser cannot record video. Try Chrome, Edge or Firefox, or use cloud rendering.');
  }

  const duration = sequenceDuration(sequence);
  if (duration <= 0.1) throw new Error('Nothing to export — the timeline is empty.');

  const mimeType = pickMimeType(settings.format);
  if (!mimeType) throw new Error('No supported recording format found in this browser.');

  const aspect = sequence.width / sequence.height;
  const height = settings.resolution;
  const width = Math.round((height * aspect) / 2) * 2;

  onProgress({ phase: 'preparing', progress: 0, message: 'Preparing project…' });

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = width;
  exportCanvas.height = height;

  engine.pause();
  engine.setRate(1);
  engine.setMirror(exportCanvas);
  await engine.prepareForExport();

  const videoStream = exportCanvas.captureStream(settings.fps);

  // Only attach an audio track when the timeline actually carries audio: a
  // silent (or suspended) Web Audio tap makes some browsers stall the muxer and
  // emit an empty file.
  const audioTracks: MediaStreamTrack[] = [];
  if (hasAudibleMedia(sequence)) {
    const running = await engine.pool.resumeAudio();
    const audioStream = running ? engine.pool.captureAudioStream() : null;
    audioTracks.push(...(audioStream?.getAudioTracks() ?? []));
  }

  const tracks = [...videoStream.getVideoTracks(), ...audioTracks];
  const stream = new MediaStream(tracks);

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: bitrateFor(width, height, settings.quality),
    audioBitsPerSecond: 128_000,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const finished = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error('Recording failed — the browser stopped the encoder.'));
  });

  onProgress({ phase: 'rendering', progress: 0, message: 'Rendering…' });
  recorder.start(1000);

  let cancelled = false;
  const onAbort = () => {
    cancelled = true;
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await playThrough(engine, duration, (progress) => {
      onProgress({
        phase: 'rendering',
        progress,
        message: `Rendering… ${Math.round(progress * 100)}%`,
      });
      return !cancelled;
    });
  } finally {
    // Let the encoder flush the final frames before stopping.
    await new Promise((resolve) => setTimeout(resolve, 320));
    if (recorder.state === 'recording') recorder.requestData();
    if (recorder.state !== 'inactive') recorder.stop();
    engine.setMirror(null);
    engine.pause();
    signal?.removeEventListener('abort', onAbort);
  }

  await finished;
  for (const track of tracks) {
    if (track.kind === 'video') track.stop();
  }

  if (cancelled) throw new Error('Export cancelled');

  onProgress({ phase: 'processing', progress: 0.98, message: 'Processing file…' });
  const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
  if (blob.size === 0) {
    throw new Error(
      'The encoder produced an empty file. Try WebM, or keep this tab in the foreground during the export.',
    );
  }

  const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const filename = `${slug(input.projectName)}-${height}p.${extension}`;
  const url = URL.createObjectURL(blob);

  onProgress({ phase: 'complete', progress: 1, message: 'Export complete' });

  return {
    blob,
    url,
    filename,
    mimeType,
    durationSeconds: duration,
    sizeBytes: blob.size,
  };
}

/** True when at least one clip on an audio-capable track can be heard. */
function hasAudibleMedia(sequence: BrowserExportInput['sequence']): boolean {
  const anySolo = sequence.tracks.some((track) => track.solo);
  return sequence.tracks.some((track) => {
    if (track.kind === 'text' || track.kind === 'caption') return false;
    if (anySolo ? !track.solo : track.muted) return false;
    return track.clips.some((clip) => clip.assetId && !clip.muted && clip.volume > 0 && clip.kind !== 'image');
  });
}

/** Plays the timeline once, reporting progress; resolves when the end is reached. */
function playThrough(
  engine: PlaybackEngine,
  duration: number,
  onTick: (progress: number) => boolean,
): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    engine.seek(0);
    engine.play();
    const poll = () => {
      const elapsed = (performance.now() - start) / 1000;
      const progress = Math.min(1, Math.max(engine.currentTime, elapsed) / duration);
      const keepGoing = onTick(progress);
      if (!keepGoing || engine.currentTime >= duration - 0.02 || elapsed > duration + 2) {
        resolve();
        return;
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'export'
  );
}

/** Triggers the browser download for a finished export. */
export function downloadResult(result: ExportResult): void {
  const link = document.createElement('a');
  link.href = result.url;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
