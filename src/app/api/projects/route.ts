import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, withSessionCookie } from '@/lib/auth/session';
import { getStore } from '@/lib/database';
import { newProject } from '@/lib/database/projects';
import { handle, ok, parseBody } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1).max(160).default('Untitled project'),
  aspect: z.enum(['16:9', '9:16', '1:1', '4:5', '4:3']).default('9:16'),
  fps: z.number().min(1).max(120).default(30),
});

export async function GET(): Promise<NextResponse> {
  return handle(async () => {
    const session = await getSession();
    const store = getStore();
    await store.init();
    const projects = await store.list(session.ownerId);
    return withSessionCookie(ok({ projects }), session);
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const session = await getSession();
    const input = await parseBody(request, createSchema);
    const store = getStore();
    await store.init();
    const project = newProject({ ownerId: session.ownerId, ...input });
    await store.put(project);
    return withSessionCookie(ok({ project }, { status: 201 }), session);
  });
}
