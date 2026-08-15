/**
 * Server-only environment access. Never import this from a client component —
 * API keys must not reach the browser. The app is designed to boot with an
 * empty environment: every capability degrades to a documented fallback.
 */
import 'server-only';

function read(name: string): string | null {
  const value = process.env[name];
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const env = {
  // Stock media providers
  PEXELS_API_KEY: read('PEXELS_API_KEY'),
  PIXABAY_API_KEY: read('PIXABAY_API_KEY'),
  UNSPLASH_ACCESS_KEY: read('UNSPLASH_ACCESS_KEY'),

  // AI providers
  OPENAI_API_KEY: read('OPENAI_API_KEY'),
  OPENAI_MODEL: read('OPENAI_MODEL') ?? 'gpt-4o-mini',
  OPENAI_TRANSCRIBE_MODEL: read('OPENAI_TRANSCRIBE_MODEL') ?? 'whisper-1',
  GEMINI_API_KEY: read('GEMINI_API_KEY'),
  GEMINI_MODEL: read('GEMINI_MODEL') ?? 'gemini-2.0-flash',
  AI_PROVIDER: read('AI_PROVIDER'), // force a provider: openai | gemini | offline

  // Database
  DATABASE_URL: read('DATABASE_URL'),

  // Object storage (S3-compatible: AWS S3, Cloudflare R2, Backblaze B2, MinIO…)
  STORAGE_URL: read('STORAGE_URL'), // endpoint, e.g. https://<account>.r2.cloudflarestorage.com
  STORAGE_BUCKET: read('STORAGE_BUCKET'),
  STORAGE_REGION: read('STORAGE_REGION') ?? 'auto',
  STORAGE_ACCESS_KEY: read('STORAGE_ACCESS_KEY'),
  STORAGE_SECRET_KEY: read('STORAGE_SECRET_KEY'),
  STORAGE_PUBLIC_URL: read('STORAGE_PUBLIC_URL'), // CDN/public base for reading objects

  // Rendering
  RENDER_WORKER_URL: read('RENDER_WORKER_URL'),
  RENDER_WORKER_TOKEN: read('RENDER_WORKER_TOKEN'),

  // Runtime
  APP_URL: read('APP_URL') ?? read('NEXT_PUBLIC_APP_URL'),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
} as const;

export const isProduction = env.NODE_ENV === 'production';

/** Vercel (and most serverless hosts) have a read-only FS apart from /tmp. */
export const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

export function hasAnyStockProvider(): boolean {
  return Boolean(env.PEXELS_API_KEY || env.PIXABAY_API_KEY || env.UNSPLASH_ACCESS_KEY);
}

export function hasAnyAiProvider(): boolean {
  return Boolean(env.OPENAI_API_KEY || env.GEMINI_API_KEY);
}

export function hasObjectStorage(): boolean {
  return Boolean(env.STORAGE_URL && env.STORAGE_BUCKET && env.STORAGE_ACCESS_KEY && env.STORAGE_SECRET_KEY);
}
