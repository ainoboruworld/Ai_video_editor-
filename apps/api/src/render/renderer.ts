import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Clip, Sequence, Track } from '@ave/editor-core';
import { prisma } from '../db.js';
import { storage, RENDERS_DIR } from '../storage.js';
import { runOrThrow } from '../ffmpeg.js';
import type { JobContext } from '../queue.js';

const FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

export interface RenderParams {
  resolution: '720p' | '1080p' | '4k';
  fps: 24 | 25 | 30 | 60;
  quality: 'draft' | 'standard' | 'high' | 'maximum';
}

const QUALITY: Record<RenderParams['quality'], { crf: number; preset: string }> = {
  draft: { crf: 30, preset: 'veryfast' },
  standard: { crf: 23, preset: 'medium' },
  high: { crf: 20, preset: 'slow' },
  maximum: { crf: 18, preset: 'slow' },
};

const RES_HEIGHT: Record<RenderParams['resolution'], number> = { '720p': 720, '1080p': 1080, '4k': 2160 };

function even(n: number): number {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r + 1;
}

function colorToFfmpeg(c: string | null | undefined, fallback: string): string {
  if (!c) return fallback;
  const m = c.trim().match(/^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/);
  if (m) return `0x${m[1]}${m[2] ? `@${(parseInt(m[2], 10) / 255).toFixed(2)}` : ''}`;
  return /^[a-zA-Z]+$/.test(c) ? c : fallback;
}

/** Build an atempo chain for speeds 0.25–4x (atempo supports 0.5–2 per stage). */
function atempoChain(speed: number): string {
  let s = speed;
  const parts: string[] = [];
  while (s > 2) {
    parts.push('atempo=2');
    s /= 2;
  }
  while (s < 0.5) {
    parts.push('atempo=0.5');
    s /= 0.5;
  }
  parts.push(`atempo=${s.toFixed(4)}`);
  return parts.join(',');
}

interface AssetInfo {
  id: string;
  kind: string;
  abs: string;
  duration: number | null;
}

interface RenderContext {
  seq: Sequence;
  assets: Map<string, AssetInfo>;
  W: number;
  H: number;
  fps: number;
  crf: number;
  preset: string;
  tmpDir: string;
  ctx: JobContext;
}

function clampSpeed(s: number): number {
  return Math.max(0.25, Math.min(4, Number.isFinite(s) && s > 0 ? s : 1));
}

