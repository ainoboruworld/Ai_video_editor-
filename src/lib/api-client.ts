/**
 * Browser-side API client. Every network call the editor makes goes through
 * here so errors, timeouts and typing are handled in one place.
 */
import type {
  AiCapabilities,
  Asset,
  CaptionCue,
  MediaSearchResponse,
  Project,
  ProjectSummary,
  RenderJob,
  StockMediaItem,
  Storyboard,
  StoryboardScene,
} from '@/types';
import type { AspectRatio } from '@/lib/engine';

export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'error',
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiClientError(0, 'Network error — check your connection and try again.', 'network');
  }
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    let code = 'error';
    try {
      const body = (await response.json()) as {
        error?: string;
        code?: string;
        details?: { fieldErrors?: Record<string, string[]> };
      };
      if (body.error) message = body.error;
      if (body.code) code = body.code;

      // A bare "Invalid request body" is a dead end for the user. When the
      // server says which fields failed, say so.
      const fields = body.details?.fieldErrors;
      if (fields) {
        const summary = Object.entries(fields)
          .map(([field, errors]) => `${field}: ${errors.join(', ')}`)
          .join('; ');
        if (summary) message = `${message} — ${summary}`;
      }
    } catch {
      // Non-JSON error body.
    }
    throw new ApiClientError(response.status, message, code);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function post(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export const api = {
  config: () => request<{ capabilities: AiCapabilities; ownerId: string }>('/api/config'),

  // ------------------------------------------------------------ projects --
  listProjects: () => request<{ projects: ProjectSummary[] }>('/api/projects'),
  createProject: (input: { name: string; aspect: AspectRatio; fps?: number }) =>
    request<{ project: Project }>('/api/projects', post(input)),
  getProject: (id: string) => request<{ project: Project }>(`/api/projects/${id}`),
  saveProject: (id: string, doc: unknown) =>
    request<{ project: Project; recreated?: boolean }>(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    }),
  renameProject: (id: string, name: string) =>
    request<{ project: Project }>(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  duplicateProject: (id: string) =>
    request<{ project: Project }>(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'duplicate' }),
    }),
  deleteProject: (id: string) => request<{ deleted: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),

  // --------------------------------------------------------------- media --
  searchMedia: (params: {
    q: string;
    type?: 'video' | 'image' | 'all';
    aspect?: string;
    orientation?: 'landscape' | 'portrait' | 'square';
    duration?: number;
    page?: number;
    perPage?: number;
  }) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
    });
    return request<MediaSearchResponse>(`/api/media/search?${search.toString()}`);
  },

  importStockAsset: (input: { projectId: string; item: StockMediaItem; persist?: boolean }) =>
    request<{ asset: Asset }>('/api/assets/import', post(input)),

  signUpload: (input: { projectId: string; filename: string; contentType: string; sizeBytes: number }) =>
    request<{
      ticket: {
        uploadUrl: string;
        method: 'PUT' | 'POST';
        headers: Record<string, string>;
        key: string;
        publicUrl: string;
        direct: boolean;
      };
      kind: 'video' | 'image' | 'audio';
    }>('/api/upload/sign', post(input)),

  // ------------------------------------------------------------------ AI --
  generateScript: (input: {
    prompt: string;
    durationSeconds: number;
    aspect: AspectRatio;
    tone?: string;
    sceneCount?: number;
    provider?: string;
  }) => request<{ storyboard: Storyboard }>('/api/ai/script', post(input)),

  findBroll: (input: {
    aspect: AspectRatio;
    scenes: { id: string; visual: string; duration: number; queries?: string[] }[];
    perScene?: number;
    type?: 'video' | 'image' | 'all';
    topic?: string;
  }) =>
    request<{
      recommendations: { sceneId: string; queries: string[]; items: StockMediaItem[]; error?: string }[];
      providers: string[];
      missingKeys: string[];
    }>('/api/ai/broll', post(input)),

  planEdit: (input: {
    durationSeconds: number;
    targetSeconds?: number;
    goal?: string;
    provider?: string;
    cues: { start: number; end: number; text: string }[];
  }) =>
    request<{
      plan: {
        summary: string;
        title: string;
        keep: { start: number; end: number; reason: string }[];
        brollCues: { start: number; duration: number; query: string; reason: string }[];
        callouts: { start: number; duration: number; text: string }[];
      };
      provider: string;
    }>('/api/ai/edit', post(input)),

  generateCaptions: (segments: { id: string; text: string; start: number; duration: number }[]) =>
    request<{ results: { id: string; cues: { text: string; start: number; end: number }[]; provider: string }[] }>(
      '/api/ai/captions',
      post({ segments }),
    ),

  suggestEdits: (summary: string) =>
    request<{ suggestions: { title: string; detail: string; severity: 'info' | 'improve' | 'fix' }[]; provider: string }>(
      '/api/ai/suggest',
      post({ summary }),
    ),

  generateTitles: (topic: string, script: string) =>
    request<{ payload: { titles: string[]; description: string; hashtags: string[] }; provider: string }>(
      '/api/ai/titles',
      post({ topic, script }),
    ),

  transcribe: (audio: Blob, language?: string) => {
    const form = new FormData();
    form.append('audio', audio, 'timeline.wav');
    if (language) form.append('language', language);
    return request<{ cues: CaptionCue[]; provider: string }>('/api/captions/transcribe', {
      method: 'POST',
      body: form,
    });
  },

  // ----------------------------------------------------------- rendering --
  startRender: (input: { projectId: string; resolution: number; fps: number; format: 'mp4' | 'webm' }) =>
    request<{ job: RenderJob }>('/api/render', post(input)),
  getRenderJob: (id: string) => request<{ job: RenderJob }>(`/api/render/${id}`),
};

export type { StoryboardScene };
