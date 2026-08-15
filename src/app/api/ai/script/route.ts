import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateStoryboard } from '@/lib/ai';
import { handle, ok, parseBody } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  prompt: z.string().min(3).max(2000),
  durationSeconds: z.number().min(5).max(600).default(30),
  aspect: z.enum(['16:9', '9:16', '1:1', '4:5', '4:3']).default('9:16'),
  tone: z.string().max(80).optional(),
  language: z.string().max(20).optional(),
  sceneCount: z.number().int().min(2).max(20).optional(),
  provider: z
    .enum(['groq', 'openrouter', 'cloudflare', 'huggingface', 'ollama', 'gemini', 'openai', 'offline'])
    .optional(),

});

/** Prompt → hook, script, scene breakdown, on-screen text and B-roll queries. */
export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const input = await parseBody(request, schema);
    const storyboard = await generateStoryboard(input);
    return ok({ storyboard });
  });
}
