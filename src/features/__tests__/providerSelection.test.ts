import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Provider selection reads process.env through src/lib/env, which snapshots at
 * import time — so each case re-imports the module with a fresh environment.
 */
const KEYS = [
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'HF_TOKEN',
  'OLLAMA_BASE_URL',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'AI_PROVIDER',
];

const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) {
    original[key] = process.env[key];
    delete process.env[key];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const key of KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

async function load() {
  return import('@/lib/ai');
}

describe('provider selection', () => {
  it('reports offline with nothing configured', async () => {
    const ai = await load();
    expect(ai.activeProviderName()).toBe('offline');
    expect(ai.availableProviders()).toEqual([]);
  });

  it('prefers the widest free tier over the smallest', async () => {
    process.env.GEMINI_API_KEY = 'g';
    process.env.GROQ_API_KEY = 'q';
    const ai = await load();
    expect(ai.activeProviderName()).toBe('groq');
  });

  it('falls to OpenRouter before Gemini', async () => {
    process.env.GEMINI_API_KEY = 'g';
    process.env.OPENROUTER_API_KEY = 'o';
    const ai = await load();
    expect(ai.activeProviderName()).toBe('openrouter');
  });

  it('honours AI_PROVIDER when that provider is configured', async () => {
    process.env.GROQ_API_KEY = 'q';
    process.env.GEMINI_API_KEY = 'g';
    process.env.AI_PROVIDER = 'gemini';
    const ai = await load();
    expect(ai.activeProviderName()).toBe('gemini');
  });

  it('ignores AI_PROVIDER when that provider has no key', async () => {
    process.env.GROQ_API_KEY = 'q';
    process.env.AI_PROVIDER = 'gemini';
    const ai = await load();
    expect(ai.activeProviderName()).toBe('groq');
  });

  it('recognises Cloudflare only when both parts are present', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct';
    let ai = await load();
    expect(ai.availableProviders()).toEqual([]);

    vi.resetModules();
    process.env.CLOUDFLARE_API_TOKEN = 'token';
    ai = await load();
    expect(ai.availableProviders()).toContain('cloudflare');
  });

  it('treats a self-hosted Ollama URL as a configured provider', async () => {
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434';
    const ai = await load();
    expect(ai.availableProviders()).toContain('ollama');
  });

  it('lists every known provider in the catalog with its state', async () => {
    process.env.GROQ_API_KEY = 'q';
    const ai = await load();
    const catalog = ai.providerCatalog();
    expect(catalog.map((entry) => entry.name)).toEqual([
      'groq',
      'openrouter',
      'cloudflare',
      'huggingface',
      'ollama',
      'gemini',
      'openai',
    ]);
    expect(catalog.filter((entry) => entry.configured).map((entry) => entry.name)).toEqual(['groq']);
  });
});

describe('resolveProvider', () => {
  it('uses an explicitly requested provider', async () => {
    process.env.GROQ_API_KEY = 'q';
    process.env.GEMINI_API_KEY = 'g';
    const ai = await load();
    expect(ai.resolveProvider('gemini')?.name).toBe('gemini');
  });

  it('falls back to the default when the request names an unconfigured one', async () => {
    process.env.GROQ_API_KEY = 'q';
    const ai = await load();
    expect(ai.resolveProvider('ollama')?.name).toBe('groq');
  });

  it('returns null when the caller explicitly asks for offline', async () => {
    process.env.GROQ_API_KEY = 'q';
    const ai = await load();
    expect(ai.resolveProvider('offline')).toBeNull();
  });
});
