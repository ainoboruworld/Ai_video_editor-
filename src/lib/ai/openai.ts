import 'server-only';
import { env } from '@/lib/env';
import { fetchWithTimeout } from '@/lib/http';
import { AiError, extractJson, type AiProvider, type JsonRequest } from './types';

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai' as const;
  readonly label = 'OpenAI';

  isConfigured(): boolean {
    return Boolean(env.OPENAI_API_KEY);
  }

  async generateJson(request: JsonRequest): Promise<unknown> {
    const key = env.OPENAI_API_KEY;
    if (!key) throw new AiError('OPENAI_API_KEY is not configured', 'openai');

    const res = await fetchWithTimeout(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: env.OPENAI_MODEL,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens ?? 2400,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: `${request.system}\n\nReturn ONLY JSON matching:\n${request.schemaHint}` },
            { role: 'user', content: request.prompt },
          ],
        }),
      },
      45_000,
    );

    if (!res.ok) {
      const detail = await safeText(res);
      throw new AiError(`OpenAI request failed (${res.status}): ${detail}`, 'openai', res.status);
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new AiError('OpenAI returned an empty response', 'openai');
    return extractJson(content);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 300);
  } catch {
    return res.statusText;
  }
}
