import 'server-only';
import { env, isServerless } from '@/lib/env';
import { FileProjectStore } from './file';
import { MemoryProjectStore } from './memory';
import { PostgresProjectStore } from './postgres';
import type { ProjectStore } from './types';

export * from './types';
export { toSummary } from './summary';

let cached: ProjectStore | null = null;

/**
 * Driver selection: Postgres when DATABASE_URL is set, the filesystem for local
 * development, and an in-process map as the last resort. The API layer only
 * knows `ProjectStore`, so adding Prisma/Drizzle later is one new file.
 */
export function getStore(): ProjectStore {
  if (!cached) {
    if (env.DATABASE_URL) cached = new PostgresProjectStore();
    else if (!isServerless) cached = new FileProjectStore();
    else cached = new FileProjectStore(); // /tmp — ephemeral but functional
  }
  return cached;
}

export function databaseInfo(): { driver: string; durable: boolean } {
  const store = getStore();
  return { driver: store.driver, durable: store.durable };
}

export { MemoryProjectStore };
