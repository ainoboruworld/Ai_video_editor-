import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateSuggestions } from '@/lib/ai';
import { ApiError, handle, ok, parseBody } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  summary: z.string().min(10).max(12_000),
});

/** Editing notes for the current timeline. Requires a configured AI provider. */
export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const { summary } = await parseBody(request, schema);
    const result = await generateSuggestions(summary);
    if (result.provider === 'offline') {
      throw new ApiError(
        503,
        'AI suggestions need an AI provider. Set OPENAI_API_KEY or GEMINI_API_KEY.',
        'no_ai_provider',
      );
    }
    return ok(result);
  });
}
