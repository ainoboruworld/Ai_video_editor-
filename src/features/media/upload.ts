'use client';

/**
 * Client-side upload pipeline.
 *
 * With object storage configured the file goes straight from the browser to the
 * bucket using a presigned URL — no serverless size limit, no proxy hop. Without
 * it, small files use the API route and larger ones stay local to the browser
 * session (a real, working editing experience, clearly labelled as
 * "this browser only" so nobody is surprised after a reload).
 */
import { api, ApiClientError } from '@/lib/api-client';
import type { Asset, AssetKind } from '@/types';

export const ACCEPTED_MIME = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-m4v',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/ogg',
];

export const MAX_LOCAL_BYTES = 2 * 1024 * 1024 * 1024;

export function kindForFile(file: File): AssetKind | null {
  const type = file.type.toLowerCase();
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('audio/')) return 'audio';
  return null;
}

export interface UploadOutcome {
  asset: Asset;
  /** True when the file never left the browser (no storage configured). */
  localOnly: boolean;
}

export async function uploadFile(
  file: File,
  projectId: string,
  onProgress?: (fraction: number) => void,
): Promise<UploadOutcome> {
  const kind = kindForFile(file);
  if (!kind) throw new Error(`${file.name}: unsupported file type (${file.type || 'unknown'})`);
  if (!ACCEPTED_MIME.includes(file.type.toLowerCase())) {
    throw new Error(`${file.name}: ${file.type} is not supported. Use MP4/WebM/MOV, JPG/PNG/WebP or MP3/WAV.`);
  }
  if (file.size > MAX_LOCAL_BYTES) throw new Error(`${file.name} is larger than 2 GB.`);

  const probe = await probeMedia(file, kind);
  let url = probe.objectUrl;
  let storageKey: string | null = null;
  let localOnly = true;

  try {
    const { ticket } = await api.signUpload({
      projectId,
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    });
    await putFile(ticket.uploadUrl, ticket.method, ticket.headers, file, onProgress);
    url = ticket.publicUrl;
    storageKey = ticket.key;
    localOnly = false;
    URL.revokeObjectURL(probe.objectUrl);
  } catch (error) {
    // Storage is optional: keep editing with the in-browser object URL and let
    // the caller warn the user that this file will not survive a reload.
    if (!(error instanceof ApiClientError)) throw error;
    onProgress?.(1);
  }

  const asset: Asset = {
    id: `a_${Math.random().toString(36).slice(2, 12)}`,
    kind,
    name: file.name,
    url,
    thumbnailUrl: probe.thumbnailUrl,
    duration: probe.duration,
    width: probe.width,
    height: probe.height,
    sizeBytes: file.size,
    mimeType: file.type,
    origin: 'upload',
    storageKey,
    credit: {
      provider: 'user',
      providerLabel: 'Uploaded',
      creator: null,
      creatorUrl: null,
      sourceUrl: null,
      license: 'Provided by the user',
    },
    createdAt: new Date().toISOString(),
    ephemeral: localOnly,
  };

  return { asset, localOnly };
}

function putFile(
  url: string,
  method: 'PUT' | 'POST',
  headers: Record<string, string>,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiClientError(xhr.status, `Upload failed (${xhr.status})`, 'upload_failed'));
    };
    xhr.onerror = () => reject(new ApiClientError(0, 'Upload failed — network error', 'network'));
    xhr.send(file);
  });
}

interface ProbeResult {
  objectUrl: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  thumbnailUrl: string | null;
}

/** Reads real duration/dimensions and grabs a poster frame, all in the browser. */
export async function probeMedia(file: File, kind: AssetKind): Promise<ProbeResult> {
  const objectUrl = URL.createObjectURL(file);
  if (kind === 'image') {
    const image = await loadImage(objectUrl);
    return {
      objectUrl,
      duration: null,
      width: image.naturalWidth,
      height: image.naturalHeight,
      thumbnailUrl: objectUrl,
    };
  }

  const element = document.createElement(kind === 'audio' ? 'audio' : 'video');
  element.preload = 'metadata';
  element.src = objectUrl;

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    element.addEventListener('loadedmetadata', done, { once: true });
    element.addEventListener('error', done, { once: true });
    setTimeout(done, 6000);
  });

  const duration = await resolveDuration(element);
  if (kind === 'audio' || !(element instanceof HTMLVideoElement)) {
    return { objectUrl, duration, width: null, height: null, thumbnailUrl: null };
  }

  const thumbnailUrl = await grabPoster(element).catch(() => null);
  return {
    objectUrl,
    duration,
    width: element.videoWidth || null,
    height: element.videoHeight || null,
    thumbnailUrl,
  };
}

/**
 * Reads a media element's true duration.
 *
 * Files recorded by MediaRecorder — including this app's own browser exports —
 * are written as a live stream and carry no duration in the header, so browsers
 * report `Infinity` until the whole file has been scanned. Seeking past the end
 * forces that scan; without this, a 12-minute upload lands on the timeline as a
 * default-length clip and the rest of it is silently ignored.
 */
async function resolveDuration(element: HTMLMediaElement): Promise<number | null> {
  if (Number.isFinite(element.duration) && element.duration > 0) return element.duration;

  const scanned = await new Promise<number | null>((resolve) => {
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      element.removeEventListener('durationchange', onDurationChange);
      resolve(value);
    };
    const onDurationChange = () => {
      if (Number.isFinite(element.duration) && element.duration > 0) finish(element.duration);
    };
    element.addEventListener('durationchange', onDurationChange);
    try {
      element.currentTime = 1e101;
    } catch {
      finish(null);
    }
    setTimeout(() => finish(Number.isFinite(element.duration) ? element.duration : null), 8000);
  });

  try {
    element.currentTime = 0;
  } catch {
    // Nothing to reset if the element never became seekable.
  }
  return scanned && scanned > 0 ? scanned : null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read this image'));
    image.src = src;
  });
}

async function grabPoster(video: HTMLVideoElement): Promise<string | null> {
  await new Promise<void>((resolve) => {
    const seek = () => resolve();
    video.addEventListener('seeked', seek, { once: true });
    video.currentTime = Math.min(0.6, (video.duration || 1) * 0.1);
    setTimeout(seek, 3000);
  });
  const canvas = document.createElement('canvas');
  const scale = 240 / Math.max(1, video.videoWidth);
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7);
}
