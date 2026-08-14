import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  onChild?: (child: ChildProcess) => void;
  onStderrLine?: (line: string) => void;
  onStdoutLine?: (line: string) => void;
  /** Pipe stdout to this file descriptor stream instead of collecting. */
  stdoutToFile?: string;
  maxBuffer?: number;
}

/** Spawn a process safely: argument array, never a shell. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    opts.onChild?.(child);
    let stdout = '';
    let stderr = '';
    const max = opts.maxBuffer ?? 32 * 1024 * 1024;
    let outStream: fs.WriteStream | null = null;
    if (opts.stdoutToFile) {
      outStream = fs.createWriteStream(opts.stdoutToFile);
      child.stdout.pipe(outStream);
    } else {
      let outBuf = '';
      child.stdout.on('data', (d: Buffer) => {
        stdout = stdout.length < max ? stdout + d.toString('utf8') : stdout;
        if (opts.onStdoutLine) {
          outBuf += d.toString('utf8');
          let i;
          while ((i = outBuf.search(/[\r\n]/)) !== -1) {
            const line = outBuf.slice(0, i);
            outBuf = outBuf.slice(i + 1);
            if (line.trim()) opts.onStdoutLine(line);
          }
        }
      });
    }
    let errBuf = '';
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString('utf8');
      if (stderr.length < max) stderr += s;
      if (opts.onStderrLine) {
        errBuf += s;
        let i;
        while ((i = errBuf.search(/[\r\n]/)) !== -1) {
          const line = errBuf.slice(0, i);
          errBuf = errBuf.slice(i + 1);
          if (line.trim()) opts.onStderrLine(line);
        }
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (outStream) outStream.end();
      resolve({ code, stdout, stderr });
    });
  });
}

export async function runOrThrow(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) {
    throw new Error(`${cmd} exited with code ${r.code}: ${r.stderr.slice(-2000)}`);
  }
  return r;
}

export interface ProbeInfo {
  duration: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
}

export async function ffprobe(file: string): Promise<ProbeInfo> {
  const r = await runOrThrow('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format', '-show_streams',
    file,
  ]);
  const data = JSON.parse(r.stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number; avg_frame_rate?: string; duration?: string; disposition?: { attached_pic?: number } }>;
  };
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const audio = streams.find((s) => s.codec_type === 'audio');
  let fps: number | null = null;
  if (video?.avg_frame_rate && video.avg_frame_rate !== '0/0') {
    const [n, d] = video.avg_frame_rate.split('/').map(Number);
    if (n && d) fps = n / d;
  }
  const duration = data.format?.duration ? parseFloat(data.format.duration) : null;
  return {
    duration: Number.isFinite(duration!) ? duration : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps,
    hasAudio: !!audio,
    hasVideo: !!video,
  };
}

export interface SilenceSection {
  start: number;
  end: number;
  duration: number;
}

export async function detectSilence(file: string, minDuration = 0.6, noiseDb = -35): Promise<SilenceSection[]> {
  const r = await run('ffmpeg', [
    '-hide_banner', '-nostats',
    '-i', file,
    '-af', `silencedetect=noise=${noiseDb}dB:d=${minDuration}`,
    '-f', 'null', '-',
  ]);
  const sections: SilenceSection[] = [];
  let start: number | null = null;
  for (const line of r.stderr.split('\n')) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (s) start = parseFloat(s[1]!);
    const e = line.match(/silence_end:\s*(-?[\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);
    if (e && start !== null) {
      const end = parseFloat(e[1]!);
      sections.push({ start: Math.max(0, start), end, duration: parseFloat(e[2]!) });
      start = null;
    }
  }
  return sections;
}

/** Scene-change timestamps (seconds) using the select filter. */
export async function detectScenes(file: string, threshold = 0.4, onChild?: (c: ChildProcess) => void): Promise<number[]> {
  const r = await run('ffmpeg', [
    '-hide_banner', '-nostats',
    '-i', file,
    '-vf', `select='gt(scene,${threshold})',showinfo`,
    '-f', 'null', '-',
  ], { onChild, maxBuffer: 64 * 1024 * 1024 });
  const times: number[] = [];
  for (const m of r.stderr.matchAll(/pts_time:([\d.]+)/g)) {
    times.push(parseFloat(m[1]!));
  }
  return [...new Set(times)].sort((a, b) => a - b);
}
