import 'server-only';
import { env } from '@/lib/env';
import { fetchWithTimeout } from '@/lib/http';
import { AiError, extractJson, type AiProvider, type JsonRequest } from './types';

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini' as const;
  readonly label = 'Google Gemini';

  isConfigured(): boolean {
    return Boolean(env.GEMINI_API_KEY);
  }

  async generateJson(request: JsonRequest): Promise<unknown> {
    const key = env.GEMINI_API_KEY;
    if (!key) throw new AiError('GEMINI_API_KEY is not configured', 'gemini');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      env.GEMINI_MODEL,
    )}:generateContent?key=${encodeURIComponent(key)}`;

    const res = await fetchWithTimeout(
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
      45_000,
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
