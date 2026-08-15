import 'server-only';
import { env } from '@/lib/env';
import { fetchWithTimeout } from '@/lib/http';
import type { MediaSearchRequest, StockMediaItem } from '@/types';
import { orientationOf, providerError, type MediaProvider } from './types';

const API = 'https://pixabay.com/api';

interface PixabayVideoStream {
  url: string;
  width: number;
  height: number;
  size: number;
  thumbnail?: string;
}

interface PixabayVideo {
  id: number;
  pageURL: string;
  duration: number;
  tags: string;
  user: string;
  userImageURL: string;
  videos: Record<string, PixabayVideoStream>;
}

interface PixabayImage {
  id: number;
  pageURL: string;
  tags: string;
  user: string;
  webformatURL: string;
  largeImageURL: string;
  previewURL: string;
  imageWidth: number;
  imageHeight: number;
}

export class PixabayProvider implements MediaProvider {
  readonly name = 'pixabay' as const;
  readonly label = 'Pixabay';

  isConfigured(): boolean {
    return Boolean(env.PIXABAY_API_KEY);
  }

  async search(request: MediaSearchRequest): Promise<StockMediaItem[]> {
    const key = env.PIXABAY_API_KEY;
    if (!key) return [];
    const type = request.type ?? 'video';
    const perPage = Math.min(50, Math.max(3, request.perPage ?? 12));
    const tasks: Promise<StockMediaItem[]>[] = [];
    if (type === 'video' || type === 'all') tasks.push(this.searchVideos(key, request, perPage));
    if (type === 'image' || type === 'all') tasks.push(this.searchImages(key, request, perPage));
    const results = await Promise.all(tasks);
    return results.flat();
  }

  private async searchVideos(key: string, request: MediaSearchRequest, perPage: number): Promise<StockMediaItem[]> {
    const params = new URLSearchParams({
      key,
      q: request.query,
      per_page: String(perPage),
      page: String(request.page ?? 1),
      safesearch: 'true',
    });
    const res = await fetchWithTimeout(`${API}/videos/?${params}`, { cache: 'no-store' });
    if (!res.ok) throw providerError('Pixabay', 'PIXABAY_API_KEY', res.status, 'video search');
    const body = (await res.json()) as { hits?: PixabayVideo[] };
    return (body.hits ?? []).flatMap((hit): StockMediaItem[] => {
      const streams = Object.values(hit.videos ?? {}).filter((s) => s?.url);
      if (streams.length === 0) return [];
      const sorted = [...streams].sort((a, b) => b.width - a.width);
      const best = sorted.find((s) => s.width <= 1920) ?? sorted[sorted.length - 1]!;
      const smallest = sorted[sorted.length - 1]!;
      const thumb =
        best.thumbnail ??
        smallest.thumbnail ??
        `https://i.vimeocdn.com/video/${hit.id}_295x166.jpg`;
      return [
        {
          id: `pixabay-video-${hit.id}`,
          provider: 'pixabay',
          type: 'video',
          title: hit.tags || 'Pixabay video',
          thumbnailUrl: thumb,
          previewUrl: smallest.url,
          downloadUrl: best.url,
          width: best.width,
          height: best.height,
          duration: hit.duration,
          orientation: orientationOf(best.width, best.height),
          creator: hit.user,
          creatorUrl: `https://pixabay.com/users/${encodeURIComponent(hit.user)}/`,
          sourceUrl: hit.pageURL,
          license: 'Pixabay Content License — free to use',
        },
      ];
    });
  }

  private async searchImages(key: string, request: MediaSearchRequest, perPage: number): Promise<StockMediaItem[]> {
    const params = new URLSearchParams({
      key,
      q: request.query,
      per_page: String(perPage),
      page: String(request.page ?? 1),
      image_type: 'photo',
      safesearch: 'true',
    });
    if (request.orientation === 'landscape') params.set('orientation', 'horizontal');
    if (request.orientation === 'portrait') params.set('orientation', 'vertical');
    const res = await fetchWithTimeout(`${API}/?${params}`, { cache: 'no-store' });
    if (!res.ok) throw providerError('Pixabay', 'PIXABAY_API_KEY', res.status, 'image search');
    const body = (await res.json()) as { hits?: PixabayImage[] };
    return (body.hits ?? []).map((hit) => ({
      id: `pixabay-image-${hit.id}`,
      provider: 'pixabay' as const,
      type: 'image' as const,
      title: hit.tags || 'Pixabay image',
      thumbnailUrl: hit.webformatURL || hit.previewURL,
      previewUrl: null,
      downloadUrl: hit.largeImageURL || hit.webformatURL,
      width: hit.imageWidth,
      height: hit.imageHeight,
      duration: null,
      orientation: orientationOf(hit.imageWidth, hit.imageHeight),
      creator: hit.user,
      creatorUrl: `https://pixabay.com/users/${encodeURIComponent(hit.user)}/`,
      sourceUrl: hit.pageURL,
      license: 'Pixabay Content License — free to use',
    }));
  }
}
