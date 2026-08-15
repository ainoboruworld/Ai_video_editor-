import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, withSessionCookie } from '@/lib/auth/session';
import { getStore } from '@/lib/database';
import { env } from '@/lib/env';
import { ApiError, handle, ok, parseBody } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

/** Job status polled by the export dialog. */
export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  return handle(async () => {
    const session = await getSession();
    const { id } = await params;
    const store = getStore();
    await store.init();
    const job = await store.getRenderJob(session.ownerId, id);
    if (!job) throw new ApiError(404, 'Render job not found', 'not_found');
    return withSessionCookie(ok({ job }), session);
  });
}

const patchSchema = z.object({
  status: z.enum(['queued', 'rendering', 'processing', 'complete', 'failed']).optional(),
  progress: z.number().min(0).max(1).optional(),
  message: z.string().max(300).optional(),
  outputUrl: z.string().max(2000).nullable().optional(),
  error: z.string().max(1000).nullable().optional(),
});

/**
 * Progress callback for the render worker. Authenticated with a shared secret,
 * not the user cookie, because the worker runs outside the browser session.
 */
export async function PATCH(request: Request, { params }: Params): Promise<NextResponse> {
  return handle(async () => {
    const { id } = await params;
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!env.RENDER_WORKER_TOKEN || token !== env.RENDER_WORKER_TOKEN) {
      throw new ApiError(401, 'Invalid worker token', 'unauthorized');
    }
    const patch = await parseBody(request, patchSchema);
    const store = getStore();
    await store.init();
    const job = await store.updateRenderJob(id, patch);
    if (!job) throw new ApiError(404, 'Render job not found', 'not_found');
    return ok({ job });
  });
}
