import 'server-only';
import { ASPECT_DIMENSIONS, makeSequence, type AspectRatio } from '@/lib/engine';
import { ApiError } from '@/lib/http';
import type { Project, ProjectSettings } from '@/types';
import { getStore } from './index';
import type { ProjectDocInput } from './schema';

export const DEFAULT_SETTINGS: ProjectSettings = {
  brollProviders: ['pexels', 'pixabay', 'unsplash'],
  captionStyle: 'bold',
  musicVolume: 0.18,
  voiceoverVolume: 1,
};

export function newProject(input: {
  ownerId: string;
  name: string;
  aspect: AspectRatio;
  fps?: number;
}): Project {
  const id = `p_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
  const { width, height } = ASPECT_DIMENSIONS[input.aspect];
  const now = new Date().toISOString();
  const sequence = makeSequence(`s_${id}`, input.name, input.aspect);
  return {
    id,
    ownerId: input.ownerId,
    name: input.name,
    aspect: input.aspect,
    width,
    height,
    fps: input.fps ?? 30,
    sequence: { ...sequence, fps: input.fps ?? 30 },
    assets: [],
    transcript: null,
    settings: { ...DEFAULT_SETTINGS },
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

/** Loads a project, enforcing ownership. Throws 404 for anything else's data. */
export async function loadOwnedProject(ownerId: string, projectId: string): Promise<Project> {
  const store = getStore();
  const project = await store.get(ownerId, projectId);
  if (!project) throw new ApiError(404, 'Project not found', 'not_found');
  return project;
}

/**
 * Merges a validated client document onto the stored project. The owner, id and
 * timestamps are server-controlled; the client can never change them.
 */
export function mergeProject(existing: Project, input: ProjectDocInput): Project {
  const { width, height } = ASPECT_DIMENSIONS[input.aspect];
  return {
    ...existing,
    name: input.name,
    aspect: input.aspect,
    width,
    height,
    fps: input.fps,
    // The zod schema is a boundary guard, not a structural clone of the engine
    // types (clips carry optional styling the schema passes through), so the
    // validated payload is re-cast to the engine model here.
    sequence: input.sequence as unknown as Project['sequence'],
    assets: input.assets as unknown as Project['assets'],
    transcript: (input.transcript ?? null) as unknown as Project['transcript'],
    settings: { ...DEFAULT_SETTINGS, ...existing.settings, ...(input.settings ?? {}) },
    updatedAt: new Date().toISOString(),
    version: existing.version + 1,
  };
}
