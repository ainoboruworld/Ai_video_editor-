/**
 * Playback engine.
 *
 * Owns the clock, keeps every media element in sync with the timeline, applies
 * the audio mix (clip volume, fades, track mute/solo) and drives the compositor.
 * The editor UI never touches a <video> element directly.
 */
import { interpolate, sequenceDuration, type Clip, type Sequence } from '@/lib/engine';
import type { Asset } from '@/types';
import { MediaPool, type PooledElement } from '@/features/media/mediaPool';
import { audibleClips, drawFrame, visibleLayers, type DrawableSource } from './compositor';

/** Above this drift (seconds) we re-seek instead of letting the element catch up. */
const SYNC_TOLERANCE = 0.28;
const SEEK_TOLERANCE = 0.06;

export interface PlaybackOptions {
  onTimeUpdate: (time: number) => void;
  onEnded: () => void;
}

export class PlaybackEngine {
  readonly pool = new MediaPool();
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private sequence: Sequence | null = null;
  private assets = new Map<string, Asset>();
  private raf = 0;
  private lastTick = 0;
  private time = 0;
  private playing = false;
  private rate = 1;
  private options: PlaybackOptions;
  /** When set, every painted frame is copied (and scaled) here — the exporter's canvas. */
  private mirrorCanvas: HTMLCanvasElement | null = null;
  private mirrorCtx: CanvasRenderingContext2D | null = null;

  constructor(options: PlaybackOptions) {
    this.options = options;
  }

  attach(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    this.ctx = canvas?.getContext('2d', { alpha: false }) ?? null;
    this.paint();
  }

  setMirror(canvas: HTMLCanvasElement | null): void {
    this.mirrorCanvas = canvas;
    this.mirrorCtx = canvas?.getContext('2d', { alpha: false }) ?? null;
    if (this.mirrorCtx) {
      this.mirrorCtx.imageSmoothingEnabled = true;
      this.mirrorCtx.imageSmoothingQuality = 'high';
    }
  }

  update(sequence: Sequence, assets: Asset[]): void {
    this.sequence = sequence;
    this.assets = new Map(assets.map((asset) => [asset.id, asset]));
    this.pool.retain(assets);
    if (this.canvas && (this.canvas.width !== sequence.width || this.canvas.height !== sequence.height)) {
      this.canvas.width = sequence.width;
      this.canvas.height = sequence.height;
    }
    if (!this.playing) this.paint();
  }

