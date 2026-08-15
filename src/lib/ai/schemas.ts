import { z } from 'zod';

/**
 * AI output is untrusted input. Every model response is parsed with these
 * schemas before it is allowed anywhere near a project document.
 */

export const brollQuerySchema = z.object({
  queries: z.array(z.string().min(2).max(120)).min(1).max(8),
});

export type BrollQueryPayload = z.infer<typeof brollQuerySchema>;

/** An edit plan for footage the user already has. */
export const editPlanSchema = z.object({
  summary: z.string().max(600).default(''),
  title: z.string().max(160).default(''),
  /** Segments of the source worth keeping, in source-time seconds. */
  keep: z
    .array(
      z.object({
        start: z.number().min(0),
        end: z.number().min(0),
        reason: z.string().max(200).default(''),
      }),
    )
    .max(200)
    .default([]),
  /** Segments to drop, with why — shown to the user before anything is cut. */
  remove: z
    .array(
      z.object({
        start: z.number().min(0),
        end: z.number().min(0),
        reason: z.string().max(200).default(''),
      }),
    )
    .max(200)
    .default([]),
  /** Moments where a cutaway would help, with a stock query for each. */
  brollCues: z
    .array(
      z.object({
        start: z.number().min(0),
        duration: z.number().min(0.5).max(30).default(3),
        query: z.string().min(2).max(120),
        reason: z.string().max(200).default(''),
      }),
    )
    .max(40)
    .default([]),
  /** Short on-screen titles to reinforce key points. */
  callouts: z
    .array(
      z.object({
        start: z.number().min(0),
        duration: z.number().min(0.5).max(20).default(2.5),
        text: z.string().min(1).max(80),
      }),
    )
    .max(40)
    .default([]),
});

export type EditPlanPayload = z.infer<typeof editPlanSchema>;
