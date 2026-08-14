import fs from 'node:fs';
import path from 'node:path';
import { prisma } from './db.js';
import { storage } from './storage.js';
import { ffprobe, runOrThrow, run } from './ffmpeg.js';
import type { JobContext } from './queue.js';

/** Compute waveform peaks by decoding to raw s16le pcm and downsampling max-abs. */
export async function computeWaveform(
  file: string,
  outJsonPath: string,
  samplesPerSecond = 8,
  onChild?: JobContext['registerChild'],
): Promise<void> {
  const sampleRate = 8000;
  const tmpPcm = outJsonPath + '.pcm';
  try {
    await runOrThrow('ffmpeg', [
      '-hide_banner', '-nostats', '-y',
      '-i', file,
      '-vn', '-ac', '1', '-ar', String(sampleRate),
      '-f', 's16le', tmpPcm,
    ], { onChild: onChild ?? undefined });
    const buf = await fs.promises.readFile(tmpPcm);
    const totalSamples = Math.floor(buf.length / 2);
    const window = Math.max(1, Math.floor(sampleRate / samplesPerSecond));
    const peaks: number[] = [];
    for (let i = 0; i < totalSamples; i += window) {
      let max = 0;
      const end = Math.min(i + window, totalSamples);
      for (let j = i; j < end; j++) {
        const v = Math.abs(buf.readInt16LE(j * 2));
        if (v > max) max = v;
      }
      peaks.push(Math.round((max / 32768) * 1000) / 1000);
    }
    await fs.promises.writeFile(outJsonPath, JSON.stringify({ peaks, samplesPerSecond }));
  } finally {
    await fs.promises.rm(tmpPcm, { force: true });
  }
}

/** Full ingest pipeline for a freshly uploaded asset. Runs as a background job. */
export async function processAsset(assetId: string, ctx: JobContext): Promise<{ assetId: string }> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new Error('Asset not found');
  const rel = asset.originalUrl.replace(/^\/media\//, '');
  const abs = storage.absPath(rel);
  const dirRel = path.dirname(rel);
  const dirAbs = path.dirname(abs);
  const base = path.basename(rel).replace(/\.[^.]+$/, '');

  try {
    await ctx.setProgress(0.05, 'Probing');
    const info = await ffprobe(abs);
    const update: Record<string, unknown> = {
      duration: info.duration,
      width: info.width,
      height: info.height,
      fps: info.fps,
    };

    // Thumbnail
    let thumbnailUrl: string | null = null;
    if (asset.kind === 'video' || asset.kind === 'image') {
      await ctx.setProgress(0.25, 'Thumbnail');
      const thumbAbs = path.join(dirAbs, `${base}.thumb.jpg`);
      if (asset.kind === 'image') {
        await runOrThrow('ffmpeg', ['-hide_banner', '-y', '-i', abs, '-vf', 'scale=480:-2', '-frames:v', '1', thumbAbs], { onChild: ctx.registerChild });
      } else {
        const at = info.duration ? Math.min(1, info.duration * 0.1) : 0;
        await runOrThrow('ffmpeg', ['-hide_banner', '-y', '-ss', String(at), '-i', abs, '-vf', 'scale=480:-2', '-frames:v', '1', thumbAbs], { onChild: ctx.registerChild });
      }
      thumbnailUrl = storage.url(path.join(dirRel, `${base}.thumb.jpg`));
      update.thumbnailUrl = thumbnailUrl;
    }

    // Waveform for audio/video with audio stream
    if ((asset.kind === 'audio' || asset.kind === 'video') && info.hasAudio) {
      await ctx.setProgress(0.5, 'Waveform');
      const wfAbs = path.join(dirAbs, `${base}.waveform.json`);
      await computeWaveform(abs, wfAbs, 8, ctx.registerChild);
      update.waveformUrl = storage.url(path.join(dirRel, `${base}.waveform.json`));
    }

    // Proxy for videos taller than 720p
    if (asset.kind === 'video' && (info.height ?? 0) > 720) {
      await ctx.setProgress(0.7, 'Proxy');
      const proxyAbs = path.join(dirAbs, `${base}.proxy.mp4`);
      await runOrThrow('ffmpeg', [
        '-hide_banner', '-y', '-i', abs,
        '-vf', 'scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '26',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        proxyAbs,
      ], { onChild: ctx.registerChild });
      update.proxyUrl = storage.url(path.join(dirRel, `${base}.proxy.mp4`));
    }

    await prisma.asset.update({ where: { id: assetId }, data: { ...update, status: 'ready', error: null } });
    // Set project thumbnail if missing
    if (thumbnailUrl) {
      const project = await prisma.project.findUnique({ where: { id: asset.projectId } });
      if (project && !project.thumbnailUrl) {
        await prisma.project.update({ where: { id: asset.projectId }, data: { thumbnailUrl } });
      }
    }
    return { assetId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.asset.update({ where: { id: assetId }, data: { status: 'error', error: message.slice(0, 2000) } });
    throw err;
  }
}

/** Extract 16k mono wav for transcription. Returns abs path of the wav. */
export async function extractAudioWav(srcAbs: string, outAbs: string, onChild?: JobContext['registerChild']): Promise<void> {
  await runOrThrow('ffmpeg', [
    '-hide_banner', '-nostats', '-y',
    '-i', srcAbs, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', outAbs,
  ], { onChild });
}

export async function extractThumbnailAt(srcAbs: string, time: number, outAbs: string): Promise<boolean> {
  const r = await run('ffmpeg', [
    '-hide_banner', '-y', '-ss', String(Math.max(0, time)), '-i', srcAbs,
    '-vf', 'scale=320:-2', '-frames:v', '1', outAbs,
  ]);
  return r.code === 0 && fs.existsSync(outAbs);
}
