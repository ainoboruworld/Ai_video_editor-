/**
 * Media element pool.
 *
 * Media elements are kept out of the DOM tree the user sees, and the pool owns
 * readiness, seeking and the Web Audio graph so the canvas compositor can stay
 * a pure drawing routine.
 *
 * Elements are keyed by asset *and slot* rather than by asset alone. A cross-
 * dissolve between two cuts of the same recording needs two frames of one file
 * on screen at the same time, and a single element can only be at one
 * timestamp — with one element per asset the two clips fought over
 * `currentTime` and the dissolve was impossible. Slots are only allocated when
 * a second clip actually needs one, so a project that never overlaps a file
 * with itself still decodes it once.
 */
import type { Asset } from '@/types';

export type PooledElement = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;

interface Entry {
  asset: Asset;
  element: PooledElement;
  ready: boolean;
  failed: boolean;
  /** Web Audio nodes, created lazily the first time audio is routed. */
  source?: MediaElementAudioSourceNode;
  gain?: GainNode;
}

/** Two is enough: a dissolve joins exactly two clips. */
export const MAX_SLOTS = 2;

function poolKey(assetId: string, slot: number): string {
  return slot === 0 ? assetId : `${assetId}#${slot}`;
}

export class MediaPool {
  private entries = new Map<string, Entry>();
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private streamDestination: MediaStreamAudioDestinationNode | null = null;
  private listeners = new Set<() => void>();

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** Creates (or returns) the element backing an asset in a given slot. */
  acquire(asset: Asset, slot = 0): Entry {
    const key = poolKey(asset.id, slot);
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.asset.url !== asset.url) {
        this.release(asset.id, slot);
      } else {
        return existing;
      }
    }

    let element: PooledElement;
    if (asset.kind === 'image') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.src = asset.url;
      element = img;
    } else {
      const media = document.createElement(asset.kind === 'audio' ? 'audio' : 'video');
      media.crossOrigin = 'anonymous';
      media.preload = 'auto';
      if (media instanceof HTMLVideoElement) media.playsInline = true;
      media.muted = false;
      media.src = asset.url;
      element = media;
    }

    const entry: Entry = { asset, element, ready: false, failed: false };
    this.entries.set(key, entry);

    const markReady = () => {
      entry.ready = true;
      this.emit();
    };
    const markFailed = () => {
      entry.failed = true;
      entry.ready = false;
      this.emit();
    };

    if (element instanceof HTMLImageElement) {
      if (element.complete && element.naturalWidth > 0) markReady();
      element.addEventListener('load', markReady, { once: true });
      element.addEventListener('error', markFailed, { once: true });
    } else {
      element.addEventListener('loadeddata', markReady);
      element.addEventListener('canplay', markReady);
      element.addEventListener('error', markFailed);
      element.load();
    }

    return entry;
  }

  get(assetId: string, slot = 0): Entry | undefined {
    return this.entries.get(poolKey(assetId, slot));
  }

  isReady(assetId: string): boolean {
    return this.entries.get(assetId)?.ready ?? false;
  }

  hasFailed(assetId: string): boolean {
    return this.entries.get(assetId)?.failed ?? false;
  }

  /** Every live element, for the "pause what is not under the playhead" sweep. */
  activeKeys(): string[] {
    return [...this.entries.keys()];
  }

  entryByKey(key: string): Entry | undefined {
    return this.entries.get(key);
  }

  static key = poolKey;

  /** Drops assets that are no longer referenced by the project. */
  retain(assets: Asset[]): void {
    const keep = new Set(assets.map((a) => a.id));
    for (const key of [...this.entries.keys()]) {
      const assetId = key.split('#')[0]!;
      if (!keep.has(assetId)) this.releaseKey(key);
    }
    for (const asset of assets) this.acquire(asset);
  }

  release(assetId: string, slot = 0): void {
    this.releaseKey(poolKey(assetId, slot));
  }

  private releaseKey(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.element instanceof HTMLMediaElement) {
      entry.element.pause();
      entry.element.removeAttribute('src');
      entry.element.load();
    }
    try {
      entry.source?.disconnect();
      entry.gain?.disconnect();
    } catch {
      // Node already detached.
    }
    this.entries.delete(key);
  }

  destroy(): void {
    for (const key of [...this.entries.keys()]) this.releaseKey(key);
    this.listeners.clear();
    void this.audioContext?.close().catch(() => undefined);
    this.audioContext = null;
    this.masterGain = null;
    this.streamDestination = null;
  }

  // ------------------------------------------------------------- audio ---

  /** Lazily creates the shared AudioContext (must follow a user gesture). */
  ensureAudio(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioContext) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.audioContext = new Ctor();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.connect(this.audioContext.destination);
    }
    if (this.audioContext.state === 'suspended') void this.audioContext.resume().catch(() => undefined);
    return this.audioContext;
  }

  /** Per-asset gain node; created on first use so silent projects cost nothing. */
  gainFor(assetId: string, slot = 0): GainNode | null {
    const entry = this.entries.get(poolKey(assetId, slot));
    if (!entry || !(entry.element instanceof HTMLMediaElement)) return null;
    const ctx = this.ensureAudio();
    if (!ctx || !this.masterGain) return null;
    if (!entry.gain) {
      try {
        entry.source = ctx.createMediaElementSource(entry.element);
        entry.gain = ctx.createGain();
        entry.source.connect(entry.gain);
        entry.gain.connect(this.masterGain);
        if (this.streamDestination) entry.gain.connect(this.streamDestination);
      } catch {
        // Element already bound to a source node (React strict-mode remount).
        return entry.gain ?? null;
      }
    }
    return entry.gain ?? null;
  }

  /** Resumes the audio graph; returns false when audio is unavailable. */
  async resumeAudio(): Promise<boolean> {
    const ctx = this.ensureAudio();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        return false;
      }
    }
    return ctx.state === 'running';
  }

  /** Taps the mixed output as a MediaStream for the browser exporter. */
  captureAudioStream(): MediaStream | null {
    const ctx = this.ensureAudio();
    if (!ctx) return null;
    if (!this.streamDestination) {
      this.streamDestination = ctx.createMediaStreamDestination();
      for (const entry of this.entries.values()) {
        entry.gain?.connect(this.streamDestination);
      }
    }
    return this.streamDestination.stream;
  }

  setMasterVolume(value: number): void {
    if (this.masterGain) this.masterGain.gain.value = Math.max(0, Math.min(2, value));
  }
}
