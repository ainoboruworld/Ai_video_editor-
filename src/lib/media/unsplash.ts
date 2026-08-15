import 'server-only';
import { env } from '@/lib/env';
import { fetchWithTimeout } from '@/lib/http';
import type { MediaSearchRequest, StockMediaItem } from '@/types';
import { orientationOf, type MediaProvider } from './types';

const API = 'https://api.unsplash.com';

interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  description: string | null;
  alt_description: string | null;
  urls: { raw: string; full: string; regular: string; small: string; thumb: string };
  links: { html: string; download_location: string };
  user: { name: string; username: string; links: { html: string } };
}

/**
 * Unsplash provides still images only — used for photo B-roll, backgrounds and
 * poster frames. Attribution (photographer + Unsplash) is mandatory under their
 * API terms, so `creator`/`sourceUrl` are always populated.
 */
export class UnsplashProvider implements MediaProvider {
  readonly name = 'unsplash' as const;
  readonly label = 'Unsplash';

  isConfigured(): boolean {
    return Boolean(env.UNSPLASH_ACCESS_KEY);
  }

  async search(request: MediaSearchRequest): Promise<StockMediaItem[]> {
    const key = env.UNSPLASH_ACCESS_KEY;
    if (!key) return [];
    if (request.type === 'video') return []; // Unsplash has no video library
    const params = new URLSearchParams({
      query: request.query,
      per_page: String(Math.min(30, Math.max(1, request.perPage ?? 12))),
      page: String(request.page ?? 1),
      content_filter: 'high',
    });
    if (request.orientation) {
      params.set('orientation', request.orientation === 'square' ? 'squarish' : request.orientation);
    }
    const res = await fetchWithTimeout(`${API}/search/photos?${params}`, {
      headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Unsplash search failed (${res.status})`);
    const body = (await res.json()) as { results?: UnsplashPhoto[] };
    return (body.results ?? []).map((photo) => ({
      id: `unsplash-${photo.id}`,
      provider: 'unsplash' as const,
      type: 'image' as const,
      title: photo.description || photo.alt_description || 'Unsplash photo',
      thumbnailUrl: photo.urls.small,
      previewUrl: null,
      downloadUrl: photo.urls.regular,
      width: photo.width,
      height: photo.height,
      duration: null,
      orientation: orientationOf(photo.width, photo.height),
      creator: photo.user?.name ?? null,
      creatorUrl: photo.user?.links?.html ?? null,
      sourceUrl: photo.links?.html ?? `https://unsplash.com/photos/${photo.id}`,
      license: 'Unsplash License — free to use, attribution required by API terms',
    }));
  }
}

/**
 * Unsplash asks API clients to ping the download endpoint when a photo is
 * actually used. Fire-and-forget: a failure here must never break an edit.
 */
export async function trackUnsplashDownload(photoId: string): Promise<void> {
  const key = env.UNSPLASH_ACCESS_KEY;
  if (!key) return;
  try {
    await fetchWithTimeout(
      `${API}/photos/${encodeURIComponent(photoId)}/download`,
      { headers: { Authorization: `Client-ID ${key}` }, cache: 'no-store' },
      5000,
    );
  } catch {
    // Non-fatal by design.
  }
}
