import 'server-only';
import { env } from '@/lib/env';
import { fetchWithRetry } from '@/lib/http';
import { AiError, extractJson, type AiProvider, type JsonRequest } from './types';

/**
 * Cloudflare Workers AI — a free daily allowance, no card required, and it
 * serves both instruct models and Whisper. Useful as a second free text
 * provider and as a transcription fallback that does not touch Gemini's quota.
 */
export function cloudflareBase(): string | null {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) return null;
  return `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run`;
}

export class CloudflareProvider implements AiProvider {
  readonly name = 'cloudflare' as const;
  readonly label = 'Cloudflare Workers AI';

  isConfigured(): boolean {
    return Boolean(cloudflareBase());
  }

  async generateJson(request: JsonRequest): Promise<unknown> {
    const base = cloudflareBase();
    if (!base) throw new AiError('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not configured', 'cloudflare');

    const res = await fetchWithRetry(
      `${base}/${env.CLOUDFLARE_MODEL}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
        body: JSON.stringify({
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
      throw new AiError(`Cloudflare request failed (${res.status}): ${detail.slice(0, 300)}`, 'cloudflare', res.status);
    }

    const body = (await res.json()) as {
      result?: { response?: string };
      success?: boolean;
      errors?: { message?: string }[];
    };
    if (body.success === false) {
      throw new AiError(`Cloudflare: ${body.errors?.[0]?.message ?? 'request rejected'}`, 'cloudflare');
    }
    const content = body.result?.response;
    if (!content) throw new AiError('Cloudflare returned an empty response', 'cloudflare');
    return extractJson(content);
  }
}
