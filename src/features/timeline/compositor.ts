/**
 * The compositor. One pure-ish drawing routine that paints a single frame of a
 * sequence onto a 2D canvas.
 *
 * Preview and export share this code path, so what you see while editing is
 * what the exported file contains — there is no second, divergent renderer.
 */
import { interpolate, type Clip, type Sequence, type TextStyle, type Track } from '@/lib/engine';
import type { Asset } from '@/types';

export type DrawableSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

export interface CompositorContext {
  /** Returns the media element for a clip, or null when it is not ready yet. */
  resolve: (clip: Clip) => DrawableSource | null;
  assets: Map<string, Asset>;
  /** Draw selection affordances (preview only). */
  selection?: Set<string>;
}

export interface Layer {
  clip: Clip;
  track: Track;
  z: number;
}

/** All clips visible at `time`, in painting order (bottom first). */
export function visibleLayers(seq: Sequence, time: number): Layer[] {
  const layers: Layer[] = [];
  const push = (track: Track, base: number, index: number) => {
    if (!track.visible) return;
    for (const clip of track.clips) {
      if (time >= clip.start && time < clip.start + clip.duration) {
        layers.push({ clip, track, z: base + index });
      }
    }
  };
  seq.tracks.filter((t) => t.kind === 'video').forEach((t, i) => push(t, 10, i));
  seq.tracks.filter((t) => t.kind === 'text').forEach((t, i) => push(t, 40, i));
  seq.tracks.filter((t) => t.kind === 'caption').forEach((t, i) => push(t, 60, i));
  return layers.sort((a, b) => a.z - b.z);
}

/** Audible clips at `time` (audio tracks plus the audio of video clips). */
export function audibleClips(seq: Sequence, time: number): { clip: Clip; track: Track }[] {
  const anySolo = seq.tracks.some((t) => t.solo);
  const out: { clip: Clip; track: Track }[] = [];
  for (const track of seq.tracks) {
    if (track.kind === 'text' || track.kind === 'caption') continue;
    if (anySolo ? !track.solo : track.muted) continue;
    for (const clip of track.clips) {
      if (time >= clip.start && time < clip.start + clip.duration) out.push({ clip, track });
    }
  }
  return out;
}

/**
 * Transitions that work by taking the picture away. Slide, zoom and blur carry
 * their own mechanism and stay fully opaque — fading them as well would make
 * every transition a variation on the same dip.
 */
const OPACITY_TRANSITIONS = new Set(['fade', 'cross-dissolve', 'dip-to-black', 'dip-to-white']);

