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

  // AI providers, free tiers first. None of them is required.
  GEMINI_API_KEY: read('GEMINI_API_KEY'),
  // Alias rather than a pinned version: Google retires specific model ids
  // (gemini-2.0-flash and gemini-2.5-flash are both gone), and a hardcoded one
  // turns into a 404 outage. Pin explicitly with GEMINI_MODEL if you need to.
  GEMINI_MODEL: read('GEMINI_MODEL') ?? 'gemini-flash-latest',
  GROQ_API_KEY: read('GROQ_API_KEY'),
  GROQ_MODEL: read('GROQ_MODEL') ?? 'llama-3.3-70b-versatile',
  // Groq serves Whisper on its free tier, so automatic captions cost nothing.
  GROQ_TRANSCRIBE_MODEL: read('GROQ_TRANSCRIBE_MODEL') ?? 'whisper-large-v3-turbo',
  // OpenRouter reaches free Qwen models with a single key.
  OPENROUTER_API_KEY: read('OPENROUTER_API_KEY'),
  OPENROUTER_MODEL: read('OPENROUTER_MODEL') ?? 'qwen/qwen3-coder:free',
  // Cloudflare Workers AI: free daily allowance, text + Whisper.
  CLOUDFLARE_ACCOUNT_ID: read('CLOUDFLARE_ACCOUNT_ID'),
  CLOUDFLARE_API_TOKEN: read('CLOUDFLARE_API_TOKEN'),
  CLOUDFLARE_MODEL: read('CLOUDFLARE_MODEL') ?? '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  CLOUDFLARE_TRANSCRIBE_MODEL: read('CLOUDFLARE_TRANSCRIBE_MODEL') ?? '@cf/openai/whisper-large-v3-turbo',

  // Hugging Face Inference: free tier, text + Whisper.
  HF_TOKEN: read('HF_TOKEN'),
  HF_MODEL: read('HF_MODEL') ?? 'Qwen/Qwen2.5-72B-Instruct',
  HF_TRANSCRIBE_MODEL: read('HF_TRANSCRIBE_MODEL') ?? 'openai/whisper-large-v3',

  // Ollama: fully local, no key, no quota. Point at your own machine or server.
  OLLAMA_BASE_URL: read('OLLAMA_BASE_URL'),
  OLLAMA_MODEL: read('OLLAMA_MODEL') ?? 'qwen2.5:7b',

  OPENAI_API_KEY: read('OPENAI_API_KEY'),
  OPENAI_MODEL: read('OPENAI_MODEL') ?? 'gpt-4o-mini',
  OPENAI_TRANSCRIBE_MODEL: read('OPENAI_TRANSCRIBE_MODEL') ?? 'whisper-1',
  // Force one provider; otherwise the first configured one wins, free-first.
  AI_PROVIDER: read('AI_PROVIDER'),

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
  return Boolean(
    env.GROQ_API_KEY ||
      env.OPENROUTER_API_KEY ||
      env.GEMINI_API_KEY ||
      (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN) ||
      env.HF_TOKEN ||
      env.OLLAMA_BASE_URL ||
      env.OPENAI_API_KEY,
  );
}

export function hasObjectStorage(): boolean {
  return Boolean(env.STORAGE_URL && env.STORAGE_BUCKET && env.STORAGE_ACCESS_KEY && env.STORAGE_SECRET_KEY);
}
