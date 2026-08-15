import { getSession } from '@/lib/auth/session';
import { fail } from '@/lib/http';
import { contentTypeFor, getStorage } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reads an object back from the storage driver when no public CDN base is
 * configured. Access is scoped by the owner segment embedded in the key, so
 * one user's media is never readable by another.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }): Promise<Response> {
  const { key: segments } = await params;
  const key = segments.join('/');
  const session = await getSession();

  if (!key.startsWith(`u/${session.ownerId.replace(/[^\w-]+/g, '')}/`)) {
    return fail(403, 'Not your file', 'forbidden');
  }

  try {
    const object = await getStorage().get(key);
    if (!object) return fail(404, 'File not found', 'not_found');
    const body = new Uint8Array(object.body);
    return new Response(body, {
      headers: {
        'Content-Type': object.contentType || contentTypeFor(key),
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'private, max-age=31536000, immutable',
        'Accept-Ranges': 'none',
      },
    });
  } catch (error) {
    return fail(400, error instanceof Error ? error.message : 'Could not read file', 'read_failed');
  }
}
