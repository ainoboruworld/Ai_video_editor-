import 'server-only';
import { env } from '@/lib/env';
import { deriveQueries } from '@/lib/media/rank';
import type { AiProviderName } from '@/types';
import { GeminiProvider } from './gemini';
import { GroqProvider } from './groq';
import { OpenRouterProvider } from './openrouter';
import { CloudflareProvider } from './cloudflare';
import { HuggingFaceProvider } from './huggingface';
import { OllamaProvider } from './ollama';
import { BROLL_SCHEMA_HINT, BROLL_SYSTEM } from './prompts';
import { brollQuerySchema } from './schemas';
import { OpenAiProvider } from './openai';
import type { AiProvider } from './types';

export { AiError } from './types';
import { AiError as AiErrorType } from './types';

/**
 * Order matters: the widest free allowances first. Groq and OpenRouter (free
 * Qwen models) have day-scale limits, while Gemini's free tier is small and
 * shared with audio transcription — so it sits behind them. OpenAI is supported
 * but never required: the product has to stay usable at zero cost.
 */
const providers: AiProvider[] = [
  new GroqProvider(),
  new OpenRouterProvider(),
  new CloudflareProvider(),
  new HuggingFaceProvider(),
  new OllamaProvider(),
  new GeminiProvider(),
  new OpenAiProvider(),
];

/** Every provider with its configuration state, for the UI's provider picker. */
export function providerCatalog(): { name: AiProviderName; label: string; configured: boolean }[] {
  return providers.map((provider) => ({
    name: provider.name,
    label: provider.label,
    configured: provider.isConfigured(),
  }));
}

/**
 * Resolves an explicitly requested provider.
 *
 * Requests may name a provider so the user can pick per task in the UI. An
 * unconfigured or unknown name falls back to the normal free-first order
 * rather than failing — the request should still produce something.
 */
export function resolveProvider(requested?: AiProviderName | null): AiProvider | null {
  if (requested && requested !== 'offline') {
    const match = providers.find((provider) => provider.name === requested);
    if (match?.isConfigured()) return match;
  }
  if (requested === 'offline') return null;
  return activeProvider();
}

export function availableProviders(): AiProviderName[] {
  return providers.filter((p) => p.isConfigured()).map((p) => p.name);
}

/**
 * Resolves the provider to use. `AI_PROVIDER` forces one; otherwise the first
 * configured free provider wins (Groq, OpenRouter, Gemini, then OpenAI). Returns null
 * when nothing is configured — callers fall back to the offline draft generator.
 */
export function activeProvider(): AiProvider | null {
  if (env.AI_PROVIDER === 'offline') return null;
  if (env.AI_PROVIDER) {
    const forced = providers.find((p) => p.name === env.AI_PROVIDER);
    if (forced?.isConfigured()) return forced;
  }
  return providers.find((p) => p.isConfigured()) ?? null;
}

export function activeProviderName(): AiProviderName {
  return activeProvider()?.name ?? 'offline';
}

function sceneId(index: number): string {
  return `scene-${index + 1}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Prompt → script + storyboard. Uses the configured provider and validates the
 * response; if the provider fails we degrade to the offline draft rather than
 * leaving the user with nothing, and say so in `provider`.
 */
/** Human-readable reason for an AI provider failure, for surfacing to the user. */
export function describeAiError(error: unknown): string {
  if (!(error instanceof AiErrorType)) {
    return error instanceof Error ? error.message : 'The AI request failed.';
  }
  const quota = /quota|billing|exceeded your current/i.test(error.message);
  if (error.status === 429 && quota) {
    return `${error.provider} free-tier quota is used up for now. Add another free key (GROQ_API_KEY or GEMINI_API_KEY) or wait for the quota to reset.`;
  }
  if (error.status === 429) return `${error.provider} is rate limiting requests. Wait a moment and try again.`;
  if (error.status === 401 || error.status === 403) return `${error.provider} rejected the API key.`;
  if (error.status === 503) return `${error.provider} is busy right now. Try again shortly.`;
  return error.message;
}

/** Scene description → stock search queries. */
export async function generateBrollQueries(visual: string, context?: string): Promise<{ queries: string[]; provider: AiProviderName }> {
  const provider = activeProvider();
  if (provider) {
    try {
      const raw = await provider.generateJson({
        system: BROLL_SYSTEM,
        prompt: [`Scene visual: ${visual}`, context ? `Video topic: ${context}` : ''].filter(Boolean).join('\n'),
        schemaHint: BROLL_SCHEMA_HINT,
        temperature: 0.5,
        maxTokens: 300,
      });
      const parsed = brollQuerySchema.parse(raw);
      return { queries: parsed.queries, provider: provider.name };
    } catch (error) {
      console.warn('[ai] broll query generation failed, deriving locally:', error);
    }
  }
  return { queries: deriveQueries(visual, 4), provider: 'offline' };
}

/** Narration → caption cues with timings inside [start, start + duration]. */
/** Timeline summary → editing notes. */
/** Storyboard → titles, description, hashtags. */
