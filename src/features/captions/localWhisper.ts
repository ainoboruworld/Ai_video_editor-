'use client';

/**
 * Whisper running in the browser.
 *
 * This is the transcription path that cannot run out: the model is downloaded
 * once from the Hugging Face CDN, cached by the browser, and runs on the user's
 * own hardware. No API key, no quota, no per-minute cost, and the audio never
 * leaves the machine.
 *
 * The trade-off is the first-run download and CPU time, so it is offered
 * alongside the hosted providers rather than replacing them.
 */
import type { CaptionCue } from '@/types';

export type WhisperModelSize = 'tiny' | 'base' | 'small';

export interface LocalWhisperModel {
  id: string;
  label: string;
  /** Approximate download size, shown before the user commits to it. */
  downloadMb: number;
  note: string;
}

export const LOCAL_WHISPER_MODELS: Record<WhisperModelSize, LocalWhisperModel> = {
  tiny: {
    id: 'onnx-community/whisper-tiny.en',
    label: 'Whisper tiny',
    downloadMb: 40,
    note: 'Fastest. Good for clear speech.',
  },
  base: {
    id: 'onnx-community/whisper-base.en',
    label: 'Whisper base',
    downloadMb: 80,
    note: 'Better accuracy, still quick.',
  },
  small: {
    id: 'onnx-community/whisper-small.en',
    label: 'Whisper small',
    downloadMb: 250,
    note: 'Most accurate. Slower on CPU.',
  },
};

export interface LocalTranscribeOptions {
  model?: WhisperModelSize;
  onProgress?: (message: string, fraction?: number) => void;
  signal?: AbortSignal;
}

type TransformersPipeline = (
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ text?: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>;

let cached: { model: string; pipeline: TransformersPipeline } | null = null;

/** True when this browser can run the local model at all. */
export function isLocalWhisperSupported(): boolean {
  return typeof WebAssembly === 'object' && typeof Worker !== 'undefined';
}

/** Whether WebGPU is available, which makes transcription several times faster. */
export async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

/**
 * Loads (and caches) the ASR pipeline. The library is imported dynamically so
 * its ~16 MB never lands in the main bundle for users who do not use it.
 */
async function getPipeline(model: WhisperModelSize, onProgress?: LocalTranscribeOptions['onProgress']): Promise<TransformersPipeline> {
  const spec = LOCAL_WHISPER_MODELS[model];
  if (cached?.model === spec.id) return cached.pipeline;

  onProgress?.(`Loading ${spec.label} (~${spec.downloadMb} MB, cached after the first run)…`, 0);
  const { pipeline } = await import('@huggingface/transformers');
  const device = (await hasWebGpu()) ? 'webgpu' : 'wasm';

  let asr: TransformersPipeline;
  try {
    asr = (await pipeline('automatic-speech-recognition', spec.id, {
    device,
    dtype: device === 'webgpu' ? 'fp16' : 'q8',
    progress_callback: (event: { status?: string; progress?: number; file?: string }) => {
      if (event.status === 'progress' && typeof event.progress === 'number') {
        onProgress?.(`Downloading ${spec.label}… ${Math.round(event.progress)}%`, event.progress / 100);
      }
    },
    })) as unknown as TransformersPipeline;
  } catch (error) {
    // The model is fetched from the Hugging Face CDN on first use; a blocked or
    // offline network is by far the most likely reason to land here.
    throw new Error(
      `Could not load ${spec.label}. The model downloads from huggingface.co on first use — check the connection, ` +
        `or use a hosted provider instead. (${error instanceof Error ? error.message : 'unknown error'})`,
    );
  }

  cached = { model: spec.id, pipeline: asr };
  return asr;
}

/**
 * Transcribes a WAV blob locally and returns timed cues.
 *
 * Whisper wants 16 kHz mono float samples, which is exactly what the timeline
 * mixdown already produces — so the audio is decoded straight to a Float32Array
 * with no re-encoding.
 */
export async function transcribeLocally(audio: Blob, options: LocalTranscribeOptions = {}): Promise<CaptionCue[]> {
  if (!isLocalWhisperSupported()) {
    throw new Error('This browser cannot run the local model. Use a hosted provider instead.');
  }

  const model = options.model ?? 'base';
  const asr = await getPipeline(model, options.onProgress);
  options.signal?.throwIfAborted();

  options.onProgress?.('Decoding audio…');
  const samples = await decodeToMono16k(audio);

  options.onProgress?.('Transcribing on this device…');
  const output = await asr(samples, {
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
  });

  const chunks = output.chunks ?? [];
  if (chunks.length === 0) {
    const text = (output.text ?? '').trim();
    return text ? [{ text, start: 0, end: samples.length / 16_000, words: [] }] : [];
  }

  const duration = samples.length / 16_000;
  return chunks
    .map((chunk) => ({
      text: chunk.text.trim(),
      start: chunk.timestamp[0] ?? 0,
      // The final chunk can come back with an open end.
      end: chunk.timestamp[1] ?? duration,
      words: [],
    }))
    .filter((cue) => cue.text.length > 0 && cue.end > cue.start);
}

/** Decodes any audio blob to the 16 kHz mono samples Whisper expects. */
async function decodeToMono16k(audio: Blob): Promise<Float32Array> {
  const bytes = await audio.arrayBuffer();
  const AudioCtor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioCtor();
  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(bytes);
  } finally {
    void context.close().catch(() => undefined);
  }

  if (buffer.sampleRate === 16_000 && buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0).slice();
  }

  const offline = new OfflineAudioContext(1, Math.ceil((buffer.duration * 16_000) || 1), 16_000);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const resampled = await offline.startRendering();
  return resampled.getChannelData(0).slice();
}
