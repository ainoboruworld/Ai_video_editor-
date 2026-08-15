import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, withSessionCookie } from '@/lib/auth/session';
import { getStore } from '@/lib/database';
import { loadOwnedProject } from '@/lib/database/projects';
import { env } from '@/lib/env';
import { ApiError, handle, ok, parseBody } from '@/lib/http';
import type { RenderJob } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  projectId: z.string().min(1).max(120),
  resolution: z.union([z.literal(720), z.literal(1080), z.literal(1440)]).default(1080),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).default(30),
  format: z.enum(['mp4', 'webm']).default('mp4'),
});

/**
 * Queues a cloud render.
 *
 * Vercel functions cannot run a multi-minute Remotion render, so this route
 * only creates the job and hands the project document to a render worker
 * (`RENDER_WORKER_URL` — see scripts/render-worker.mjs, deployable to any
 * container host or Remotion Lambda). The browser polls `/api/render/:id`.
 * Without a worker configured the editor uses the in-browser exporter instead,
 * and this route says so explicitly rather than faking progress.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const session = await getSession();
    const input = await parseBody(request, schema);
    const store = getStore();
    await store.init();
    const project = await loadOwnedProject(session.ownerId, input.projectId);

    if (!env.RENDER_WORKER_URL) {
      throw new ApiError(
        503,
        'Cloud rendering is not configured. Export in the browser, or set RENDER_WORKER_URL to a Remotion render worker.',
        'no_render_worker',
      );
    }

    const aspectRatio = project.width / project.height;
    const height = input.resolution;
    const width = Math.round((height * aspectRatio) / 2) * 2;

    const now = new Date().toISOString();
    const job: RenderJob = {
      id: `r_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`,
      projectId: project.id,
      ownerId: session.ownerId,
      status: 'queued',
      progress: 0,
      message: 'Queued',
      width,
      height,
      fps: input.fps,
      format: input.format,
      outputUrl: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    await store.createRenderJob(job);

    // Hand off to the worker. The worker reports progress back through
    // PATCH /api/render/:id using RENDER_WORKER_TOKEN.
    try {
      const res = await fetch(`${env.RENDER_WORKER_URL.replace(/\/$/, '')}/render`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(env.RENDER_WORKER_TOKEN ? { Authorization: `Bearer ${env.RENDER_WORKER_TOKEN}` } : {}),
        },
        body: JSON.stringify({
          jobId: job.id,
          callbackUrl: env.APP_URL ? `${env.APP_URL.replace(/\/$/, '')}/api/render/${job.id}` : null,
          width: job.width,
          height: job.height,
          fps: job.fps,
          format: job.format,
          project,
        }),
      });
      if (!res.ok) throw new Error(`Worker rejected the job (${res.status})`);
    } catch (error) {
      const failed = await store.updateRenderJob(job.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Could not reach the render worker',
      });
      return withSessionCookie(ok({ job: failed ?? job }, { status: 502 }), session);
    }

    return withSessionCookie(ok({ job }, { status: 202 }), session);
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const session = await getSession();
    const projectId = new URL(request.url).searchParams.get('projectId');
    if (!projectId) throw new ApiError(400, 'Missing projectId', 'invalid_request');
    const store = getStore();
    await store.init();
    const jobs = await store.listRenderJobs(session.ownerId, projectId);
    return withSessionCookie(ok({ jobs }), session);
  });
}
