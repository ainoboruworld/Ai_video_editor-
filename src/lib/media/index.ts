import 'server-only';
import type { MediaSearchRequest, MediaSearchResponse, StockProvider } from '@/types';
import { PexelsProvider } from './pexels';
import { PixabayProvider } from './pixabay';
import { UnsplashProvider } from './unsplash';
import { rankItems, type RankContext } from './rank';
import type { MediaProvider } from './types';

export * from './rank';
export { trackUnsplashDownload } from './unsplash';
export type { MediaProvider } from './types';

const providers: MediaProvider[] = [new PexelsProvider(), new PixabayProvider(), new UnsplashProvider()];

export function listProviders(): MediaProvider[] {
  return providers;
}

export function getProvider(name: StockProvider): MediaProvider | undefined {
  return providers.find((p) => p.name === name);
}

export function configuredProviders(): StockProvider[] {
  return providers.filter((p) => p.isConfigured()).map((p) => p.name);
}

/**
 * Searches every configured provider in parallel and merges the results.
 * Providers are tried in the requested order (default: Pexels first, then
 * Pixabay, then Unsplash for stills) and a failing provider never fails the
 * whole search — its error is reported alongside the results that did work.
 */
export async function searchStockMedia(
  request: MediaSearchRequest,
  rank?: Partial<RankContext>,
): Promise<MediaSearchResponse> {
  const wanted = request.providers?.length ? request.providers : (['pexels', 'pixabay', 'unsplash'] as StockProvider[]);
  const selected = providers.filter((p) => wanted.includes(p.name));
  const missingKeys = selected.filter((p) => !p.isConfigured()).map((p) => p.name);
  const active = selected.filter((p) => p.isConfigured());

  const errors: Record<string, string> = {};
  const settled = await Promise.all(
    active.map(async (provider) => {
      try {
        return await provider.search(request);
      } catch (error) {
        errors[provider.name] = error instanceof Error ? error.message : 'Search failed';
        return [];
      }
    }),
  );

  const items = rankItems(settled.flat(), {
    query: rank?.query ?? request.query,
    orientation: rank?.orientation ?? request.orientation ?? 'landscape',
    targetDuration: rank?.targetDuration ?? request.minDuration,
  });

  return {
    items,
    providers: active.map((p) => p.name),
    missingKeys,
    errors,
    query: request.query,
  };
}

/**
 * Runs several queries for one scene (AI usually emits 2–4 phrasings) and
 * returns a single ranked list. Falls back through the provider chain, so a
 * scene still gets footage when the first provider has nothing.
 */
export async function searchForScene(options: {
  queries: string[];
  orientation: RankContext['orientation'];
  targetDuration?: number;
  type?: 'video' | 'image' | 'all';
  perQuery?: number;
  providers?: StockProvider[];
}): Promise<MediaSearchResponse> {
  const queries = options.queries.filter(Boolean).slice(0, 4);
  if (queries.length === 0) {
    return { items: [], providers: [], missingKeys: [], errors: {}, query: '' };
  }
  const responses = await Promise.all(
    queries.map((query) =>
      searchStockMedia(
        {
          query,
          type: options.type ?? 'video',
          orientation: options.orientation,
          perPage: options.perQuery ?? 8,
          providers: options.providers,
        },
        { query: queries[0]!, orientation: options.orientation, targetDuration: options.targetDuration },
      ),
    ),
  );

  const merged = rankItems(
    responses.flatMap((r) => r.items),
    { query: queries.join(' '), orientation: options.orientation, targetDuration: options.targetDuration },
  );

  return {
    items: merged,
    providers: [...new Set(responses.flatMap((r) => r.providers))],
    missingKeys: [...new Set(responses.flatMap((r) => r.missingKeys))],
    errors: Object.assign({}, ...responses.map((r) => r.errors)),
    query: queries[0]!,
  };
}