/** Video filter chain for a clip, sized/positioned into the output frame. Returns filter graph lines and out label. */
function clipVideoGraph(rc: RenderContext, clip: Clip, inLabel: string, D: number): { lines: string[]; out: string } {
  const { W, H, fps } = rc;
  const speed = clampSpeed(clip.speed);
  const lines: string[] = [];
  const f = clip.filters;
  const chain: string[] = [`setpts=(PTS-STARTPTS)/${speed}`, `fps=${fps}`];
  if (clip.crop && (clip.crop.left || clip.crop.right || clip.crop.top || clip.crop.bottom)) {
    const cw = Math.max(0.01, 1 - clip.crop.left - clip.crop.right);
    const ch = Math.max(0.01, 1 - clip.crop.top - clip.crop.bottom);
    chain.push(`crop=iw*${cw.toFixed(4)}:ih*${ch.toFixed(4)}:iw*${clip.crop.left.toFixed(4)}:ih*${clip.crop.top.toFixed(4)}`);
  }
  const tScale = clip.transform?.scale && clip.transform.scale > 0 ? clip.transform.scale : 1;
  const targetW = even(W * tScale);
  const targetH = even(H * tScale);
  chain.push(`scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease`);
  // Color filters
  const eq: string[] = [];
  if (f) {
    if (f.brightness) eq.push(`brightness=${Math.max(-1, Math.min(1, f.brightness)).toFixed(3)}`);
    if (f.contrast !== 1) eq.push(`contrast=${Math.max(0, Math.min(2, f.contrast)).toFixed(3)}`);
    if (f.saturation !== 1 && !f.grayscale) eq.push(`saturation=${Math.max(0, Math.min(2, f.saturation)).toFixed(3)}`);
    if (f.grayscale) eq.push('saturation=0');
    if (eq.length) chain.push(`eq=${eq.join(':')}`);
    if (f.temperature) chain.push(`hue=h=${(f.temperature * 15).toFixed(2)}`);
    if (f.blur > 0) chain.push(`gblur=sigma=${Math.min(50, f.blur).toFixed(2)}`);
  }
  chain.push(`trim=duration=${D.toFixed(4)}`, 'setpts=PTS-STARTPTS');
  // Transitions as fades
  const tin = clip.transitionIn;
  const tout = clip.transitionOut;
  if (tin && tin.duration > 0) {
    const white = tin.kind === 'dip-to-white' ? ':color=white' : '';
    chain.push(`fade=t=in:st=0:d=${Math.min(D, tin.duration).toFixed(3)}${white}`);
  }
  if (tout && tout.duration > 0) {
    const d = Math.min(D, tout.duration);
    const white = tout.kind === 'dip-to-white' ? ':color=white' : '';
    chain.push(`fade=t=out:st=${(D - d).toFixed(3)}:d=${d.toFixed(3)}${white}`);
  }
  const scaledLabel = `${inLabel}s`;
  lines.push(`[${inLabel}]${chain.join(',')}[${scaledLabel}]`);
  // Composite onto black background at transform position
  const bgLabel = `${inLabel}bg`;
  lines.push(`color=black:s=${W}x${H}:r=${fps}:d=${D.toFixed(4)}[${bgLabel}]`);
  const resScale = H / 1080; // transform offsets defined in sequence coordinate space
  const seqScale = H / rc.seq.height;
  const ox = Math.round((clip.transform?.x ?? 0) * seqScale);
  const oy = Math.round((clip.transform?.y ?? 0) * seqScale);
  void resScale;
  const outLabel = `${inLabel}o`;
  lines.push(
    `[${bgLabel}][${scaledLabel}]overlay=x=(W-w)/2+${ox}:y=(H-h)/2+${oy}:shortest=0,trim=duration=${D.toFixed(4)},setpts=PTS-STARTPTS,format=yuv420p[${outLabel}]`,
  );
  return { lines, out: outLabel };
}

function clipAudioGraph(clip: Clip, hasAudio: boolean, inLabel: string, D: number): { lines: string[]; out: string } {
  const speed = clampSpeed(clip.speed);
  const lines: string[] = [];
  const outLabel = `${inLabel}ao`;
  if (!hasAudio || clip.muted || clip.volume <= 0) {
    lines.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${D.toFixed(4)}[${outLabel}]`);
    return { lines, out: outLabel };
  }
  const chain: string[] = ['asetpts=PTS-STARTPTS', atempoChain(speed)];
  const vol = Math.max(0, Math.min(2, clip.volume));
  if (vol !== 1) chain.push(`volume=${vol.toFixed(3)}`);
  if (clip.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${Math.min(D, clip.fadeIn).toFixed(3)}`);
  if (clip.fadeOut > 0) {
    const d = Math.min(D, clip.fadeOut);
    chain.push(`afade=t=out:st=${(D - d).toFixed(3)}:d=${d.toFixed(3)}`);
  }
  chain.push('aresample=48000', 'apad', `atrim=duration=${D.toFixed(4)}`, 'asetpts=PTS-STARTPTS');
  lines.push(`[${inLabel}]${chain.join(',')}[${outLabel}]`);
  return { lines, out: outLabel };
}

type BaseSegment =
  | { kind: 'gap'; duration: number }
  | { kind: 'clip'; clip: Clip; duration: number };

function buildBaseSegments(track: Track | undefined): BaseSegment[] {
  const segments: BaseSegment[] = [];
  const clips = [...(track?.clips ?? [])].filter((c) => c.kind === 'video' || c.kind === 'image' || c.kind === 'audio').sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const clip of clips) {
    if (clip.start > cursor + 0.01) segments.push({ kind: 'gap', duration: clip.start - cursor });
    const dur = Math.max(0.05, clip.duration);
    segments.push({ kind: 'clip', clip, duration: dur });
    cursor = Math.max(cursor, clip.start + dur);
  }
  return segments;
}

