import 'server-only';
import { fetchWithTimeout } from '@/lib/http';
import { ApiError } from '@/lib/http';
import type { NewsArticle } from '@/types';

/**
 * News articles as an editing resource — metadata only.
 *
 * A talking head making a claim is more convincing with the source on screen,
 * and the source is a headline, a publisher and a date. That is what this
 * returns.
 *
 * It deliberately does **not** return the article's image. Publisher photography
 * is copyrighted and a stock-photo pipeline is the wrong place to launder it, so
 * the only thing that reaches the timeline is a citation the compositor draws
 * itself. Imagery still comes from Pexels, Pixabay and Unsplash, which license
 * it for this.
 *
 * GDELT's Document API is used because it is free, needs no key and no account,
 * and indexes the world's news in near real time — so this stays inside the
 * "usable at zero spend" rule that the rest of the product follows.
 */
const API = 'https://api.gdeltproject.org/api/v2/doc/doc';

interface GdeltArticle {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
}

export interface NewsSearchOptions {
  query: string;
  /** How many articles to return. */
  limit?: number;
  /** Only articles seen in the last N days. */
  sinceDays?: number;
  /** Restrict to one language, as GDELT names them ("english"). */
  language?: string;
}

/**
 * GDELT stamps articles `20240115T123000Z`, which is nearly ISO-8601 but not
 * quite. Anything unparseable becomes null rather than a wrong date — a citation
 * showing the wrong date is worse than one showing none.
 */
export function parseSeenDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const match = /^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?$/.exec(raw.trim());
  if (!match) return null;
  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Strips the publisher suffix news sites staple onto every headline.
 *
 * The tail after the last separator is compared to the domain with spaces and
 * punctuation removed, so "The Guardian" matches theguardian.com — and an
 * em-dash clause that happens to end a headline is left alone.
 */
export function cleanHeadline(title: string, domain: string): string {
  const text = title.replace(/\s+/g, ' ').trim();
  const at = Math.max(text.lastIndexOf(' | '), text.lastIndexOf(' - '), text.lastIndexOf(' – '));
  if (at <= 0) return text;

  const tail = squash(text.slice(at + 3));
  const site = squash(domain.replace(/^www\./, '').split('.')[0] ?? '');
  if (!tail || !site) return text;
  if (tail.includes(site) || site.includes(tail)) return text.slice(0, at).trim();
  return text;
}

/** Lowercase letters and digits only — how two names of one publisher line up. */
function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The publisher, as a reader would name it: "reuters.com" → "Reuters". */
export function publisherName(domain: string): string {
  const host = domain.replace(/^www\./, '');
  const label = host.split('.')[0] ?? host;
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1)))
    .join(' ');
}

/** Searches GDELT for one query and returns article metadata. */
export async function searchNews(options: NewsSearchOptions): Promise<NewsArticle[]> {
  const query = options.query.trim();
  if (query.length < 2) return [];

  const params = new URLSearchParams({
    // GDELT treats a bare multi-word query as OR; quoting keeps the phrase.
    query: query.includes(' ') ? `"${query}"` : query,
    mode: 'ArtList',
    format: 'json',
    maxrecords: String(Math.min(50, Math.max(1, options.limit ?? 10))),
    sort: 'hybridrel',
    timespan: `${Math.min(365, Math.max(1, options.sinceDays ?? 90))}d`,
  });
  if (options.language) params.set('sourcelang', options.language);

  const res = await fetchWithTimeout(`${API}?${params}`, { cache: 'no-store' });
  if (!res.ok) {
    throw new ApiError(502, `The news index could not be reached (${res.status}).`, 'news_search_failed');
  }

  // GDELT answers a query it does not like with plain text rather than JSON.
  const raw = await res.text();
  if (!raw.trim().startsWith('{')) return [];

  let body: { articles?: GdeltArticle[] };
  try {
    body = JSON.parse(raw) as { articles?: GdeltArticle[] };
  } catch {
    return [];
  }

  return (body.articles ?? []).flatMap((article): NewsArticle[] => {
    const url = article.url?.trim();
    const title = article.title?.trim();
    if (!url || !title) return [];
    const domain = (article.domain ?? safeHost(url)).replace(/^www\./, '');
    const headline = cleanHeadline(title, domain);
    if (headline.length < 12) return [];
    return [
      {
        id: `news-${hash(url)}`,
        title: headline,
        url,
        domain,
        source: publisherName(domain),
        publishedAt: parseSeenDate(article.seendate),
        language: article.language ?? null,
      },
    ];
  });
}

/** Runs several queries at once and merges them, one article per URL. */
export async function searchNewsForQueries(
  queries: string[],
  options: Omit<NewsSearchOptions, 'query'> = {},
): Promise<NewsArticle[]> {
  const wanted = queries.map((q) => q.trim()).filter(Boolean).slice(0, 6);
  if (wanted.length === 0) return [];

  const settled = await Promise.all(
    wanted.map(async (query) => {
      try {
        return await searchNews({ ...options, query });
      } catch {
        // One dead query never fails the rest of the search.
        return [];
      }
    }),
  );

  return dedupe(settled.flat());
}

/**
 * One article per URL, and at most two per publisher — a search that returns
 * six articles from one outlet is a worse resource than six outlets.
 */
export function dedupe(articles: NewsArticle[], perDomain = 2): NewsArticle[] {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  const out: NewsArticle[] = [];
  for (const article of articles) {
    const key = article.url.replace(/[?#].*$/, '');
    if (seen.has(key)) continue;
    const used = counts.get(article.domain) ?? 0;
    if (used >= perDomain) continue;
    seen.add(key);
    counts.set(article.domain, used + 1);
    out.push(article);
  }
  return out;
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

/** Stable short id from a URL, so the same article keeps the same key. */
function hash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
