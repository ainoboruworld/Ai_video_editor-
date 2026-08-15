import 'server-only';
import { env } from '@/lib/env';
import { fetchWithRetry } from '@/lib/http';
import { AiError, extractJson, type AiProvider, type JsonRequest } from './types';

/**
 * Ollama — models running on your own machine or server.
 *
 * No key, no quota, no per-token cost, and nothing leaves your infrastructure.
 * The trade-off is that you host it: set OLLAMA_BASE_URL to a reachable
 * instance (for a Vercel deployment that means a public or tunnelled address,
 * not localhost).
 */
export class OllamaProvider implements AiProvider {
  readonly name = 'ollama' as const;
  readonly label = 'Ollama (self-hosted)';

  isConfigured(): boolean {
    return Boolean(env.OLLAMA_BASE_URL);
  }

  async generateJson(request: JsonRequest): Promise<unknown> {
    const base = env.OLLAMA_BASE_URL?.replace(/\/$/, '');
    if (!base) throw new AiError('OLLAMA_BASE_URL is not configured', 'ollama');

    const res = await fetchWithRetry(
      `${base}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: env.OLLAMA_MODEL,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens ?? 2400,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `${request.system}\n\nReturn ONLY JSON matching:\n${request.schemaHint}` },
            { role: 'user', content: request.prompt },
          ],
        }),
      },
      // A local model on CPU can be slow; give it room.
      { timeoutMs: 120_000, attempts: 1 },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new AiError(`Ollama request failed (${res.status}): ${detail.slice(0, 300)}`, 'ollama', res.status);
    }

    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new AiError('Ollama returned an empty response', 'ollama');
    return extractJson(content);
  }
}
