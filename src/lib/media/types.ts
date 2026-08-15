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
 * Turns an upstream HTTP failure into something the user can act on. A bare
 * "403" is indistinguishable from a network problem; naming the key and the
 * likely cause is what makes a misconfiguration fixable without reading logs.
 */
export function providerError(provider: string, envVar: string, status: number, context: string): Error {
  if (status === 401 || status === 403) {
    return new Error(`${provider} rejected the request (${status}) — check ${envVar} is valid and within quota.`);
  }
  if (status === 429) {
    return new Error(`${provider} rate limit reached (429) — wait a moment or reduce how often you search.`);
  }
  if (status >= 500) {
    return new Error(`${provider} is temporarily unavailable (${status}). Try again shortly.`);
  }
  return new Error(`${provider} ${context} failed (${status}).`);
}

export function orientationOf(width: number, height: number): 'landscape' | 'portrait' | 'square' {
  const ratio = width / Math.max(1, height);
  if (ratio > 1.15) return 'landscape';
  if (ratio < 0.87) return 'portrait';
  return 'square';
}