async function renderSegment(rc: RenderContext, seg: BaseSegment, index: number): Promise<string> {
  const out = path.join(rc.tmpDir, `seg-${index}.mp4`);
  const { W, H, fps } = rc;
  const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-r', String(fps)];

  if (seg.kind === 'gap') {
    await runOrThrow('ffmpeg', [
      '-hide_banner', '-nostats', '-y',
      '-f', 'lavfi', '-i', `color=black:s=${W}x${H}:r=${fps}:d=${seg.duration.toFixed(4)}`,
      '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo`,
      '-t', seg.duration.toFixed(4),
      ...enc, out,
    ], { onChild: rc.ctx.registerChild });
    return out;
  }

  const clip = seg.clip;
  const D = seg.duration;
  const speed = clampSpeed(clip.speed);
  const asset = clip.assetId ? rc.assets.get(clip.assetId) : undefined;
  if (!asset) {
    // Missing asset → render black
    return renderSegment(rc, { kind: 'gap', duration: D }, index);
  }

  const args: string[] = ['-hide_banner', '-nostats', '-y'];
  const isImage = asset.kind === 'image' || clip.kind === 'image';
  if (isImage) {
    args.push('-loop', '1', '-t', D.toFixed(4), '-i', asset.abs);
  } else {
    const srcDur = D * speed;
    args.push('-ss', Math.max(0, clip.sourceIn).toFixed(4), '-t', (srcDur + 0.5).toFixed(4), '-i', asset.abs);
  }

  const lines: string[] = [];
  let vOut: string;
  let aOut: string;
  const isAudioOnly = asset.kind === 'audio';
  if (isAudioOnly) {
    lines.push(`color=black:s=${W}x${H}:r=${fps}:d=${D.toFixed(4)},format=yuv420p[v0o]`);
    vOut = 'v0o';
  } else {
    const g = clipVideoGraph(rc, clip, '0:v', D);
    lines.push(...g.lines);
    vOut = g.out;
  }
  const hasAudio = !isImage; // probe-lite: images have none; missing audio handled by ffmpeg? guard below
  const audioAvailable = hasAudio && (isAudioOnly || asset.kind === 'video');
  // We cannot cheaply know if a video has an audio stream here; use anullsrc merge trick:
  if (audioAvailable) {
    const ag = clipAudioGraph(clip, true, '0:a', D);
    lines.push(...ag.lines);
    aOut = ag.out;
  } else {
    lines.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${D.toFixed(4)}[an]`);
    aOut = 'an';
  }

  try {
    await runOrThrow('ffmpeg', [
      ...args,
      '-filter_complex', lines.join(';'),
      '-map', `[${vOut}]`, '-map', `[${aOut}]`,
      '-t', D.toFixed(4),
      ...enc, out,
    ], { onChild: rc.ctx.registerChild });
  } catch (err) {
    // Retry with silent audio if mapping 0:a failed (video without audio stream)
    if (audioAvailable && /matches no streams|Stream map|Invalid|0:a/.test(String(err))) {
      const lines2 = lines.filter((l) => !l.startsWith('[0:a]'));
      lines2.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${D.toFixed(4)}[an]`);
      await runOrThrow('ffmpeg', [
        ...args,
        '-filter_complex', lines2.join(';'),
        '-map', `[${vOut}]`, '-map', '[an]',
        '-t', D.toFixed(4),
        ...enc, out,
      ], { onChild: rc.ctx.registerChild });
    } else {
      throw err;
    }
  }
  return out;
}

interface TextItem {
  clip: Clip;
  start: number;
  end: number;
}

function escapeDrawtextValue(v: string): string {
  return v; // values we build are numeric/known-safe; text goes through textfile=
}

