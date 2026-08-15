import type { Orientation, StockMediaItem } from '@/types';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'and', 'or', 'is', 'are',
  'shot', 'video', 'footage', 'clip', 'scene', 'closeup', 'close', 'up', 'view', 'b-roll', 'broll',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

export interface RankContext {
  /** The scene description or search query the user is trying to satisfy. */
  query: string;
  /** Project orientation — vertical projects should prefer vertical footage. */
  orientation: Orientation;
  /** Scene duration in seconds; clips shorter than this need looping/stretching. */
  targetDuration?: number;
}

/**
 * Ranks stock results for a scene. Relevance dominates, then framing (a
 * landscape clip in a 9:16 project loses most of the frame), then duration
 * headroom, then resolution. Scores are normalised to 0..1 so the UI can show
 * a match indicator.
 */
export function scoreItem(item: StockMediaItem, ctx: RankContext): number {
  const queryTokens = tokenize(ctx.query);
  const itemTokens = new Set(tokenize(`${item.title}`));
  let overlap = 0;
  for (const token of queryTokens) {
    if (itemTokens.has(token)) overlap += 1;
    else if ([...itemTokens].some((t) => t.startsWith(token.slice(0, 4)))) overlap += 0.5;
  }
  const relevance = queryTokens.length === 0 ? 0.5 : Math.min(1, overlap / queryTokens.length);

  const framing =
    item.orientation === ctx.orientation ? 1 : item.orientation === 'square' || ctx.orientation === 'square' ? 0.6 : 0.25;

  let durationFit = 0.7;
  if (item.type === 'image') {
    durationFit = 0.8; // stills stretch to any duration
  } else if (item.duration != null && ctx.targetDuration != null) {
    const ratio = item.duration / Math.max(0.5, ctx.targetDuration);
    durationFit = ratio >= 1 ? Math.min(1, 0.75 + 0.25 / Math.max(1, ratio - 0.8)) : Math.max(0.2, ratio);
  }

  const pixels = item.width * item.height;
  const resolution = Math.max(0.2, Math.min(1, pixels / (1920 * 1080)));

  return round(relevance * 0.46 + framing * 0.28 + durationFit * 0.16 + resolution * 0.1);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function rankItems(items: StockMediaItem[], ctx: RankContext): StockMediaItem[] {
  const seen = new Set<string>();
  return items
    .map((item) => ({ ...item, score: scoreItem(item, ctx) }))
    .filter((item) => {
      // De-duplicate identical uploads that surface on multiple providers.
      const key = `${item.type}:${item.downloadUrl}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

export function orientationForAspect(aspect: string): Orientation {
  if (aspect === '9:16' || aspect === '4:5') return 'portrait';
  if (aspect === '1:1') return 'square';
  return 'landscape';
}

/**
 * Derives stock search queries from a plain-language visual description.
 * Used as the offline fallback for AI query generation and to expand any
 * AI-provided query into provider-friendly variants.
 */
export function deriveQueries(visual: string, limit = 4): string[] {
  const cleaned = visual.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const tokens = tokenize(cleaned);
  const out: string[] = [];
  const push = (q: string) => {
    const norm = q.trim().toLowerCase();
    if (norm.length > 2 && !out.includes(norm)) out.push(norm);
  };
  push(cleaned.toLowerCase().split(/[,.;]/)[0] ?? cleaned.toLowerCase());
  if (tokens.length >= 2) push(tokens.slice(0, 3).join(' '));
  if (tokens.length >= 2) push(`${tokens[0]} ${tokens[tokens.length - 1]}`);
  for (const token of tokens) push(token);
  return out.slice(0, limit);
}
