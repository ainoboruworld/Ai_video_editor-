import 'server-only';
import { env } from '@/lib/env';
import { fetchWithRetry } from '@/lib/http';
import { AiError, extractJson, type AiProvider, type JsonRequest } from './types';

/**
 * Hugging Face Inference — free tier with an OpenAI-compatible router, which is
 * how the open Qwen and Llama weights become usable without hosting them.
 */
export const HF_BASE = 'https://router.huggingface.co/v1';

export class HuggingFaceProvider implements AiProvider {
  readonly name = 'huggingface' as const;
  readonly label = 'Hugging Face';

  isConfigured(): boolean {
    return Boolean(env.HF_TOKEN);
  }

  async generateJson(request: JsonRequest): Promise<unknown> {
    const token = env.HF_TOKEN;
    if (!token) throw new AiError('HF_TOKEN is not configured', 'huggingface');

    const res = await fetchWithRetry(
      `${HF_BASE}/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          model: env.HF_MODEL,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens ?? 2400,
          messages: [
            {
              role: 'system',
              content: `${request.system}\n\nReturn ONLY JSON matching:\n${request.schemaHint}\nDo not wrap it in prose or code fences.`,
            },
            { role: 'user', content: request.prompt },
          ],
        }),
      },
      { timeoutMs: 45_000, attempts: 2 },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new AiError(`Hugging Face request failed (${res.status}): ${detail.slice(0, 300)}`, 'huggingface', res.status);
    }

    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new AiError('Hugging Face returned an empty response', 'huggingface');
    return extractJson(content);
  }
}