/** Opacity contribution of clip transitions and keyframes at a local time. */
export function clipOpacity(clip: Clip, localTime: number): number {
  let opacity = interpolate(clip.keyframes.opacity, localTime, clip.transform.opacity);
  const tin = clip.transitionIn;
  if (tin && tin.duration > 0 && localTime < tin.duration && OPACITY_TRANSITIONS.has(tin.kind)) {
    opacity *= easeInOut(localTime / tin.duration);
  }
  const tout = clip.transitionOut;
  const remaining = clip.duration - localTime;
  if (tout && tout.duration > 0 && remaining < tout.duration && OPACITY_TRANSITIONS.has(tout.kind)) {
    opacity *= easeInOut(Math.max(0, remaining) / tout.duration);
  }
  return Math.max(0, Math.min(1, opacity));
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Extra transform and softening contributed by slide/zoom/blur transitions. */
function transitionOffset(clip: Clip, localTime: number, width: number): { dx: number; scale: number; blur: number } {
  let dx = 0;
  let scale = 1;
  let blur = 0;
  const apply = (kind: string, progress: number, incoming: boolean) => {
    const eased = easeInOut(Math.max(0, Math.min(1, progress)));
    if (kind === 'slide') dx += (incoming ? -1 : 1) * (1 - eased) * width * 0.35;
    if (kind === 'zoom') scale *= incoming ? 1 + (1 - eased) * 0.18 : 1 - (1 - eased) * 0.12;
    if (kind === 'blur') blur = Math.max(blur, (1 - eased) * width * 0.012);
  };
  if (clip.transitionIn && clip.transitionIn.duration > 0 && localTime < clip.transitionIn.duration) {
    apply(clip.transitionIn.kind, localTime / clip.transitionIn.duration, true);
  }
  const remaining = clip.duration - localTime;
  if (clip.transitionOut && clip.transitionOut.duration > 0 && remaining < clip.transitionOut.duration) {
    apply(clip.transitionOut.kind, remaining / clip.transitionOut.duration, false);
  }
  return { dx, scale, blur };
}

export function filterString(clip: Clip): string {
  const f = clip.filters;
  const parts: string[] = [];
  if (f.brightness !== 0) parts.push(`brightness(${(1 + f.brightness).toFixed(3)})`);
  if (f.contrast !== 1) parts.push(`contrast(${f.contrast.toFixed(3)})`);
  if (f.saturation !== 1) parts.push(`saturate(${f.saturation.toFixed(3)})`);
  if (f.blur > 0) parts.push(`blur(${f.blur.toFixed(1)}px)`);
  if (f.grayscale) parts.push('grayscale(1)');
  if (f.temperature > 0) parts.push(`sepia(${(f.temperature * 0.45).toFixed(3)})`);
  if (f.temperature < 0) parts.push(`hue-rotate(${(f.temperature * 24).toFixed(1)}deg)`);
  return parts.join(' ');
}

/**
 * Cover-fit: fills the frame while preserving the source aspect ratio, then
 * applies the clip crop. Media is never stretched — it is cropped instead.
 */
export function coverRect(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const sourceRatio = sourceWidth / sourceHeight;
  const frameRatio = frameWidth / frameHeight;
  if (sourceRatio > frameRatio) {
    const sw = sourceHeight * frameRatio;
    return { sx: (sourceWidth - sw) / 2, sy: 0, sw, sh: sourceHeight };
  }
  const sh = sourceWidth / frameRatio;
  return { sx: 0, sy: (sourceHeight - sh) / 2, sw: sourceWidth, sh };
}

function sourceSize(source: DrawableSource): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth || 16, height: source.videoHeight || 9 };
  }
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth || 16, height: source.naturalHeight || 9 };
  }
  return { width: source.width, height: source.height };
}

