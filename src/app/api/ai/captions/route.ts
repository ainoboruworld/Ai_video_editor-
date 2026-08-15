import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateCaptionCues } from '@/lib/ai';
import { handle, ok, parseBody } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  segments: z
    .array(
      z.object({
        id: z.string().max(120),
        text: z.string().min(1).max(4000),
        start: z.number().min(0),
        duration: z.number().min(0.2).max(600),
      }),
    )
    .min(1)
    .max(40),
});

/** Turns scene narration into timed caption cues (no audio required). */
export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const { segments } = await parseBody(request, schema);
    const results = await Promise.all(
      segments.map(async (segment) => {
        const { cues, provider } = await generateCaptionCues(segment);
        return { id: segment.id, cues, provider };
      }),
    );
    return ok({ results });
  });
}
