import { NextResponse } from 'next/server';
import { getSession, withSessionCookie } from '@/lib/auth/session';
import { ApiError, handle, ok } from '@/lib/http';
import { assertSafeKey, getStorage } from '@/lib/storage';
import { ACCEPTED_TYPES, MAX_PROXY_UPLOAD_BYTES } from '@/lib/storage/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Fallback upload path used only when object storage is not configured (local
 * development). Size is capped hard because serverless request bodies are
 * limited — the presigned direct-to-storage path in `/api/upload/sign` is the
 * one that carries real media.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const session = await getSession();
    const key = new URL(request.url).searchParams.get('key');
    if (!key) throw new ApiError(400, 'Missing key', 'invalid_request');
    assertSafeKey(key);

    // The key embeds the owner id at upload-ticket time; re-check it so one
    // user can never write into another user's namespace.
    if (!key.startsWith(`u/${session.ownerId.replace(/[^\w-]+/g, '')}/`)) {
      throw new ApiError(403, 'This upload key does not belong to you', 'forbidden');
    }

    const contentType = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!ACCEPTED_TYPES[contentType]) {
      throw new ApiError(415, `Unsupported file type: ${contentType || 'unknown'}`, 'unsupported_type');
    }

    const buffer = new Uint8Array(await request.arrayBuffer());
    if (buffer.byteLength === 0) throw new ApiError(400, 'Empty upload', 'empty_upload');
    if (buffer.byteLength > MAX_PROXY_UPLOAD_BYTES) {
      throw new ApiError(413, 'File is too large for the serverless upload path', 'too_large');
    }

    const stored = await getStorage().put(key, buffer, contentType);
    return withSessionCookie(ok({ key: stored.key, url: stored.url, sizeBytes: buffer.byteLength }), session);
  });
}
