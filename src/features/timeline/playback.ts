/**
 * Playback engine.
 *
 * Owns the clock, keeps every media element in sync with the timeline, applies
 * the audio mix (clip volume, fades, track mute/solo) and drives the compositor.
 * The editor UI never touches a <video> element directly.
 */
import { interpolate, sequenceDuration, type Clip, type Sequence } from '@/lib/engine';
import type { Asset } from '@/types';
import { MAX_SLOTS, MediaPool, type PooledElement } from '@/features/media/mediaPool';
import { audibleClips, drawFrame, visibleLayers, type DrawableSource } from './compositor';

/** Above this drift (seconds) we re-seek instead of letting the element catch up. */
const SYNC_TOLERANCE = 0.28;
const SEEK_TOLERANCE = 0.06;
/**
 * How far ahead a clip's element is woken up and pointed at its first frame.
 *
 * A cut makes the picture jump to a different part of the file, and a <video>
 * asked for a new position mid-playback shows nothing until it has decoded —
 * which used to blank the canvas for a quarter of a second at every join. This
 * gets the seek out of the way before the playhead arrives.
 */
const PREROLL_SECONDS = 0.7;
/** Snapshot cadence for the held-frame cache: often enough to be current. */
const SNAPSHOT_EVERY_MS = 90;

export interface PlaybackOptions {
  onTimeUpdate: (time: number) => void;
  onEnded: () => void;
}

export class PlaybackEngine {
  readonly pool = new MediaPool();
  /** clip id → media element slot. See assignSlots. */
  private slots = new Map<string, number>();
  /**
   * The last frame each element was known to be showing.
   *
   * While an element is seeking it has no frame to give — some builds hand back
   * a black one — so the compositor is given this instead. Holding the previous
   * picture for two or three frames is invisible; dropping to black is the most
   * visible thing in the whole edit.
   */
  private heldFrames = new Map<string, { canvas: HTMLCanvasElement; at: number }>();
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
    this.assignSlots(sequence);
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

  /**
   * Which element each clip plays through.
   *
   * Clips of the same asset alternate between two elements in track order, so
   * any two neighbours — the only pair a dissolve can overlap — always hold
   * different elements. Assigned per sequence rather than per frame: a clip
   * that changed element as an overlap began would re-seek and stutter at
   * exactly the moment it needs to be smooth.
   */
  private slotFor(clip: Clip): number {
    return this.slots.get(clip.id) ?? 0;
  }

  private assignSlots(seq: Sequence): void {
    const slots = new Map<string, number>();
    for (const track of seq.tracks) {
      const seen = new Map<string, number>();
      for (const clip of track.clips) {
        if (!clip.assetId) continue;
        const index = seen.get(clip.assetId) ?? 0;
        seen.set(clip.assetId, index + 1);
        slots.set(clip.id, index % MAX_SLOTS);
      }
    }
    this.slots = slots;

    for (const [clipId, slot] of slots) {
      if (slot === 0) continue;
      const clip = seq.tracks.flatMap((track) => track.clips).find((c) => c.id === clipId);
      const asset = clip?.assetId ? this.assets.get(clip.assetId) : undefined;
      if (asset) this.pool.acquire(asset, slot);
    }
  }

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
      const slot = this.slotFor(clip);
      const entry = this.pool.get(asset.id, slot) ?? this.pool.acquire(asset, slot);
      active.add(MediaPool.key(asset.id, slot));
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
      const gain = gainValue > 0 ? this.pool.gainFor(asset.id, slot) : this.pool.get(asset.id, slot)?.gain ?? null;
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

    this.preroll(seq, active);

    // Anything not under the playhead must not keep playing — including the
    // second element of an asset once its overlap is over.
    for (const key of this.pool.activeKeys()) {
      if (active.has(key)) continue;
      const element = this.pool.entryByKey(key)?.element as PooledElement | undefined;
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
    const key = MediaPool.key(clip.assetId, this.slotFor(clip));
    const entry = this.pool.get(clip.assetId, this.slotFor(clip));
    const element = entry?.element;
    if (element instanceof HTMLImageElement) return entry?.ready ? element : null;
    if (!(element instanceof HTMLVideoElement)) return null;

    // HAVE_CURRENT_DATA and not mid-seek: this frame is real, so it can be both
    // drawn and remembered.
    const live = entry?.ready && !element.seeking && element.readyState >= 2 && element.videoWidth > 0;
    if (live) {
      this.snapshot(key, element);
      return element;
    }
    return this.heldFrames.get(key)?.canvas ?? null;
  };

  /** Keeps a copy of the current frame, throttled — it only has to be recent. */
  private snapshot(key: string, element: HTMLVideoElement): void {
    const now = performance.now();
    const held = this.heldFrames.get(key);
    if (held && now - held.at < SNAPSHOT_EVERY_MS) return;

    const canvas = held?.canvas ?? document.createElement('canvas');
    if (canvas.width !== element.videoWidth || canvas.height !== element.videoHeight) {
      canvas.width = element.videoWidth;
      canvas.height = element.videoHeight;
    }
    try {
      canvas.getContext('2d')?.drawImage(element, 0, 0);
      this.heldFrames.set(key, { canvas, at: now });
    } catch {
      // Not decodable this tick; the previous held frame stays valid.
    }
  }

  /**
   * Points the elements of clips that are about to start at their first frame,
   * so the decode happens before the cut rather than on it.
   */
  private preroll(seq: Sequence, active: Set<string>): void {
    for (const track of seq.tracks) {
      if (track.kind !== 'video' && track.kind !== 'audio') continue;
      for (const clip of track.clips) {
        if (!clip.assetId) continue;
        const lead = clip.start - this.time;
        if (lead <= 0 || lead > PREROLL_SECONDS) continue;

        const slot = this.slotFor(clip);
        if (active.has(MediaPool.key(clip.assetId, slot))) continue;
        const asset = this.assets.get(clip.assetId);
        if (!asset) continue;

        const element = (this.pool.get(clip.assetId, slot) ?? this.pool.acquire(asset, slot)).element;
        if (!(element instanceof HTMLMediaElement)) continue;
        if (element.seeking) continue;
        if (Math.abs(element.currentTime - clip.sourceIn) < SEEK_TOLERANCE) continue;
        try {
          element.currentTime = Math.max(0, clip.sourceIn);
        } catch {
          // Metadata is not there yet; tried again on the next tick.
        }
      }
    }
  }

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
