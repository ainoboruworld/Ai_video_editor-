import type { MediaSearchRequest, StockMediaItem, StockProvider } from '@/types';

/**
 * Every stock source implements this interface. The API layer only ever talks
 * to `MediaProvider`, so adding a source (or removing one) never touches the UI
 * and API keys never leave the server.
 */
export interface MediaProvider {
  readonly name: StockProvider;
  readonly label: string;
  /** False when the provider has no API key configured. */
  isConfigured(): boolean;
  search(request: MediaSearchRequest): Promise<StockMediaItem[]>;
}

export interface ProviderSearchOptions {
  query: string;
  type: 'video' | 'image' | 'all';
  orientation?: 'landscape' | 'portrait' | 'square';
  perPage: number;
  page: number;
}

/**
 * Turns an upstream HTTP failure into something the user can act on.
 *
 * 401 is unambiguous: the key was seen and refused. 403 is not — a proxy or a
 * network policy between the server and the provider answers a blocked CONNECT
 * with exactly the same status, and telling someone to rotate a key that was
 * never actually presented sends them the wrong way. So 403 names both
 * possibilities, and `providerFailure` attaches whatever the upstream said,
 * which is the one thing that tells them apart.
 */
export function providerError(provider: string, envVar: string, status: number, context: string, detail?: string): Error {
  const because = detail ? ` Upstream said: ${detail}` : '';
  if (status === 401) {
    return new Error(`${provider} refused the key (401) — check ${envVar}.${because}`);
  }
  if (status === 403) {
    return new Error(
      `${provider} returned 403 — either ${envVar} is invalid or out of quota, or something between this server and ${provider} blocked the request.${because}`,
    );
  }
  if (status === 429) {
    return new Error(`${provider} rate limit reached (429) — wait a moment or reduce how often you search.`);
  }
  if (status >= 500) {
    return new Error(`${provider} is temporarily unavailable (${status}). Try again shortly.`);
  }
  return new Error(`${provider} ${context} failed (${status}).${because}`);
}

/** `providerError` with the upstream body attached, trimmed to something readable. */
export async function providerFailure(
  provider: string,
  envVar: string,
  response: Response,
  context: string,
): Promise<Error> {
  const detail = await response
    .text()
    .then((text) => text.replace(/\s+/g, ' ').trim().slice(0, 160))
    .catch(() => '');
  return providerError(provider, envVar, response.status, context, detail || undefined);
}

export function orientationOf(width: number, height: number): 'landscape' | 'portrait' | 'square' {
  const ratio = width / Math.max(1, height);
  if (ratio > 1.15) return 'landscape';
  if (ratio < 0.87) return 'portrait';
  return 'square';
}
