import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, withSessionCookie } from '@/lib/auth/session';
import { getStore } from '@/lib/database';
import { loadOwnedProject, mergeProject, newProject } from '@/lib/database/projects';
import { projectDocSchema } from '@/lib/database/schema';
import { ApiError, handle, ok, parseBody } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  return handle(async () => {
    const session = await getSession();
    const { id } = await params;
    const store = getStore();
    await store.init();
    const project = await loadOwnedProject(session.ownerId, id);
    return withSessionCookie(ok({ project }), session);
  });
}

/** Full save. `version` enables optimistic concurrency across two open tabs. */
export async function PUT(request: Request, { params }: Params): Promise<NextResponse> {
  return handle(async () => {
    const session = await getSession();
    const { id } = await params;
    const input = await parseBody(request, projectDocSchema);
    const store = getStore();
    await store.init();

    const existing = await store.get(session.ownerId, id);
    if (!existing) {
      // The store lost the row (ephemeral driver / new device) but the browser
      // still holds the document — recreate it under the same id rather than
      // throwing the user's work away.
      const recreated = mergeProject({ ...newProject({ ownerId: session.ownerId, name: input.name, aspect: input.aspect, fps: input.fps }), id }, input);
      await store.put(recreated);
      return withSessionCookie(ok({ project: recreated, recreated: true }), session);
    }

    if (typeof input.version === 'number' && input.version < existing.version) {
      throw new ApiError(409, 'This project was changed in another tab. Reload to continue.', 'version_conflict', {
        serverVersion: existing.version,
      });
    }

    const merged = mergeProject(existing, input);
    await store.put(merged);
    return withSessionCookie(ok({ project: merged }), session);
  });
}

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  action: z.enum(['duplicate']).optional(),
});

/** Rename, or duplicate into a new project. */
export async function PATCH(request: Request, { params }: Params): Promise<NextResponse> {
  return handle(async () => {
    const session = await getSession();
    const { id } = await params;
    const input = await parseBody(request, patchSchema);
    const store = getStore();
    await store.init();
    const project = await loadOwnedProject(session.ownerId, id);

    if (input.action === 'duplicate') {
      const copy = {
        ...newProject({ ownerId: session.ownerId, name: `${project.name} copy`, aspect: project.aspect, fps: project.fps }),
        sequence: project.sequence,
        assets: project.assets,
        storyboard: project.storyboard,
        settings: project.settings,
      };
      await store.put(copy);
      return withSessionCookie(ok({ project: copy }, { status: 201 }), session);
    }

    const renamed = {
      ...project,
      name: input.name ?? project.name,
      sequence: { ...project.sequence, name: input.name ?? project.sequence.name },
      updatedAt: new Date().toISOString(),
      version: project.version + 1,
    };
    await store.put(renamed);
    return withSessionCookie(ok({ project: renamed }), session);
  });
}

export async function DELETE(_request: Request, { params }: Params): Promise<NextResponse> {
  return handle(async () => {
    const session = await getSession();
    const { id } = await params;
    const store = getStore();
    await store.init();
    await store.remove(session.ownerId, id);
    return withSessionCookie(ok({ deleted: true }), session);
  });
}
