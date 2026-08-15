'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiClientError } from '@/lib/api-client';
import type { MediaSearchResponse, StockMediaItem } from '@/types';

interface Options {
  aspect: string;
  type?: 'video' | 'image' | 'all';
  duration?: number;
  /** Debounce window; searches never fire per keystroke. */
  debounceMs?: number;
}

interface SearchState {
  query: string;
  setQuery: (query: string) => void;
  items: StockMediaItem[];
  loading: boolean;
  error: string | null;
  missingKeys: string[];
  providers: string[];
  loadMore: () => void;
  hasMore: boolean;
  search: (query: string) => void;
}

/**
 * Debounced, cancellable stock search with a small in-memory cache so switching
 * scenes back and forth does not re-hit the provider APIs.
 */
export function useMediaSearch(options: Options): SearchState {
  const { aspect, type = 'video', duration, debounceMs = 450 } = options;
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<StockMediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingKeys, setMissingKeys] = useState<string[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const cache = useRef(new Map<string, MediaSearchResponse>());
  const requestId = useRef(0);

  const run = useCallback(
    async (searchQuery: string, nextPage: number) => {
      const trimmed = searchQuery.trim();
      if (trimmed.length < 2) {
        setItems([]);
        setError(null);
        setHasMore(false);
        return;
      }
      const cacheKey = `${trimmed}|${type}|${aspect}|${nextPage}`;
      const id = ++requestId.current;
      setLoading(true);
      setError(null);

      try {
        const cached = cache.current.get(cacheKey);
        const response = cached ?? (await api.searchMedia({ q: trimmed, type, aspect, duration, page: nextPage, perPage: 18 }));
        if (!cached) cache.current.set(cacheKey, response);
        if (id !== requestId.current) return;

        setItems((previous) => (nextPage === 1 ? response.items : [...previous, ...response.items]));
        setProviders(response.providers);
        setMissingKeys(response.missingKeys);
        setHasMore(response.items.length >= 12);
        if (response.providers.length === 0) {
          setError(
            response.missingKeys.length > 0
              ? 'No stock provider is configured. Add PEXELS_API_KEY (free) to search B-roll.'
              : 'No provider returned results.',
          );
        } else if (response.items.length === 0) {
          setError(`No results for “${trimmed}”. Try a simpler, more visual phrase.`);
        }
      } catch (caught) {
        if (id !== requestId.current) return;
        setError(caught instanceof ApiClientError ? caught.message : 'Search failed');
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [aspect, duration, type],
  );

  useEffect(() => {
    const handle = setTimeout(() => {
      setPage(1);
      void run(query, 1);
    }, debounceMs);
    return () => clearTimeout(handle);
  }, [query, run, debounceMs]);

  return {
    query,
    setQuery,
    items,
    loading,
    error,
    missingKeys,
    providers,
    hasMore,
    loadMore: () => {
      const next = page + 1;
      setPage(next);
      void run(query, next);
    },
    search: (value: string) => {
      setQuery(value);
      setPage(1);
      void run(value, 1);
    },
  };
}
