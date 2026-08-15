import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, withSessionCookie } from '@/lib/auth/session';
import { ApiError, handle, ok, parseBody } from '@/lib/http';
import { buildKey, getStorage } from '@/lib/storage';
import { ACCEPTED_TYPES, MAX_PROXY_UPLOAD_BYTES, MAX_UPLOAD_BYTES } from '@/lib/storage/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const signSchema = z.object({
  projectId: z.string().min(1).max(120),
  filename: z.string().min(1).max(300),
  contentType: z.string().min(1).max(120),
  sizeBytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
});

/**
 * Issues an upload ticket. With object storage configured the browser uploads
 * straight to the bucket (a presigned PUT), so large media never travels
 * through a serverless function — which is exactly what Vercel's request size
 * and duration limits require.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const session = await getSession();
    const input = await parseBody(request, signSchema);

    const kind = ACCEPTED_TYPES[input.contentType.toLowerCase()];
    if (!kind) {
      throw new ApiError(415, `Unsupported file type: ${input.contentType}`, 'unsupported_type');
    }

    const storage = getStorage();
    if (!storage.directUpload && input.sizeBytes > MAX_PROXY_UPLOAD_BYTES) {
      throw new ApiError(
        413,
        'Files over 4 MB need object storage. Set STORAGE_URL / STORAGE_BUCKET / STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY, or keep the file local to this browser session.',
        'storage_required',
      );
    }

    const key = buildKey({ ownerId: session.ownerId, projectId: input.projectId, filename: input.filename });
    const ticket = await storage.createUploadTicket({ key, contentType: input.contentType, sizeBytes: input.sizeBytes });

    return withSessionCookie(ok({ ticket, kind }), session);
  });
}
