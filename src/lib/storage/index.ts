import 'server-only';
import { hasObjectStorage } from '@/lib/env';
import { LocalStorage } from './local';
import { S3Storage } from './s3';
import type { StorageDriver } from './types';

export * from './types';
export { contentTypeFor } from './local';

let cached: StorageDriver | null = null;

/**
 * Picks object storage when it is configured, otherwise the filesystem driver.
 * Everything upstream only sees `StorageDriver`, so swapping providers is an
 * environment change, not a code change.
 */
export function getStorage(): StorageDriver {
  if (!cached) {
    cached = hasObjectStorage() ? new S3Storage() : new LocalStorage();
  }
  return cached;
}

export function storageInfo(): { driver: string; durable: boolean; directUpload: boolean; available: boolean } {
  const storage = getStorage();
  return {
    driver: storage.name,
    durable: storage.durable,
    directUpload: storage.directUpload,
    available: true,
  };
}
