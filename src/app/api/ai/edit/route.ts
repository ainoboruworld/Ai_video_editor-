import { NextResponse } from 'next/server';
import { z } from 'zod';
import { activeProvider, describeAiError } from '@/lib/ai';
import { EDIT_PLAN_SCHEMA_HINT, EDIT_PLAN_SYSTEM, editPlanPrompt } from '@/lib/ai/prompts';
import { editPlanSchema } from '@/lib/ai/schemas';
import { ApiError, handle, ok, parseBody } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  durationSeconds: z.number().min(1).max(60 * 60 * 4),
  targetSeconds: z.number().min(5).max(60 * 60).optional(),
  goal: z.string().max(400).optional(),
  cues: z
    .array(z.object({ start: z.number().min(0), end: z.number().min(0), text: z.string().max(600) }))
    .min(1)
    .max(1200),
});

/**
 * Produces an edit plan for footage the user already recorded.
 *
 * The model only ever sees the transcript and is asked which parts to keep — it
 * cannot invent footage. Every timestamp it returns is validated and clamped to
 * the real duration before the client turns it into editor commands.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const input = await parseBody(request, schema);
    const provider = activeProvider();
    if (!provider) {
      throw new ApiError(
        503,
        'AI editing needs an AI provider. Set a free GEMINI_API_KEY or GROQ_API_KEY — silence and filler-word cutting still work without one.',
        'no_ai_provider',
      );
    }

    const transcript = input.cues
      .map((cue) => `[${cue.start.toFixed(1)}-${cue.end.toFixed(1)}] ${cue.text}`)
      .join('\n')
      .slice(0, 24_000);

    let raw: unknown;
    try {
      raw = await provider.generateJson({
        system: EDIT_PLAN_SYSTEM,
        prompt: editPlanPrompt({
          transcript,
          durationSeconds: input.durationSeconds,
          targetSeconds: input.targetSeconds,
          goal: input.goal,
        }),
        schemaHint: EDIT_PLAN_SCHEMA_HINT,
        temperature: 0.4,
        maxTokens: 3000,
      });
    } catch (error) {
      throw new ApiError(502, describeAiError(error), 'ai_failed');
    }

    const plan = editPlanSchema.parse(raw);

    // Clamp everything to the real footage: a hallucinated timestamp must never
    // reach the timeline.
    const limit = input.durationSeconds;
    const clamp = (value: number) => Math.max(0, Math.min(limit, value));
    const cleaned = {
      ...plan,
      keep: plan.keep
        .map((segment) => ({ ...segment, start: clamp(segment.start), end: clamp(segment.end) }))
        .filter((segment) => segment.end - segment.start > 0.2)
        .sort((a, b) => a.start - b.start),
      brollCues: plan.brollCues
        .map((cue) => ({ ...cue, start: clamp(cue.start) }))
        .filter((cue) => cue.start < limit),
      callouts: plan.callouts
        .map((callout) => ({ ...callout, start: clamp(callout.start) }))
        .filter((callout) => callout.start < limit),
    };

    return ok({ plan: cleaned, provider: provider.name });
  });
}
