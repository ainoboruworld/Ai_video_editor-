import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, withSessionCookie } from '@/lib/auth/session';
import { handle, ok, parseBody } from '@/lib/http';
import { trackUnsplashDownload } from '@/lib/media';
import { isAllowedMediaUrl, proxiedMediaUrl } from '@/lib/media/proxy';
import { getStorage, buildKey } from '@/lib/storage';
import type { Asset } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const importSchema = z.object({
  projectId: z.string().min(1).max(120),
  item: z.object({
    id: z.string().min(1).max(160),
    provider: z.enum(['pexels', 'pixabay', 'unsplash']),
    type: z.enum(['video', 'image']),
    title: z.string().max(300),
    thumbnailUrl: z.string().url(),
    downloadUrl: z.string().url(),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    duration: z.number().min(0).nullable(),
    creator: z.string().max(200).nullable(),
    creatorUrl: z.string().max(1000).nullable(),
    sourceUrl: z.string().max(1000),
    license: z.string().max(300),
  }),
  /** Copy the file into our own object storage (needed for cloud rendering). */
  persist: z.boolean().default(false),
});

const MAX_IMPORT_BYTES = 120 * 1024 * 1024;

const PROVIDER_LABELS: Record<'pexels' | 'pixabay' | 'unsplash', string> = {
  pexels: 'Pexels',
  pixabay: 'Pixabay',
  unsplash: 'Unsplash',
};

/**
 * Turns a stock search result into a project asset.
 *
 * By default the file is streamed through our media proxy (fast, no storage
 * required, CORS-clean for the browser exporter). With `persist: true` and
 * object storage configured, the file is copied into the bucket so a cloud
 * render worker can read it long after the provider URL expires.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const session = await getSession();
    const { item, projectId, persist } = await parseBody(request, importSchema);

    if (!isAllowedMediaUrl(item.downloadUrl)) {
      return withSessionCookie(ok({ error: 'Unsupported media host' }, { status: 400 }), session);
    }

    const credit = {
      provider: item.provider,
      providerLabel: PROVIDER_LABELS[item.provider],
      creator: item.creator,
      creatorUrl: item.creatorUrl,
      sourceUrl: item.sourceUrl,
      license: item.license,
    };

    let url = proxiedMediaUrl(item.downloadUrl);
    let storageKey: string | null = null;
    let sizeBytes: number | null = null;

    const storage = getStorage();
    if (persist && storage.durable) {
      const res = await fetch(item.downloadUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Provider download failed (${res.status})`);
      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared > MAX_IMPORT_BYTES) throw new Error('File is too large to import');
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > MAX_IMPORT_BYTES) throw new Error('File is too large to import');
      const ext = item.type === 'video' ? 'mp4' : 'jpg';
      const key = buildKey({ ownerId: session.ownerId, projectId, filename: `${item.provider}-${item.id}.${ext}` });
      const stored = await storage.put(key, bytes, item.type === 'video' ? 'video/mp4' : 'image/jpeg');
      url = stored.url;
      storageKey = stored.key;
      sizeBytes = bytes.byteLength;
    }

    if (item.provider === 'unsplash') {
      // Required by the Unsplash API guidelines when a photo is used.
      void trackUnsplashDownload(item.id.replace(/^unsplash-/, ''));
    }

    const asset: Asset = {
      id: `a_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`,
      kind: item.type === 'video' ? 'video' : 'image',
      name: item.title || `${PROVIDER_LABELS[item.provider]} ${item.type}`,
      url,
      thumbnailUrl: proxiedMediaUrl(item.thumbnailUrl),
      duration: item.duration,
      width: item.width,
      height: item.height,
      sizeBytes,
      mimeType: item.type === 'video' ? 'video/mp4' : 'image/jpeg',
      origin: 'stock',
      storageKey,
      credit,
      createdAt: new Date().toISOString(),
    };

    return withSessionCookie(ok({ asset }), session);
  });
}
