import 'server-only';
import { env } from '@/lib/env';
import { fetchWithTimeout } from '@/lib/http';
import type { MediaSearchRequest, StockMediaItem } from '@/types';
import { orientationOf, providerError, type MediaProvider } from './types';

const API = 'https://api.pexels.com';

interface PexelsVideoFile {
  id: number;
  quality: string | null;
  file_type: string;
  width: number | null;
  height: number | null;
  link: string;
}

interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  url: string;
  image: string;
  user: { name: string; url: string };
  video_files: PexelsVideoFile[];
}

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  alt: string | null;
  photographer: string;
  photographer_url: string;
  src: { original: string; large2x: string; large: string; medium: string; tiny: string };
}

/** Picks the highest-quality progressive MP4 that is not absurdly large. */
function pickVideoFile(files: PexelsVideoFile[]): PexelsVideoFile | null {
  const mp4 = files.filter((f) => f.file_type === 'video/mp4' && f.link);
  if (mp4.length === 0) return null;
  const scored = [...mp4].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  // Prefer <= 1920 wide: full-HD is plenty for editing previews and exports.
  return scored.find((f) => (f.width ?? 0) <= 1920) ?? scored[scored.length - 1] ?? null;
}

function pickPreview(files: PexelsVideoFile[]): string | null {
  const small = files
    .filter((f) => f.file_type === 'video/mp4' && (f.width ?? 0) > 0)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0];
  return small?.link ?? null;
}

export class PexelsProvider implements MediaProvider {
  readonly name = 'pexels' as const;
  readonly label = 'Pexels';

  isConfigured(): boolean {
    return Boolean(env.PEXELS_API_KEY);
  }

  async search(request: MediaSearchRequest): Promise<StockMediaItem[]> {
    const key = env.PEXELS_API_KEY;
    if (!key) return [];
    const type = request.type ?? 'video';
    const perPage = Math.min(40, Math.max(1, request.perPage ?? 12));
    const tasks: Promise<StockMediaItem[]>[] = [];
    if (type === 'video' || type === 'all') tasks.push(this.searchVideos(key, request, perPage));
    if (type === 'image' || type === 'all') tasks.push(this.searchPhotos(key, request, perPage));
    const results = await Promise.all(tasks);
    return results.flat();
  }

  private async searchVideos(key: string, request: MediaSearchRequest, perPage: number): Promise<StockMediaItem[]> {
    const params = new URLSearchParams({
      query: request.query,
      per_page: String(perPage),
      page: String(request.page ?? 1),
    });
    if (request.orientation) params.set('orientation', request.orientation);
    const res = await fetchWithTimeout(`${API}/videos/search?${params}`, {
      headers: { Authorization: key },
      cache: 'no-store',
    });
    if (!res.ok) throw providerError('Pexels', 'PEXELS_API_KEY', res.status, 'video search');
    const body = (await res.json()) as { videos?: PexelsVideo[] };
    return (body.videos ?? []).flatMap((video): StockMediaItem[] => {
      const file = pickVideoFile(video.video_files);
      if (!file) return [];
      return [
        {
          id: `pexels-video-${video.id}`,
          provider: 'pexels',
          type: 'video',
          title: video.url.split('/').filter(Boolean).pop()?.replace(/-\d+$/, '').replace(/-/g, ' ') ?? 'Pexels video',
          thumbnailUrl: video.image,
          previewUrl: pickPreview(video.video_files),
          downloadUrl: file.link,
          width: file.width ?? video.width,
          height: file.height ?? video.height,
          duration: video.duration,
          orientation: orientationOf(file.width ?? video.width, file.height ?? video.height),
          creator: video.user?.name ?? null,
          creatorUrl: video.user?.url ?? null,
          sourceUrl: video.url,
          license: 'Pexels License — free to use, attribution appreciated',
        },
      ];
    });
  }

  private async searchPhotos(key: string, request: MediaSearchRequest, perPage: number): Promise<StockMediaItem[]> {
    const params = new URLSearchParams({
      query: request.query,
      per_page: String(perPage),
      page: String(request.page ?? 1),
    });
    if (request.orientation) params.set('orientation', request.orientation);
    const res = await fetchWithTimeout(`${API}/v1/search?${params}`, {
      headers: { Authorization: key },
      cache: 'no-store',
    });
    if (!res.ok) throw providerError('Pexels', 'PEXELS_API_KEY', res.status, 'photo search');
    const body = (await res.json()) as { photos?: PexelsPhoto[] };
    return (body.photos ?? []).map((photo) => ({
      id: `pexels-photo-${photo.id}`,
      provider: 'pexels' as const,
      type: 'image' as const,
      title: photo.alt || 'Pexels photo',
      thumbnailUrl: photo.src.medium,
      previewUrl: null,
      downloadUrl: photo.src.large2x || photo.src.original,
      width: photo.width,
      height: photo.height,
      duration: null,
      orientation: orientationOf(photo.width, photo.height),
      creator: photo.photographer,
      creatorUrl: photo.photographer_url,
      sourceUrl: photo.url,
      license: 'Pexels License — free to use, attribution appreciated',
    }));
  }
}
