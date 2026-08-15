import 'server-only';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isServerless } from '@/lib/env';
import { assertSafeKey, type StorageDriver, type UploadTicket } from './types';

/**
 * Filesystem storage for local development (and as a last-resort fallback on
 * serverless, where it lands in /tmp and is therefore per-instance and
 * short-lived — `durable` reports that honestly so the UI can warn).
 */
export class LocalStorage implements StorageDriver {
  readonly name = 'local';
  readonly durable = !isServerless;
  readonly directUpload = false;
  private root: string;

  constructor() {
    this.root = isServerless ? '/tmp/ave-storage' : resolve(process.cwd(), '.data', 'storage');
  }

  private path(key: string): string {
    assertSafeKey(key);
    const full = resolve(join(this.root, key));
    if (!full.startsWith(resolve(this.root))) throw new Error('Invalid storage key');
    return full;
  }

  async createUploadTicket(input: { key: string; contentType: string }): Promise<UploadTicket> {
    assertSafeKey(input.key);
    return {
      // No presigning available: the browser posts the file to our own route,
      // which streams it to disk.
      uploadUrl: `/api/upload?key=${encodeURIComponent(input.key)}`,
      method: 'POST',
      headers: { 'Content-Type': input.contentType },
      key: input.key,
      publicUrl: this.publicUrl(input.key),
      direct: false,
      expiresIn: 3600,
    };
  }

  async put(key: string, body: Uint8Array | Buffer, contentType: string) {
    void contentType;
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
    return { key, url: this.publicUrl(key) };
  }

  async get(key: string) {
    try {
      const body = await readFile(this.path(key));
      return { body: new Uint8Array(body), contentType: contentTypeFor(key) };
    } catch {
      return null;
    }
  }

  publicUrl(key: string): string {
    return `/api/files/${key}`;
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export function contentTypeFor(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}
