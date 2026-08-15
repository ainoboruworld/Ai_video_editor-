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

export function orientationOf(width: number, height: number): 'landscape' | 'portrait' | 'square' {
  const ratio = width / Math.max(1, height);
  if (ratio > 1.15) return 'landscape';
  if (ratio < 0.87) return 'portrait';
  return 'square';
}
