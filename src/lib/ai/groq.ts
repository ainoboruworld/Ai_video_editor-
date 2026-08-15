import 'server-only';
import { env } from '@/lib/env';
import { fetchWithRetry } from '@/lib/http';
import { AiError, extractJson, type AiProvider, type JsonRequest } from './types';

/**
 * Groq — free tier, OpenAI-compatible API.
 *
 * Together with Gemini this is what keeps the product genuinely free: scripts,
 * storyboards and captions all work on a no-cost key. Chat completions and
 * Whisper transcription share the same base URL.
 */
export const GROQ_BASE = 'https://api.groq.com/openai/v1';

export class GroqProvider implements AiProvider {
  readonly name = 'groq' as const;
  readonly label = 'Groq';

  isConfigured(): boolean {
    return Boolean(env.GROQ_API_KEY);
  }

  async generateJson(request: JsonRequest): Promise<unknown> {
    const key = env.GROQ_API_KEY;
    if (!key) throw new AiError('GROQ_API_KEY is not configured', 'groq');

    const res = await fetchWithRetry(
      `${GROQ_BASE}/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: env.GROQ_MODEL,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens ?? 2400,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `${request.system}\n\nReturn ONLY JSON matching:\n${request.schemaHint}` },
            { role: 'user', content: request.prompt },
          ],
        }),
      },
      { timeoutMs: 45_000, attempts: 3 },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new AiError(`Groq request failed (${res.status}): ${detail.slice(0, 300)}`, 'groq', res.status);
    }

    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new AiError('Groq returned an empty response', 'groq');
    return extractJson(content);
  }
}
