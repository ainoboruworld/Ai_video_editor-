/**
 * News articles as an editing resource.
 *
 * Stock footage answers "what should the viewer look at while I say this".
 * A news article answers a different question — "who says so" — and the answer
 * is a citation, not a picture. So an approved article becomes a graphic the
 * compositor draws: headline, publisher, date. Nothing is downloaded from the
 * publisher, because their photography is theirs.
 *
 * Like every other suggestion in this product, it proposes and never places.
 */
import type { Graphic } from '@/lib/engine';
import type { NewsArticle } from '@/types';
import type { TranscriptSegment } from '@/features/transcript/model';
import { GRAPHIC_ACCENTS } from './graphics';

export interface NewsCue {
  /** Where in the timeline the claim is made. */
  start: number;
  duration: number;
  /** What to search the news index for. */
  query: string;
  /** The sentence that prompted it, so the user can see why. */
  sentence: string;
}

/** Words that carry no topic and so make a useless search. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'can',
  'could', 'should', 'may', 'might', 'must', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her',
  'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
  'from', 'by', 'about', 'as', 'into', 'over', 'after', 'before', 'so', 'just', 'very', 'really', 'like',
  'know', 'think', 'going', 'get', 'got', 'one', 'lot', 'thing', 'things', 'people', 'time', 'way', 'because',
]);

/**
 * A sentence worth citing makes a checkable claim: it names a figure, a year,
 * a study, a company, or attributes something to someone. Opinion and narration
 * do not need a source, and offering one over every sentence would bury the
 * ones that matter.
 */
const CLAIM =
  /(?:\b\d[\d,.]*\s?%|\b(?:19|20)\d{2}\b|\$\s?\d|\b\d[\d,.]*\s?(?:billion|million|thousand|percent)\b|\b(?:study|studies|research|report|reported|survey|data|according to|announced|launched|acquired|raised|regulation|lawsuit|ruling|analysts?|forecast)\b)/i;

const MAX_CUES = 6;

/** The moments in a transcript where a citation would actually help. */
export function newsCuesFromTranscript(segments: TranscriptSegment[]): NewsCue[] {
  const cues: NewsCue[] = [];
  for (const segment of segments) {
    if (cues.length >= MAX_CUES) break;
    const text = segment.text.trim();
    if (text.length < 24) continue;
    if (!CLAIM.test(text)) continue;
    const query = searchQuery(text);
    if (!query) continue;
    cues.push({
      start: segment.start,
      duration: Math.max(3, Math.min(6, segment.end - segment.start + 1.5)),
      query,
      sentence: text,
    });
  }
  return cues;
}

/**
 * The three or four content words of a sentence, which is what a news index
 * can actually match. Proper nouns first: they are the part of a claim that
 * identifies it.
 */
export function searchQuery(sentence: string): string {
  const words = sentence.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);

  const proper = words
    .slice(1)
    .filter((word) => /^\p{Lu}/u.test(word) && !STOPWORDS.has(word.toLowerCase()))
    .slice(0, 3);

  const content = words
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word));

  // Deduped on the lowercase form: "Panasonic" and "panasonic" are one term,
  // and a query that repeats it just narrows the search for no reason.
  const chosen: string[] = [];
  const seen = new Set<string>();
  for (const word of proper.length >= 2 ? proper : [...proper, ...content]) {
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    chosen.push(word);
    if (chosen.length >= 4) break;
  }
  return chosen.join(' ').trim();
}

/** A short, readable date for the citation card. */
export function citationDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * An article as a graphic. The headline is the value because it is the thing
 * being asserted; the publisher and date are the label, because they are what
 * makes it a citation rather than a caption.
 */
export function citationGraphic(article: NewsArticle, accent = GRAPHIC_ACCENTS[4]!.value): Graphic {
  const date = citationDate(article.publishedAt);
  return {
    kind: 'citation',
    title: date ? `${article.source} · ${date}` : article.source,
    value: trim(article.title, 150),
    caption: article.domain,
    items: [],
    accent,
    position: 'left',
  };
}

function trim(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}
