import 'server-only';
import { env } from '@/lib/env';
import { fetchWithRetry } from '@/lib/http';
import { AiError, extractJson, type AiProvider, type JsonRequest } from './types';

/**
 * OpenRouter — one key, many models, including genuinely free ones.
 *
 * This is the route to Qwen without a Google or Groq quota: model ids ending in
 * `:free` cost nothing, and OpenRouter's own free allowance is per-day rather
 * than the small per-minute token budgets that make long jobs fail. The API is
 * OpenAI-compatible, so this is the same shape as the Groq provider.
 */
export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export class OpenRouterProvider implements AiProvider {
  readonly name = 'openrouter' as const;
  readonly label = 'OpenRouter';

  isConfigured(): boolean {
    return Boolean(env.OPENROUTER_API_KEY);
  }

  async generateJson(request: JsonRequest): Promise<unknown> {
    const key = env.OPENROUTER_API_KEY;
    if (!key) throw new AiError('OPENROUTER_API_KEY is not configured', 'openrouter');

    const res = await fetchWithRetry(
      `${OPENROUTER_BASE}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          // OpenRouter asks callers to identify themselves; both are optional.
          ...(env.APP_URL ? { 'HTTP-Referer': env.APP_URL } : {}),
          'X-Title': 'Reelframe',
        },
        body: JSON.stringify({
          model: env.OPENROUTER_MODEL,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens ?? 2400,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `${request.system}\n\nReturn ONLY JSON matching:\n${request.schemaHint}` },
            { role: 'user', content: request.prompt },
          ],
        }),
      },
      { timeoutMs: 45_000, attempts: 2 },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new AiError(`OpenRouter request failed (${res.status}): ${detail.slice(0, 300)}`, 'openrouter', res.status);
    }

    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    if (body.error?.message) throw new AiError(`OpenRouter: ${body.error.message}`, 'openrouter');

    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new AiError('OpenRouter returned an empty response', 'openrouter');
    return extractJson(content);
  }
}
