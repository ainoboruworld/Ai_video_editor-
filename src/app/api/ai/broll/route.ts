import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateBrollQueries } from '@/lib/ai';
import { handle, ok, parseBody } from '@/lib/http';
import { orientationForAspect, searchForScene } from '@/lib/media';
import type { StockMediaItem } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  aspect: z.enum(['16:9', '9:16', '1:1', '4:5', '4:3']).default('9:16'),
  perScene: z.number().int().min(1).max(12).default(6),
  type: z.enum(['video', 'image', 'all']).default('video'),
  providers: z.array(z.enum(['pexels', 'pixabay', 'unsplash'])).optional(),
  topic: z.string().max(400).optional(),
  scenes: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        visual: z.string().min(1).max(600),
        duration: z.number().min(0.2).max(600).default(4),
        queries: z.array(z.string().max(160)).max(6).optional(),
      }),
    )
    .min(1)
    .max(24),
});

export interface SceneRecommendation {
  sceneId: string;
  queries: string[];
  items: StockMediaItem[];
  error?: string;
}

/**
 * "Find B-roll" for one scene or every scene at once.
 *
 * Scene visual → search queries (AI when configured, derived locally otherwise)
 * → parallel provider search → ranked recommendations. Nothing is inserted into
 * the timeline here: the user approves the picks in the UI.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const input = await parseBody(request, schema);
    const orientation = orientationForAspect(input.aspect);
    const missingKeys = new Set<string>();
    const providersUsed = new Set<string>();

    const recommendations = await Promise.all(
      input.scenes.map(async (scene): Promise<SceneRecommendation> => {
        try {
          const queries =
            scene.queries && scene.queries.length > 0
              ? scene.queries
              : (await generateBrollQueries(scene.visual, input.topic)).queries;

          const result = await searchForScene({
            queries,
            orientation,
            targetDuration: scene.duration,
            type: input.type,
            perQuery: Math.max(4, input.perScene),
            providers: input.providers,
          });
          result.missingKeys.forEach((p) => missingKeys.add(p));
          result.providers.forEach((p) => providersUsed.add(p));

          return { sceneId: scene.id, queries, items: result.items.slice(0, input.perScene) };
        } catch (error) {
          return {
            sceneId: scene.id,
            queries: scene.queries ?? [],
            items: [],
            error: error instanceof Error ? error.message : 'B-roll search failed',
          };
        }
      }),
    );

    return ok({
      recommendations,
      providers: [...providersUsed],
      missingKeys: [...missingKeys],
    });
  });
}
