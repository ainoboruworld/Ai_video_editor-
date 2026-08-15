import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handle, ok, parseQuery } from '@/lib/http';
import { orientationForAspect, searchStockMedia } from '@/lib/media';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  q: z.string().min(1).max(200),
  type: z.enum(['video', 'image', 'all']).optional(),
  orientation: z.enum(['landscape', 'portrait', 'square']).optional(),
  aspect: z.string().max(10).optional(),
  duration: z.coerce.number().min(0).max(600).optional(),
  page: z.coerce.number().int().min(1).max(50).optional(),
  perPage: z.coerce.number().int().min(1).max(40).optional(),
  providers: z.string().max(80).optional(),
});

/**
 * The browser never talks to Pexels/Pixabay/Unsplash directly — it calls this
 * route, which holds the API keys and merges + ranks the providers' results.
 */
export async function GET(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const params = parseQuery(request, querySchema);
    const orientation = params.orientation ?? (params.aspect ? orientationForAspect(params.aspect) : undefined);
    const providers = params.providers
      ?.split(',')
      .map((p) => p.trim())
      .filter((p): p is 'pexels' | 'pixabay' | 'unsplash' => ['pexels', 'pixabay', 'unsplash'].includes(p));

    const response = await searchStockMedia(
      {
        query: params.q,
        type: params.type ?? 'video',
        orientation,
        perPage: params.perPage ?? 16,
        page: params.page ?? 1,
        providers,
      },
      { query: params.q, orientation: orientation ?? 'landscape', targetDuration: params.duration },
    );

    return ok(response, {
      headers: { 'Cache-Control': 'private, max-age=120' },
    });
  });
}
