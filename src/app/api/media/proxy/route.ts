import { NextResponse } from 'next/server';
import { fail } from '@/lib/http';
import { isAllowedMediaUrl } from '@/lib/media/proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Same-origin passthrough for stock provider CDNs.
 *
 * Two reasons this exists: the canvas compositor must stay CORS-clean so the
 * browser exporter can read frames back, and provider URLs can be swapped for
 * object-storage URLs later without touching the project document. Range
 * requests are forwarded so <video> can seek instead of downloading whole files.
 */
export async function GET(request: Request): Promise<NextResponse | Response> {
  const src = new URL(request.url).searchParams.get('src');
  if (!src) return fail(400, 'Missing src parameter', 'invalid_request');
  if (!isAllowedMediaUrl(src)) return fail(403, 'This media host is not allowed', 'host_not_allowed');

  const range = request.headers.get('range');
  const upstream = await fetch(src, {
    headers: range ? { Range: range } : undefined,
    cache: 'no-store',
  }).catch(() => null);

  if (!upstream || !upstream.ok) {
    return fail(upstream?.status === 404 ? 404 : 502, 'Could not fetch media from the provider', 'upstream_error');
  }

  const headers = new Headers();
  for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }
  headers.set('Cache-Control', 'public, max-age=86400, immutable');
  headers.set('Access-Control-Allow-Origin', '*');

  return new Response(upstream.body, { status: upstream.status, headers });
}
