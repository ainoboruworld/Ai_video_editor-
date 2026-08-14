import type { EditorCommand, Sequence, AspectRatio } from '@ave/editor-core';

/** In dev, Vite proxies /api and /media to :4001. In production set VITE_API_URL to the API origin. */
export const API_ORIGIN: string = (import.meta as any).env?.VITE_API_URL?.replace(/\/$/, '') ?? '';
const BASE = `${API_ORIGIN}/api`;


export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch (e) {
    throw new ApiError(0, 'Cannot reach the server. Is the API running on port 4001?');
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) msg = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
      else if (body?.message) msg = body.message;
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function json(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// ---------- Types (per docs/API.md) ----------

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl: string | null;
  sequences?: SequenceRow[];
  assets?: Asset[];
}

export interface SequenceRow {
  id: string;
  projectId: string;
  name: string;
  doc: Sequence;
  version: number;
  updatedAt: string;
}

export interface Asset {
  id: string;
  projectId: string;
  kind: 'video' | 'audio' | 'image';
  name: string;
  status: 'processing' | 'ready' | 'error';
  originalUrl: string;
  proxyUrl: string | null;
  thumbnailUrl: string | null;
  waveformUrl: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  sizeBytes: number;
  error: string | null;
}

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  confidence: number;
}
export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
}
export interface Transcript {
  segments: TranscriptSegment[];
}

export interface SilenceSection {
  start: number;
  end: number;
  duration: number;
}

export interface FillerWord {
  text: string;
  start: number;
  end: number;
  segmentId: string;
}

export interface Scene {
  id: string;
  start: number;
  end: number;
  thumbnailUrl: string;
}

export interface Suggestion {
  id: string;
  assetId: string;
  kind: 'clip' | 'broll' | 'chapter' | 'hook';
  start: number;
  end: number;
  title: string;
  description: string;
  score: number | null;
  payload: any;
}

export interface Job {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  step: string | null;
  error: string | null;
  result: any;
}

// ---------- Projects ----------

export const api = {
  // Projects
  listProjects: () => req<Project[]>('/projects'),
  createProject: (name: string) => req<Project>('/projects', json({ name })),
  getProject: (id: string) => req<Project>(`/projects/${id}`),
  renameProject: (id: string, name: string) =>
    req<Project>(`/projects/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }),
  deleteProject: (id: string) => req<{ ok: true }>(`/projects/${id}`, { method: 'DELETE' }),
  duplicateProject: (id: string) => req<Project>(`/projects/${id}/duplicate`, { method: 'POST' }),

  // Sequences
  getSequence: (id: string) => req<SequenceRow>(`/sequences/${id}`),
  createSequence: (projectId: string, name: string, aspect?: AspectRatio) =>
    req<SequenceRow>(`/projects/${projectId}/sequences`, json({ name, aspect })),
  saveSequence: (id: string, doc: Sequence, version: number) =>
    req<{ version: number }>(`/sequences/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc, version }),
    }),
  listVersions: (id: string) => req<{ version: number; createdAt: string }[]>(`/sequences/${id}/versions`),
  restoreVersion: (id: string, version: number) => req<SequenceRow>(`/sequences/${id}/restore`, json({ version })),

  // Assets
  listAssets: (projectId: string) => req<Asset[]>(`/projects/${projectId}/assets`),
  getAsset: (id: string) => req<Asset>(`/assets/${id}`),
  deleteAsset: (id: string) => req<void>(`/assets/${id}`, { method: 'DELETE' }),
  uploadAsset: (projectId: string, file: File, onProgress?: (frac: number) => void): Promise<Asset> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/projects/${projectId}/assets`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new ApiError(xhr.status, 'Invalid server response'));
          }
        } else {
          reject(new ApiError(xhr.status, `Upload failed (${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new ApiError(0, 'Upload failed. Is the API running?'));
      const fd = new FormData();
      fd.append('file', file);
      xhr.send(fd);
    }),

  // Analysis
  transcribe: (assetId: string) => req<{ jobId: string }>(`/assets/${assetId}/transcribe`, { method: 'POST' }),
  getTranscript: (assetId: string) => req<Transcript | null>(`/assets/${assetId}/transcript`),
  detectSilence: (assetId: string, opts?: { minDuration?: number; noiseDb?: number }) =>
    req<{ sections: SilenceSection[] }>(`/assets/${assetId}/silence`, json(opts ?? {})),
  getFillers: (assetId: string) => req<{ words: FillerWord[] }>(`/assets/${assetId}/fillers`),
  detectScenes: (assetId: string) => req<{ jobId: string }>(`/assets/${assetId}/scenes`, { method: 'POST' }),
  getScenes: (assetId: string) => req<{ scenes: Scene[] }>(`/assets/${assetId}/scenes`),
  analyze: (assetId: string) => req<{ jobId: string }>(`/assets/${assetId}/analyze`, { method: 'POST' }),
  getSuggestions: (assetId: string, kind: Suggestion['kind']) =>
    req<Suggestion[]>(`/assets/${assetId}/suggestions?kind=${kind}`),
  generateClips: (
    assetId: string,
    body: { count: number; minDuration: number; maxDuration: number; platform?: string; style?: string },
  ) => req<{ jobId: string }>(`/assets/${assetId}/clips`, json(body)),
  getHooks: (assetId: string, start: number, end: number) =>
    req<{ hooks: string[] }>(`/assets/${assetId}/hooks`, json({ start, end })),

  // AI
  aiAssist: (sequenceId: string, prompt: string, assetId?: string) =>
    req<{ commands: EditorCommand[]; summary: string }>(`/sequences/${sequenceId}/ai`, json({ prompt, assetId })),

  // Jobs
  getJob: (id: string) => req<Job>(`/jobs/${id}`),
  cancelJob: (id: string) => req<{ ok: true }>(`/jobs/${id}/cancel`, { method: 'POST' }),

  // Render
  render: (
    sequenceId: string,
    body: { resolution: '720p' | '1080p' | '4k'; fps: 24 | 25 | 30 | 60; quality: 'draft' | 'standard' | 'high' | 'maximum' },
  ) => req<{ jobId: string }>(`/sequences/${sequenceId}/render`, json(body)),
};

/** Poll a job until done/error. Calls onTick each poll. Returns final job. */
export async function pollJob(
  jobId: string,
  onTick?: (job: Job) => void,
  intervalMs = 1000,
  signal?: { cancelled?: boolean },
): Promise<Job> {
  for (;;) {
    const job = await api.getJob(jobId);
    onTick?.(job);
    if (job.status === 'done' || job.status === 'error') return job;
    if (signal?.cancelled) return job;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export function mediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  // Relative /media/... goes through the Vite proxy in dev, or to VITE_API_URL in production.
  return url.startsWith('/') ? `${API_ORIGIN}${url}` : url;
}
