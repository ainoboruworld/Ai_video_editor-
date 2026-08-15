import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateTitles } from '@/lib/ai';
import { handle, ok, parseBody } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  topic: z.string().min(2).max(400),
  script: z.string().max(8000).default(''),
});

/** Titles, description and hashtags for the finished video. */
export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const input = await parseBody(request, schema);
    const result = await generateTitles(input.topic, input.script);
    return ok(result);
  });
}
