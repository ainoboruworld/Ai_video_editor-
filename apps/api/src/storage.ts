import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** apps/api/data — everything served at /media/* lives here. */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '..', 'data');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
export const RENDERS_DIR = path.join(DATA_DIR, 'renders');

fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(RENDERS_DIR, { recursive: true });

export function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.slice(0, 120) || 'file';
}

/** Resolve a storage-relative path, guarding against traversal outside DATA_DIR. */
export function resolveDataPath(...parts: string[]): string {
  const p = path.resolve(DATA_DIR, ...parts);
  if (!p.startsWith(DATA_DIR + path.sep) && p !== DATA_DIR) {
    throw new Error('Path traversal detected');
  }
  return p;
}

export interface StorageProvider {
  /** Absolute filesystem path for a storage-relative path. */
  absPath(rel: string): string;
  /** Public URL path for a storage-relative path. */
  url(rel: string): string;
  ensureDir(rel: string): Promise<string>;
  exists(rel: string): Promise<boolean>;
  remove(rel: string): Promise<void>;
}

export class LocalStorageProvider implements StorageProvider {
  absPath(rel: string): string {
    return resolveDataPath(rel);
  }
  url(rel: string): string {
    return '/media/' + rel.split(path.sep).join('/');
  }
  async ensureDir(rel: string): Promise<string> {
    const p = this.absPath(rel);
    await fs.promises.mkdir(p, { recursive: true });
    return p;
  }
  async exists(rel: string): Promise<boolean> {
    try {
      await fs.promises.access(this.absPath(rel));
      return true;
    } catch {
      return false;
    }
  }
  async remove(rel: string): Promise<void> {
    await fs.promises.rm(this.absPath(rel), { recursive: true, force: true });
  }
}

export const storage = new LocalStorageProvider();

export const ALLOWED_EXTENSIONS = new Set([
  '.mp4', '.mov', '.webm', '.mkv',
  '.jpg', '.jpeg', '.png', '.webp',
  '.mp3', '.wav', '.m4a', '.aac',
]);

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024; // 4GB

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac']);

export function kindForExtension(ext: string): 'video' | 'audio' | 'image' | null {
  const e = ext.toLowerCase();
  if (VIDEO_EXT.has(e)) return 'video';
  if (IMAGE_EXT.has(e)) return 'image';
  if (AUDIO_EXT.has(e)) return 'audio';
  return null;
}

export function mimetypeAllowed(mimetype: string): boolean {
  return /^(video|audio|image)\//.test(mimetype) || mimetype === 'application/octet-stream';
}