function drawtextFilter(rc: RenderContext, item: TextItem, textFile: string): string {
  const { H } = rc;
  const clip = item.clip;
  const style = clip.textStyle;
  const seqScale = rc.H / rc.seq.height;
  const isCaption = clip.kind === 'caption';
  const baseSize = style?.fontSize ?? (isCaption ? 56 : 64);
  const fontsize = Math.max(12, Math.round(baseSize * seqScale));
  const fontcolor = colorToFfmpeg(style?.color, 'white');
  const parts = [
    `textfile='${textFile.replace(/'/g, "\\'")}'`,
    `fontfile='${FONT_BOLD}'`,
    `fontsize=${fontsize}`,
    `fontcolor=${fontcolor}`,
    `x=(w-text_w)/2`,
  ];
  if (isCaption) {
    parts.push(`y=h-text_h-${Math.round(H * 0.08)}`);
  } else {
    const oy = Math.round((clip.transform?.y ?? 0) * seqScale);
    parts.push(`y=(h-text_h)/2+${oy}`);
  }
  const bg = style?.backgroundColor;
  if (bg || isCaption) {
    parts.push('box=1', `boxcolor=${bg ? colorToFfmpeg(bg, 'black@0.5') : 'black@0.5'}`, `boxborderw=${Math.max(4, Math.round(fontsize * 0.25))}`);
  } else if (style?.shadow !== false) {
    parts.push('shadowcolor=black@0.6', 'shadowx=2', 'shadowy=2');
  }
  if (style?.strokeWidth && style.strokeColor) {
    parts.push(`borderw=${Math.round(style.strokeWidth * seqScale)}`, `bordercolor=${colorToFfmpeg(style.strokeColor, 'black')}`);
  }
  parts.push(`enable='between(t,${item.start.toFixed(3)},${item.end.toFixed(3)})'`);
  return `drawtext=${escapeDrawtextValue(parts.join(':'))}`;
}