/** Paints one frame of the sequence at `time` onto `ctx`. */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  seq: Sequence,
  time: number,
  context: CompositorContext,
): void {
  const { width, height } = seq;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  for (const { clip, track } of visibleLayers(seq, time)) {
    const localTime = time - clip.start;
    const opacity = clipOpacity(clip, localTime);
    if (opacity <= 0.001) continue;

    ctx.save();
    ctx.globalAlpha = opacity;

    if (clip.kind === 'caption') {
      drawCaption(ctx, clip, localTime, seq);
      ctx.restore();
      continue;
    }
    if (clip.kind === 'text') {
      drawText(ctx, clip, localTime, seq);
      ctx.restore();
      continue;
    }

    const source = context.resolve(clip);
    if (!source) {
      ctx.restore();
      continue;
    }

    const media = sourceSize(source);
    if (media.width === 0 || media.height === 0) {
      ctx.restore();
      continue;
    }

    const t = clip.transform;
    const x = interpolate(clip.keyframes.x, localTime, t.x);
    const y = interpolate(clip.keyframes.y, localTime, t.y);
    const scale = interpolate(clip.keyframes.scale, localTime, t.scale);
    const rotation = interpolate(clip.keyframes.rotation, localTime, t.rotation);
    const motion = transitionOffset(clip, localTime, width);

    // Picture-in-picture B-roll occupies a corner instead of the full frame.
    const pip = clip.brollMode === 'pip';
    const frameW = pip ? width * 0.36 : width;
    const frameH = pip ? height * 0.36 : height;

    let rect = coverRect(media.width, media.height, frameW, frameH);
    if (clip.crop) {
      const c = clip.crop;
      rect = {
        sx: rect.sx + rect.sw * c.left,
        sy: rect.sy + rect.sh * c.top,
        sw: rect.sw * Math.max(0.02, 1 - c.left - c.right),
        sh: rect.sh * Math.max(0.02, 1 - c.top - c.bottom),
      };
    }

    // A blur transition stacks on top of whatever the clip's own filters say.
    const filter = [filterString(clip), motion.blur > 0.05 ? `blur(${motion.blur.toFixed(1)}px)` : '']
      .filter(Boolean)
      .join(' ');
    if (filter) ctx.filter = filter;

    const centerX = pip ? width - frameW / 2 - width * 0.04 : width / 2;
    const centerY = pip ? height - frameH / 2 - height * 0.06 : height / 2;

    ctx.translate(centerX + x + motion.dx, centerY + y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(scale * motion.scale, scale * motion.scale);

    if (pip) {
      roundRectPath(ctx, -frameW / 2, -frameH / 2, frameW, frameH, Math.min(frameW, frameH) * 0.06);
      ctx.clip();
    }

    try {
      ctx.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, -frameW / 2, -frameH / 2, frameW, frameH);
    } catch {
      // A frame that is not decodable yet simply does not paint this tick.
    }

    if (clip.filters.vignette) {
      const gradient = ctx.createRadialGradient(0, 0, Math.min(frameW, frameH) * 0.28, 0, 0, Math.max(frameW, frameH) * 0.75);
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.filter = 'none';
      ctx.fillStyle = gradient;
      ctx.fillRect(-frameW / 2, -frameH / 2, frameW, frameH);
    }

    // Dip transitions paint a colour wash over the frame.
    paintDip(ctx, clip, localTime, frameW, frameH);

    ctx.restore();
  }

  ctx.restore();
}

