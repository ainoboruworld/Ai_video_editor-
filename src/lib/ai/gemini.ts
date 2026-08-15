import 'server-only';
import { env } from '@/lib/env';
import { fetchWithRetry } from '@/lib/http';
import { AiError, extractJson, type AiProvider, type JsonRequest } from './types';

/**
 * Models tried when the configured one is congested. Google's free tier returns
 * 503 "high demand" in bursts, and the lite models are usually the first to
 * recover — so a spike costs a second, not the whole generation.
 */
const FALLBACK_MODELS = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite'];

/** 503/429 mean "try again or try elsewhere"; anything else is a real failure. */
function isCongestion(error: unknown): boolean {
  if (error instanceof AiError) return error.status === 503 || error.status === 429;
  // A timeout is treated the same way: the model is taking too long right now.
  return error instanceof Error && /timed out/i.test(error.message);
}

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini' as const;
  readonly label = 'Google Gemini';

  isConfigured(): boolean {
    return Boolean(env.GEMINI_API_KEY);
  }

  async generateJson(request: JsonRequest): Promise<unknown> {
    const key = env.GEMINI_API_KEY;
    if (!key) throw new AiError('GEMINI_API_KEY is not configured', 'gemini');

    const models = [env.GEMINI_MODEL, ...FALLBACK_MODELS.filter((model) => model !== env.GEMINI_MODEL)];
    let lastError: unknown;

    for (const model of models) {
      try {
        return await this.callModel(key, model, request);
      } catch (error) {
        lastError = error;
        if (!isCongestion(error)) throw error;
        console.warn(`[ai] Gemini model ${model} is congested, trying the next one`);
      }
    }
    throw lastError instanceof Error ? lastError : new AiError('Gemini request failed', 'gemini');
  }

  private async callModel(key: string, model: string, request: JsonRequest): Promise<unknown> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(key)}`;

    const res = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: `${request.system}\n\nReturn ONLY JSON matching:\n${request.schemaHint}` }],
          },
          contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
          generationConfig: {
            temperature: request.temperature ?? 0.7,
            maxOutputTokens: request.maxTokens ?? 2400,
            responseMimeType: 'application/json',
          },
        }),
      },
      { timeoutMs: 30_000, attempts: 2 },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new AiError(`Gemini request failed (${res.status}): ${detail.slice(0, 300)}`, 'gemini', res.status);
    }
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text.trim()) throw new AiError('Gemini returned an empty response', 'gemini');
    return extractJson(text);
  }
}
