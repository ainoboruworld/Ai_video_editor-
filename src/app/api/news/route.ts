import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handle, ok, parseBody } from '@/lib/http';
import { searchNewsForQueries } from '@/lib/news/gdelt';
import type { NewsArticle } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const schema = z.object({
  cues: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        query: z.string().min(2).max(200),
      }),
    )
    .min(1)
    .max(8),
  perCue: z.number().int().min(1).max(10).default(4),
  sinceDays: z.number().int().min(1).max(365).default(180),
});

export interface NewsRecommendation {
  cueId: string;
  query: string;
  articles: NewsArticle[];
}

/**
 * Finds news articles that could be cited over what the speaker said.
 *
 * The browser does not call the news index itself, for the same reason it does
 * not call the stock providers: one place to hold the outbound call is one
 * place to keep it honest. Only metadata comes back — headline, publisher,
 * date, link — and the timeline gets a citation the compositor draws.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return handle(async () => {
    const input = await parseBody(request, schema);

    const recommendations = await Promise.all(
      input.cues.map(async (cue): Promise<NewsRecommendation> => {
        const articles = await searchNewsForQueries([cue.query], {
          limit: input.perCue * 3,
          sinceDays: input.sinceDays,
        });
        return { cueId: cue.id, query: cue.query, articles: articles.slice(0, input.perCue) };
      }),
    );

    return ok({ recommendations });
  });
}
