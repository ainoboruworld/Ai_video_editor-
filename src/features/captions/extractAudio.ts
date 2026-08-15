/**
 * Offline audio mixdown for automatic captions.
 *
 * Renders the timeline's audio (video audio + music + voiceover, with clip
 * volume and fades applied) into a 16 kHz mono WAV entirely in the browser.
 * That keeps the upload small enough for a serverless request — roughly
 * 32 kB per second of speech — and means no media file is ever sent to a
 * transcription provider at full size.
 */
import { audibleClips } from '@/features/timeline/compositor';
import type { Sequence } from '@/lib/engine';
import { sequenceDuration } from '@/lib/engine';
import type { Asset } from '@/types';

const TARGET_RATE = 16_000;

export interface MixdownOptions {
  sequence: Sequence;
  assets: Asset[];
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}

export async function renderTimelineAudio(options: MixdownOptions): Promise<Blob> {
  const { sequence, assets } = options;
  const duration = sequenceDuration(sequence);
  if (duration <= 0) throw new Error('The timeline is empty.');

  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));

  // Sample the timeline once to find every clip that contributes audio.
  const contributing = new Map<string, { clip: ReturnType<typeof audibleClips>[number]['clip'] }>();
  for (let t = 0; t < duration; t += 0.25) {
    for (const entry of audibleClips(sequence, t)) {
      if (entry.clip.assetId && entry.clip.kind !== 'image' && entry.clip.kind !== 'text') {
        contributing.set(entry.clip.id, { clip: entry.clip });
      }
    }
  }
  if (contributing.size === 0) throw new Error('No audio on the timeline to transcribe.');

  options.onProgress?.('Decoding audio…');
  const decodeContext = new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const buffers = new Map<string, AudioBuffer>();

  try {
    for (const { clip } of contributing.values()) {
      const asset = clip.assetId ? assetMap.get(clip.assetId) : null;
      if (!asset || buffers.has(asset.id)) continue;
      try {
        const res = await fetch(asset.url, { signal: options.signal });
        if (!res.ok) continue;
        const bytes = await res.arrayBuffer();
        buffers.set(asset.id, await decodeContext.decodeAudioData(bytes));
      } catch {
        // A clip whose audio cannot be decoded is skipped rather than failing
        // the whole caption run.
      }
    }
  } finally {
    void decodeContext.close().catch(() => undefined);
  }

  if (buffers.size === 0) {
    throw new Error('Could not decode any audio from this timeline.');
  }

  options.onProgress?.('Mixing audio…');
  const offline = new OfflineAudioContext(1, Math.ceil(duration * TARGET_RATE), TARGET_RATE);

  for (const { clip } of contributing.values()) {
    const buffer = clip.assetId ? buffers.get(clip.assetId) : null;
    if (!buffer) continue;
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.0625, Math.min(16, clip.speed));

    const gain = offline.createGain();
    const level = clip.muted ? 0 : Math.max(0, Math.min(2, clip.volume));
    gain.gain.setValueAtTime(level, Math.max(0, clip.start));
    if (clip.fadeIn > 0) {
      gain.gain.setValueAtTime(0, Math.max(0, clip.start));
      gain.gain.linearRampToValueAtTime(level, clip.start + clip.fadeIn);
    }
    if (clip.fadeOut > 0) {
      const end = clip.start + clip.duration;
      gain.gain.setValueAtTime(level, Math.max(0, end - clip.fadeOut));
      gain.gain.linearRampToValueAtTime(0, end);
    }

    source.connect(gain);
    gain.connect(offline.destination);
    source.start(Math.max(0, clip.start), Math.max(0, clip.sourceIn), clip.duration * clip.speed);
  }

  const rendered = await offline.startRendering();
  options.onProgress?.('Encoding audio…');
  return encodeWav(rendered);
}

/** Minimal 16-bit PCM WAV encoder — no dependency, no server round-trip. */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channelData = buffer.getChannelData(0);
  const bytes = new ArrayBuffer(44 + channelData.length * 2);
  const view = new DataView(bytes);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + channelData.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, channelData.length * 2, true);

  let offset = 44;
  for (let i = 0; i < channelData.length; i++) {
    const sample = Math.max(-1, Math.min(1, channelData[i]!));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([bytes], { type: 'audio/wav' });
}
