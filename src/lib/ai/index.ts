import 'server-only';
import { env } from '@/lib/env';
import { deriveQueries } from '@/lib/media/rank';
import type { AiProviderName, ScriptRequest, Storyboard, StoryboardScene } from '@/types';
import { GeminiProvider } from './gemini';
import { GroqProvider } from './groq';
import { offlineCaptionCues, offlineStoryboard } from './offline';
import {
  BROLL_SCHEMA_HINT,
  BROLL_SYSTEM,
  CAPTION_SCHEMA_HINT,
  CAPTION_SYSTEM,
  STORYBOARD_SCHEMA_HINT,
  STORYBOARD_SYSTEM,
  SUGGESTION_SCHEMA_HINT,
  SUGGESTION_SYSTEM,
  TITLES_SCHEMA_HINT,
  TITLES_SYSTEM,
  storyboardPrompt,
} from './prompts';
import {
  brollQuerySchema,
  captionCuesSchema,
  storyboardSchema,
  suggestionsSchema,
  titlesSchema,
  type CaptionCuesPayload,
  type SuggestionsPayload,
  type TitlesPayload,
} from './schemas';
import { OpenAiProvider } from './openai';
import type { AiProvider } from './types';

export { AiError } from './types';
export { offlineCaptionCues, offlineStoryboard } from './offline';

/**
 * Order matters: free tiers first. OpenAI is supported but never required —
 * the product has to stay usable at zero cost.
 */
const providers: AiProvider[] = [new GeminiProvider(), new GroqProvider(), new OpenAiProvider()];

export function availableProviders(): AiProviderName[] {
  return providers.filter((p) => p.isConfigured()).map((p) => p.name);
}

/**
 * Resolves the provider to use. `AI_PROVIDER` forces one; otherwise the first
 * configured free provider wins (Gemini, then Groq, then OpenAI). Returns null
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
export async function generateStoryboard(request: ScriptRequest): Promise<Storyboard> {
  const provider = activeProvider();
  let payload = null as ReturnType<typeof storyboardSchema.parse> | null;
  let usedProvider: AiProviderName = 'offline';
  let warning: string | null = null;

  if (provider) {
    try {
      const raw = await provider.generateJson({
        system: STORYBOARD_SYSTEM,
        prompt: storyboardPrompt(request),
        schemaHint: STORYBOARD_SCHEMA_HINT,
        temperature: 0.8,
      });
      payload = storyboardSchema.parse(raw);
      usedProvider = provider.name;
    } catch (error) {
      warning = error instanceof Error ? error.message : 'AI request failed';
    }
  }

  if (!payload) {
    payload = storyboardSchema.parse(offlineStoryboard(request));
  }

  const scenes: StoryboardScene[] = payload.scenes.map((scene, index) => ({
    id: sceneId(index),
    index,
    title: scene.title,
    duration: scene.duration,
    script: scene.script,
    onScreenText: scene.onScreenText,
    visual: scene.visual,
    brollQueries: scene.brollQueries.length > 0 ? scene.brollQueries : deriveQueries(scene.visual, 3),
    assetId: null,
    transition: scene.transition,
    clipIds: [],
  }));

  const storyboard: Storyboard = {
    prompt: request.prompt,
    title: payload.title,
    hook: payload.hook,
    cta: payload.cta,
    tone: payload.tone,
    scenes,
    provider: usedProvider,
    createdAt: new Date().toISOString(),
  };
  if (warning) console.warn('[ai] falling back to offline draft:', warning);
  return storyboard;
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
export async function generateCaptionCues(input: {
  text: string;
  start: number;
  duration: number;
}): Promise<{ cues: CaptionCuesPayload['cues']; provider: AiProviderName }> {
  const provider = activeProvider();
  if (provider) {
    try {
      const raw = await provider.generateJson({
        system: CAPTION_SYSTEM,
        prompt: `Narration: ${input.text}\nStart: ${input.start}\nEnd: ${input.start + input.duration}`,
        schemaHint: CAPTION_SCHEMA_HINT,
        temperature: 0.2,
        maxTokens: 900,
      });
      const parsed = captionCuesSchema.parse(raw);
      const clamped = parsed.cues
        .map((cue) => ({
          text: cue.text,
          start: Math.max(input.start, Math.min(cue.start, input.start + input.duration)),
          end: Math.max(input.start, Math.min(cue.end, input.start + input.duration)),
        }))
        .filter((cue) => cue.end > cue.start);
      if (clamped.length > 0) return { cues: clamped, provider: provider.name };
    } catch (error) {
      console.warn('[ai] caption generation failed, splitting locally:', error);
    }
  }
  return { cues: offlineCaptionCues(input.text, input.start, input.duration), provider: 'offline' };
}

/** Timeline summary → editing notes. */
export async function generateSuggestions(summary: string): Promise<{ suggestions: SuggestionsPayload['suggestions']; provider: AiProviderName }> {
  const provider = activeProvider();
  if (!provider) {
    return { suggestions: [], provider: 'offline' };
  }
  const raw = await provider.generateJson({
    system: SUGGESTION_SYSTEM,
    prompt: summary,
    schemaHint: SUGGESTION_SCHEMA_HINT,
    temperature: 0.4,
    maxTokens: 900,
  });
  return { suggestions: suggestionsSchema.parse(raw).suggestions, provider: provider.name };
}

/** Storyboard → titles, description, hashtags. */
export async function generateTitles(topic: string, script: string): Promise<{ payload: TitlesPayload; provider: AiProviderName }> {
  const provider = activeProvider();
  if (!provider) {
    return {
      payload: { titles: [topic], description: script.slice(0, 300), hashtags: [] },
      provider: 'offline',
    };
  }
  const raw = await provider.generateJson({
    system: TITLES_SYSTEM,
    prompt: `Topic: ${topic}\n\nScript:\n${script.slice(0, 3000)}`,
    schemaHint: TITLES_SCHEMA_HINT,
    temperature: 0.9,
    maxTokens: 700,
  });
  return { payload: titlesSchema.parse(raw), provider: provider.name };
}