function paintDip(ctx: CanvasRenderingContext2D, clip: Clip, localTime: number, w: number, h: number): void {
  const dip = (kind: string | undefined, progress: number) => {
    if (kind !== 'dip-to-black' && kind !== 'dip-to-white') return;
    ctx.filter = 'none';
    ctx.globalAlpha = 1 - Math.max(0, Math.min(1, progress));
    ctx.fillStyle = kind === 'dip-to-black' ? '#000' : '#fff';
    ctx.fillRect(-w / 2, -h / 2, w, h);
  };
  if (clip.transitionIn && localTime < clip.transitionIn.duration) {
    dip(clip.transitionIn.kind, localTime / clip.transitionIn.duration);
  }
  const remaining = clip.duration - localTime;
  if (clip.transitionOut && remaining < clip.transitionOut.duration) {
    dip(clip.transitionOut.kind, remaining / clip.transitionOut.duration);
  }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ------------------------------------------------------------------ text ---

const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 64,
  fontWeight: 700,
  color: '#ffffff',
  backgroundColor: null,
  align: 'center',
  strokeColor: null,
  strokeWidth: 0,
  shadow: true,
};

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = words[0]!;
    for (let i = 1; i < words.length; i++) {
      const candidate = `${line} ${words[i]}`;
      if (ctx.measureText(candidate).width > maxWidth && line.length > 0) {
        lines.push(line);
        line = words[i]!;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

function textAnimationState(clip: Clip, localTime: number): { alpha: number; dy: number; scale: number; reveal: number } {
  const inDur = Math.min(0.45, clip.duration / 3);
  const progress = Math.max(0, Math.min(1, localTime / Math.max(0.01, inDur)));
  const eased = easeInOut(progress);
  switch (clip.textAnimation) {
    case 'fade':
      return { alpha: eased, dy: 0, scale: 1, reveal: 1 };
    case 'slide':
      return { alpha: eased, dy: (1 - eased) * 60, scale: 1, reveal: 1 };
    case 'pop':
      return { alpha: eased, dy: 0, scale: 0.8 + eased * 0.2 + Math.sin(eased * Math.PI) * 0.06, reveal: 1 };
    case 'scale':
      return { alpha: eased, dy: 0, scale: 0.85 + eased * 0.15, reveal: 1 };
    case 'typewriter':
      return { alpha: 1, dy: 0, scale: 1, reveal: Math.min(1, localTime / Math.max(0.3, clip.duration * 0.6)) };
    case 'word-reveal':
      return { alpha: 1, dy: 0, scale: 1, reveal: Math.min(1, localTime / Math.max(0.3, clip.duration * 0.7)) };
    default:
      return { alpha: 1, dy: 0, scale: 1, reveal: 1 };
  }
}

function drawText(ctx: CanvasRenderingContext2D, clip: Clip, localTime: number, seq: Sequence): void {
  const style = clip.textStyle ?? DEFAULT_TEXT_STYLE;
  const anim = textAnimationState(clip, localTime);
  let text = clip.text ?? '';
  if (clip.textAnimation === 'typewriter') {
    text = text.slice(0, Math.ceil(text.length * anim.reveal));
  } else if (clip.textAnimation === 'word-reveal') {
    const words = text.split(/\s+/);
    text = words.slice(0, Math.max(1, Math.ceil(words.length * anim.reveal))).join(' ');
  }
  if (!text) return;

  const t = clip.transform;
  const x = interpolate(clip.keyframes.x, localTime, t.x);
  const y = interpolate(clip.keyframes.y, localTime, t.y);

  ctx.globalAlpha *= anim.alpha;
  ctx.translate(seq.width / 2 + x, seq.height / 2 + y + anim.dy);
  ctx.scale(anim.scale * t.scale, anim.scale * t.scale);
  ctx.rotate((t.rotation * Math.PI) / 180);

  ctx.font = `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}, Inter, system-ui, sans-serif`;
  ctx.textAlign = style.align;
  ctx.textBaseline = 'middle';

  const maxWidth = seq.width * 0.84;
  const lines = wrapLines(ctx, text, maxWidth);
  const lineHeight = style.fontSize * 1.18;
  const totalHeight = lines.length * lineHeight;
  const anchorX = style.align === 'left' ? -maxWidth / 2 : style.align === 'right' ? maxWidth / 2 : 0;

  if (style.backgroundColor) {
    const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
    const padX = style.fontSize * 0.4;
    const padY = style.fontSize * 0.28;
    ctx.fillStyle = style.backgroundColor;
    roundRectPath(
      ctx,
      anchorX - (style.align === 'center' ? widest / 2 : style.align === 'right' ? widest : 0) - padX,
      -totalHeight / 2 - padY,
      widest + padX * 2,
      totalHeight + padY * 2,
      style.fontSize * 0.18,
    );
    ctx.fill();
  }

  lines.forEach((line, index) => {
    const lineY = -totalHeight / 2 + lineHeight * (index + 0.5);
    if (style.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = style.fontSize * 0.22;
      ctx.shadowOffsetY = style.fontSize * 0.05;
    }
    if (style.strokeColor && style.strokeWidth > 0) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = style.strokeWidth;
      ctx.strokeStyle = style.strokeColor;
      ctx.strokeText(line, anchorX, lineY);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, anchorX, lineY);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  });
}

// -------------------------------------------------------------- captions ---

export interface CaptionPreset {
  fontSize: number;
  fontWeight: number;
  color: string;
  highlight: string | null;
  background: string | null;
  stroke: string | null;
  uppercase: boolean;
  /** Vertical position as a fraction of frame height. */
  y: number;
}

export const CAPTION_PRESETS: Record<string, CaptionPreset> = {
  minimal: { fontSize: 46, fontWeight: 600, color: '#ffffff', highlight: null, background: 'rgba(0,0,0,0.55)', stroke: null, uppercase: false, y: 0.86 },
  bold: { fontSize: 62, fontWeight: 800, color: '#ffffff', highlight: null, background: null, stroke: '#000000', uppercase: true, y: 0.8 },
  creator: { fontSize: 58, fontWeight: 800, color: '#ffffff', highlight: '#f5b544', background: null, stroke: '#000000', uppercase: true, y: 0.74 },
  karaoke: { fontSize: 58, fontWeight: 800, color: '#ffffff', highlight: '#7c5cff', background: null, stroke: '#000000', uppercase: true, y: 0.78 },
  dynamic: { fontSize: 66, fontWeight: 900, color: '#ffffff', highlight: '#34d399', background: null, stroke: '#000000', uppercase: true, y: 0.7 },
};

function drawCaption(ctx: CanvasRenderingContext2D, clip: Clip, localTime: number, seq: Sequence): void {
  const preset = CAPTION_PRESETS[clip.captionStyle ?? 'bold'] ?? CAPTION_PRESETS.bold!;
  const raw = clip.text ?? '';
  if (!raw) return;
  const scaleFactor = seq.height / 1920;
  const fontSize = Math.round(preset.fontSize * Math.max(0.55, scaleFactor * 1.35));

  ctx.font = `${preset.fontWeight} ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const words = clip.captionWords ?? [];
  const text = preset.uppercase ? raw.toUpperCase() : raw;
  const maxWidth = seq.width * 0.86;
  const lines = wrapLines(ctx, text, maxWidth);
  const lineHeight = fontSize * 1.16;
  const baseY = seq.height * preset.y + (clip.transform.y || 0);
  const totalHeight = lines.length * lineHeight;

  if (preset.background) {
    const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
    ctx.fillStyle = preset.background;
    roundRectPath(
      ctx,
      seq.width / 2 - widest / 2 - fontSize * 0.35,
      baseY - totalHeight / 2 - fontSize * 0.24,
      widest + fontSize * 0.7,
      totalHeight + fontSize * 0.48,
      fontSize * 0.22,
    );
    ctx.fill();
  }

  // Karaoke-style highlighting when word timings are present.
  const activeWord = words.find((w) => localTime >= w.start && localTime < w.end)?.text.toLowerCase();

  lines.forEach((line, index) => {
    const y = baseY - totalHeight / 2 + lineHeight * (index + 0.5);
    if (preset.highlight && activeWord) {
      drawHighlightedLine(ctx, line, seq.width / 2, y, preset, activeWord, fontSize);
      return;
    }
    if (preset.stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(4, fontSize * 0.16);
      ctx.strokeStyle = preset.stroke;
      ctx.strokeText(line, seq.width / 2, y);
    }
    ctx.fillStyle = preset.color;
    ctx.fillText(line, seq.width / 2, y);
  });
}

function drawHighlightedLine(
  ctx: CanvasRenderingContext2D,
  line: string,
  centerX: number,
  y: number,
  preset: CaptionPreset,
  activeWord: string,
  fontSize: number,
): void {
  const words = line.split(' ');
  const spaceWidth = ctx.measureText(' ').width;
  const widths = words.map((w) => ctx.measureText(w).width);
  const total = widths.reduce((a, b) => a + b, 0) + spaceWidth * (words.length - 1);
  let x = centerX - total / 2;
  ctx.textAlign = 'left';
  words.forEach((word, index) => {
    const isActive = word.toLowerCase().replace(/[^\w']/g, '') === activeWord.replace(/[^\w']/g, '');
    if (preset.stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(4, fontSize * 0.16);
      ctx.strokeStyle = preset.stroke;
      ctx.strokeText(word, x, y);
    }
    ctx.fillStyle = isActive && preset.highlight ? preset.highlight : preset.color;
    ctx.fillText(word, x, y);
    x += widths[index]! + spaceWidth;
  });
  ctx.textAlign = 'center';
}