export async function renderSequence(sequenceId: string, params: RenderParams, ctx: JobContext): Promise<{ outputUrl: string }> {
  const row = await prisma.sequence.findUnique({ where: { id: sequenceId } });
  if (!row) throw new Error('Sequence not found');
  const seq = JSON.parse(row.doc) as Sequence;

  await ctx.setProgress(0.02, 'Preparing');

  // Collect assets
  const assetIds = new Set<string>();
  for (const t of seq.tracks) for (const c of t.clips) if (c.assetId) assetIds.add(c.assetId);
  const assetRows = await prisma.asset.findMany({ where: { id: { in: [...assetIds] } } });
  const assets = new Map<string, AssetInfo>();
  for (const a of assetRows) {
    assets.set(a.id, { id: a.id, kind: a.kind, abs: storage.absPath(a.originalUrl.replace(/^\/media\//, '')), duration: a.duration });
  }

  const q = QUALITY[params.quality] ?? QUALITY.standard;
  const targetH = RES_HEIGHT[params.resolution] ?? 1080;
  const scale = targetH / Math.max(seq.width, seq.height) * (seq.width >= seq.height ? Math.max(seq.width, seq.height) / seq.height : 1);
  // Simpler: scale sequence dims so height maps to resolution for landscape, width for portrait keeping aspect
  const factor = seq.width >= seq.height ? targetH / seq.height : targetH / seq.width;
  void scale;
  const W = even(seq.width * factor);
  const H = even(seq.height * factor);
  const fps = params.fps || seq.fps || 30;

  const videoTracks = seq.tracks.filter((t) => t.kind === 'video' && t.visible !== false);
  const baseTrack = videoTracks[0];
  const overlayTracks = videoTracks.slice(1);
  const textClips: Clip[] = seq.tracks
    .filter((t) => (t.kind === 'text' || t.kind === 'caption') && t.visible !== false)
    .flatMap((t) => t.clips)
    .filter((c) => (c.kind === 'text' || c.kind === 'caption') && !!c.text);
  const audioTracks = seq.tracks.filter((t) => t.kind === 'audio' && !t.muted);

  const segments = buildBaseSegments(baseTrack);
  if (segments.length === 0) {
    throw new Error('Timeline is empty: add at least one clip to the primary video track before rendering.');
  }
  const totalDuration = segments.reduce((s, x) => s + x.duration, 0);

  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ave-render-'));
  const rc: RenderContext = { seq, assets, W, H, fps, crf: q.crf, preset: q.preset, tmpDir, ctx };

  try {
    // 1. Intermediates
    const files: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      if (ctx.isCancelled()) throw new Error('Cancelled');
      await ctx.setProgress(0.05 + 0.4 * (i / segments.length), 'Rendering');
      files.push(await renderSegment(rc, segments[i]!, i));
    }

    // 2. Concat
    await ctx.setProgress(0.5, 'Rendering');
    const listFile = path.join(tmpDir, 'concat.txt');
    await fs.promises.writeFile(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    const baseFile = path.join(tmpDir, 'base.mp4');
    await runOrThrow('ffmpeg', [
      '-hide_banner', '-nostats', '-y',
      '-f', 'concat', '-safe', '0', '-i', listFile,
      '-c', 'copy', baseFile,
    ], { onChild: ctx.registerChild });

    // 3. Overlay + audio mix pass
    await ctx.setProgress(0.55, 'Encoding');
    const outName = `render-${sequenceId}-${Date.now()}.mp4`;
    const outFile = path.join(RENDERS_DIR, outName);

    const args: string[] = ['-hide_banner', '-nostats', '-y', '-i', baseFile];
    const graph: string[] = [];
    let inputIdx = 1;
    let vLabel = '0:v';
    let step = 0;

    const nextV = () => `ov${step++}`;

    // Overlay clips from extra video tracks
    for (const track of overlayTracks) {
      for (const clip of track.clips) {
        if (clip.kind !== 'video' && clip.kind !== 'image') continue;
        const asset = clip.assetId ? assets.get(clip.assetId) : undefined;
        if (!asset) continue;
        if (clip.start >= totalDuration) continue;
        const D = Math.max(0.05, Math.min(clip.duration, totalDuration - clip.start));
        const speed = clampSpeed(clip.speed);
        const isImage = asset.kind === 'image';
        if (isImage) {
          args.push('-loop', '1', '-t', D.toFixed(4), '-i', asset.abs);
        } else {
          args.push('-ss', Math.max(0, clip.sourceIn).toFixed(4), '-t', (D * speed + 0.5).toFixed(4), '-i', asset.abs);
        }
        const idx = inputIdx++;
        const tScale = clip.transform?.scale && clip.transform.scale > 0 ? clip.transform.scale : 1;
        const mode = clip.brollMode ?? 'fullscreen';
        const frac = mode === 'pip' ? 0.35 : mode === 'overlay' ? 0.5 : 1;
        const ow = even(W * frac * tScale);
        const oh = even(H * frac * tScale);
        const opacity = Math.max(0, Math.min(1, clip.transform?.opacity ?? 1));
        const chain = [
          `setpts=(PTS-STARTPTS)/${speed}`,
          `scale=${ow}:${oh}:force_original_aspect_ratio=decrease`,
          `trim=duration=${D.toFixed(4)}`,
          `setpts=PTS-STARTPTS+${clip.start.toFixed(4)}/TB`,
        ];
        if (opacity < 1) chain.splice(2, 0, `format=yuva420p,colorchannelmixer=aa=${opacity.toFixed(3)}`);
        const ovIn = `oin${idx}`;
        graph.push(`[${idx}:v]${chain.join(',')}[${ovIn}]`);
        const seqScale = H / seq.height;
        const ox = Math.round((clip.transform?.x ?? 0) * seqScale);
        const oy = Math.round((clip.transform?.y ?? 0) * seqScale);
        const pos = mode === 'pip'
          ? `x=W-w-${Math.round(W * 0.04)}+${ox}:y=H-h-${Math.round(H * 0.06)}+${oy}`
          : `x=(W-w)/2+${ox}:y=(H-h)/2+${oy}`;
        const outL = nextV();
        graph.push(`[${vLabel}][${ovIn}]overlay=${pos}:eof_action=pass:enable='between(t,${clip.start.toFixed(3)},${(clip.start + D).toFixed(3)})'[${outL}]`);
        vLabel = outL;
      }
    }

    // Text + caption drawtext
    const drawFilters: string[] = [];
    let tf = 0;
    for (const clip of textClips) {
      const start = clip.start;
      const end = clip.start + clip.duration;
      if (start >= totalDuration) continue;
      const textFile = path.join(tmpDir, `text-${tf++}.txt`);
      await fs.promises.writeFile(textFile, String(clip.text ?? ''));
      drawFilters.push(drawtextFilter(rc, { clip, start, end: Math.min(end, totalDuration) }, textFile));
    }
    if (drawFilters.length) {
      const outL = nextV();
      graph.push(`[${vLabel}]${drawFilters.join(',')}[${outL}]`);
      vLabel = outL;
    }

    // Audio: base audio + audio-track clips (music etc.)
    const audioLabels: string[] = ['0:a'];
    for (const track of audioTracks) {
      for (const clip of track.clips) {
        if (clip.kind !== 'audio' && clip.kind !== 'video') continue;
        const asset = clip.assetId ? assets.get(clip.assetId) : undefined;
        if (!asset || clip.muted) continue;
        if (clip.start >= totalDuration) continue;
        const D = Math.max(0.05, Math.min(clip.duration, totalDuration - clip.start));
        const speed = clampSpeed(clip.speed);
        args.push('-ss', Math.max(0, clip.sourceIn).toFixed(4), '-t', (D * speed + 0.5).toFixed(4), '-i', asset.abs);
        const idx = inputIdx++;
        const vol = Math.max(0, Math.min(2, clip.volume));
        const chain: string[] = ['asetpts=PTS-STARTPTS', atempoChain(speed)];
        if (vol !== 1) chain.push(`volume=${vol.toFixed(3)}`);
        if (clip.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${Math.min(D, clip.fadeIn).toFixed(3)}`);
        if (clip.fadeOut > 0) chain.push(`afade=t=out:st=${(D - Math.min(D, clip.fadeOut)).toFixed(3)}:d=${Math.min(D, clip.fadeOut).toFixed(3)}`);
        chain.push('aresample=48000', `atrim=duration=${D.toFixed(4)}`, `adelay=${Math.round(clip.start * 1000)}|${Math.round(clip.start * 1000)}`);
        const label = `am${idx}`;
        graph.push(`[${idx}:a]${chain.join(',')}[${label}]`);
        audioLabels.push(label);
      }
    }
    let aLabel = '0:a';
    if (audioLabels.length > 1) {
      graph.push(`[${audioLabels.join('][')}]amix=inputs=${audioLabels.length}:duration=first:normalize=0[amixed]`);
      aLabel = 'amixed';
    }

    await ctx.setProgress(0.6, 'Encoding');
    const finalArgs = [...args];
    if (graph.length) finalArgs.push('-filter_complex', graph.join(';'));
    finalArgs.push(
      '-map', vLabel.includes(':') ? vLabel : `[${vLabel}]`,
      '-map', aLabel.includes(':') ? aLabel : `[${aLabel}]`,
      '-c:v', 'libx264', '-preset', q.preset, '-crf', String(q.crf), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
      '-r', String(fps),
      '-t', totalDuration.toFixed(4),
      '-movflags', '+faststart',
      '-progress', 'pipe:1',
      outFile,
    );
    await runOrThrow('ffmpeg', finalArgs, {
      onChild: ctx.registerChild,
      onStdoutLine: (line) => {
        const m = line.match(/^out_time_us=(\d+)/) ?? line.match(/^out_time_ms=(\d+)/);
        if (m) {
          const t = parseInt(m[1]!, 10) / 1e6;
          void ctx.setProgress(0.6 + 0.38 * Math.min(1, t / totalDuration), 'Encoding');
        }
      },
    });

    await ctx.setProgress(0.99, 'Finalizing');
    const st = await fs.promises.stat(outFile);
    if (st.size === 0) throw new Error('Render produced an empty file');
    return { outputUrl: `/media/renders/${outName}` };
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}