  get currentTime(): number {
    return this.time;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  setRate(rate: number): void {
    this.rate = Math.max(0.1, Math.min(4, rate));
  }

  seek(time: number): void {
    const duration = this.sequence ? sequenceDuration(this.sequence) : 0;
    this.time = Math.max(0, Math.min(time, Math.max(0, duration)));
    this.syncElements(true);
    this.paint();
    this.options.onTimeUpdate(this.time);
  }

  play(): void {
    if (this.playing || !this.sequence) return;
    const duration = sequenceDuration(this.sequence);
    if (duration <= 0) return;
    if (this.time >= duration - 0.02) this.time = 0;
    this.pool.ensureAudio();
    this.playing = true;
    this.lastTick = performance.now();
    this.loop(this.lastTick);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.pauseAll();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.pool.destroy();
  }

  /** Advances the clock manually — used by the exporter to record a run. */
  tickTo(time: number): void {
    this.time = time;
    this.syncElements(false);
    this.paint();
  }

  private loop = (now: number): void => {
    if (!this.playing || !this.sequence) return;
    const delta = ((now - this.lastTick) / 1000) * this.rate;
    this.lastTick = now;
    const duration = sequenceDuration(this.sequence);
    this.time = this.time + delta;

    if (this.time >= duration) {
      this.time = duration;
      this.playing = false;
      this.pauseAll();
      this.paint();
      this.options.onTimeUpdate(this.time);
      this.options.onEnded();
      return;
    }

    this.syncElements(false);
    this.paint();
    this.options.onTimeUpdate(this.time);
    this.raf = requestAnimationFrame(this.loop);
  };

  /** Aligns every media element with the playhead and applies the audio mix. */
  private syncElements(forceSeek: boolean): void {
    const seq = this.sequence;
    if (!seq) return;

    const active = new Set<string>();
    const layers = visibleLayers(seq, this.time);
    const audible = audibleClips(seq, this.time);
    const audibleIds = new Map(audible.map(({ clip, track }) => [clip.id, track]));

    for (const { clip } of [...layers, ...audible.map(({ clip }) => ({ clip }))]) {
      if (!clip.assetId) continue;
      const asset = this.assets.get(clip.assetId);
      if (!asset) continue;
      const entry = this.pool.get(asset.id) ?? this.pool.acquire(asset);
      active.add(asset.id);
      const element = entry.element;
      if (!(element instanceof HTMLMediaElement)) continue;

      const localTime = this.time - clip.start;
      const target = clip.sourceIn + localTime * clip.speed;
      const drift = Math.abs(element.currentTime - target);
      if (forceSeek ? drift > SEEK_TOLERANCE : drift > SYNC_TOLERANCE) {
        try {
          element.currentTime = Math.max(0, target);
        } catch {
          // Seeking before metadata is available — retried on the next tick.
        }
      }
      element.playbackRate = Math.max(0.0625, Math.min(16, clip.speed * this.rate));

      // Audio mix
      const trackForClip = audibleIds.get(clip.id);
      const gainValue = trackForClip ? this.clipGain(clip, localTime) : 0;
      const gain = gainValue > 0 ? this.pool.gainFor(asset.id) : this.pool.get(asset.id)?.gain ?? null;
      if (gain) {
        gain.gain.value = gainValue;
      } else {
        element.volume = Math.max(0, Math.min(1, gainValue));
      }
      element.muted = gainValue <= 0.0001;

      if (this.playing && element.paused) {
        void element.play().catch(() => undefined);
      } else if (!this.playing && !element.paused) {
        element.pause();
      }
    }

    // Anything not under the playhead must not keep playing.
    for (const [assetId] of this.assets) {
      if (active.has(assetId)) continue;
      const entry = this.pool.get(assetId);
      const element = entry?.element as PooledElement | undefined;
      if (element instanceof HTMLMediaElement && !element.paused) element.pause();
    }
  }

  /** Clip volume including fade in/out and keyframed volume. */
  private clipGain(clip: Clip, localTime: number): number {
    if (clip.muted) return 0;
    let volume = interpolate(clip.keyframes.volume, localTime, clip.volume);
    if (clip.fadeIn > 0 && localTime < clip.fadeIn) volume *= localTime / clip.fadeIn;
    const remaining = clip.duration - localTime;
    if (clip.fadeOut > 0 && remaining < clip.fadeOut) volume *= Math.max(0, remaining) / clip.fadeOut;
    return Math.max(0, Math.min(4, volume));
  }

  private resolve = (clip: Clip): DrawableSource | null => {
    if (!clip.assetId) return null;
    const entry = this.pool.get(clip.assetId);
    if (!entry || !entry.ready) return null;
    const element = entry.element;
    if (element instanceof HTMLImageElement) return element;
    if (element instanceof HTMLVideoElement) return element;
    return null;
  };

  paint(): void {
    const seq = this.sequence;
    if (!seq) return;
    if (this.ctx && this.canvas) {
      if (this.canvas.width !== seq.width || this.canvas.height !== seq.height) {
        this.canvas.width = seq.width;
        this.canvas.height = seq.height;
      }
      drawFrame(this.ctx, seq, this.time, { resolve: this.resolve, assets: this.assets });
    }
    // The export canvas is a scaled copy of the same frame, so preview and
    // export can never drift apart.
    if (this.mirrorCanvas && this.mirrorCtx && this.canvas) {
      this.mirrorCtx.drawImage(this.canvas, 0, 0, this.mirrorCanvas.width, this.mirrorCanvas.height);
    }
  }

  private pauseAll(): void {
    for (const [assetId] of this.assets) {
      const element = this.pool.get(assetId)?.element;
      if (element instanceof HTMLMediaElement) element.pause();
    }
  }

  /** Preloads and seeks every element so an export starts on a clean frame. */
  async prepareForExport(): Promise<void> {
    const seq = this.sequence;
    if (!seq) return;
    this.pool.ensureAudio();
    this.seek(0);
    await new Promise((resolve) => setTimeout(resolve, 240));
  }
}
