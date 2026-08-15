export interface UploadTicket {
  /** Where the browser should PUT/POST the bytes. */
  uploadUrl: string;
  method: 'PUT' | 'POST';
  headers: Record<string, string>;
  /** Storage key to send back when registering the asset. */
  key: string;
  /** URL the finished object can be read from. */
  publicUrl: string;
  /** True when the browser uploads straight to object storage (no serverless hop). */
  direct: boolean;
  expiresIn: number;
}

export interface StorageDriver {
  readonly name: string;
  /** Objects survive a deploy / cold start. */
  readonly durable: boolean;
  /** Browser can upload straight to storage with a presigned URL. */
  readonly directUpload: boolean;
  createUploadTicket(input: { key: string; contentType: string; sizeBytes?: number }): Promise<UploadTicket>;
  put(key: string, body: Uint8Array | Buffer, contentType: string): Promise<{ key: string; url: string }>;
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  publicUrl(key: string): string;
  remove(key: string): Promise<void>;
}

/** Namespaced, collision-free, path-traversal-free storage key. */
export function buildKey(parts: { ownerId: string; projectId: string; filename: string }): string {
  const safe = parts.filename
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-80);
  const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `u/${sanitizeSegment(parts.ownerId)}/${sanitizeSegment(parts.projectId)}/${unique}-${safe}`;
}

export function sanitizeSegment(value: string): string {
  return value.replace(/[^\w-]+/g, '').slice(0, 64) || 'anon';
}

/** Rejects keys that try to escape the storage root. */
export function assertSafeKey(key: string): void {
  if (!key || key.includes('..') || key.startsWith('/') || key.includes('\\') || key.length > 300) {
    throw new Error('Invalid storage key');
  }
}
