/**
 * Infographics from what was said.
 *
 * A talking head that says "we grew from five people to fifty in three years"
 * is describing a number the viewer cannot see. This finds those moments in the
 * transcript and proposes a graphic for each — a stat, a list or a pull-quote —
 * timed to the sentence that motivates it.
 *
 * It proposes; it never places. A graphic over a sentence that did not need one
 * is the same kind of clutter as B-roll over an abstract point, and the
 * detection here is deliberately narrow: a concrete figure, an explicit
 * enumeration, or a sentence the speaker themselves framed as the takeaway.
 */
import type { Graphic } from '@/lib/engine';
import type { TranscriptSegment } from '@/features/transcript/model';

export interface GraphicSuggestion {
  id: string;
  /** Where the sentence that motivates it starts. */
  start: number;
  duration: number;
  /** The sentence itself, so the user can see what prompted this. */
  source: string;
  graphic: Graphic;
}

/** Accent colours offered in the picker and cycled through for suggestions. */
export const GRAPHIC_ACCENTS = [
  { name: 'Violet', value: '#7c5cff' },
  { name: 'Emerald', value: '#34d399' },
  { name: 'Amber', value: '#f5b544' },
  { name: 'Rose', value: '#fb7185' },
  { name: 'Sky', value: '#38bdf8' },
  { name: 'White', value: '#ffffff' },
];

/** A percentage, a money figure, a multiplier, or a plain number with a unit. */
const FIGURE =
  /(?:^|\s)([£$€]\s?\d[\d,.]*\s?(?:k|m|bn|billion|million|thousand)?|\d[\d,.]*\s?%|\d[\d,.]*\s?x\b|\d[\d,.]*\s?(?:people|users|customers|hours|days|weeks|months|years|times)\b)/i;
/** "three things", "two reasons", "the first is…" */
const ENUMERATION = /\b(?:two|three|four|five|\d+)\s+(?:things|reasons|steps|ways|points|lessons|rules|tips)\b/i;
/** The speaker flagging their own takeaway. */
const TAKEAWAY = /\b(?:the (?:key|main|whole) (?:point|thing|idea)|what matters is|the takeaway|remember this)\b/i;

const MIN_SECONDS = 2.2;
const MAX_SUGGESTIONS = 6;

/** Graphics worth offering for a transcript, in timeline order. */
export function suggestGraphics(segments: TranscriptSegment[]): GraphicSuggestion[] {
  const out: GraphicSuggestion[] = [];

  for (const [index, segment] of segments.entries()) {
    if (out.length >= MAX_SUGGESTIONS) break;
    const text = segment.text.trim();
    if (text.length < 12) continue;

    const accent = GRAPHIC_ACCENTS[out.length % GRAPHIC_ACCENTS.length]!.value;
    const duration = Math.max(MIN_SECONDS, Math.min(5, segment.end - segment.start + 1.2));
    const base = { id: `gfx_${segment.id}`, start: segment.start, duration, source: text };

    const figure = FIGURE.exec(text);
    if (figure) {
      out.push({
        ...base,
        graphic: {
          kind: 'stat',
          title: subjectOf(text),
          value: figure[1]!.trim(),
          caption: trim(withoutFigure(text, figure[1]!), 90),
          items: [],
          accent,
          position: 'left',
        },
      });
      continue;
    }

    if (ENUMERATION.test(text)) {
      // The items are usually in the sentences that follow, not this one.
      const items = segments
        .slice(index + 1, index + 6)
        .map((next) => trim(next.text, 60))
        .filter((item) => item.length > 3)
        .slice(0, 4);
      if (items.length < 2) continue;
      out.push({
        ...base,
        duration: Math.max(duration, 4),
        graphic: { kind: 'list', title: trim(text, 60), value: '', caption: '', items, accent, position: 'left' },
      });
      continue;
    }

    if (TAKEAWAY.test(text)) {
      out.push({
        ...base,
        graphic: { kind: 'quote', title: 'The point', value: trim(text, 140), caption: '', items: [], accent, position: 'centre' },
      });
    }
  }

  return out;
}

/** A blank graphic for the "add one myself" path. */
export function emptyGraphic(kind: Graphic['kind'] = 'stat'): Graphic {
  return {
    kind,
    title: kind === 'list' ? 'Three things' : 'Label',
    value: kind === 'stat' ? '10x' : kind === 'quote' ? 'Say the thing worth remembering' : '',
    caption: '',
    items: kind === 'list' ? ['First point', 'Second point', 'Third point'] : [],
    accent: GRAPHIC_ACCENTS[0]!.value,
    position: 'left',
  };
}

/**
 * A short label for what the number is about — the two or three words before
 * it, which is nearly always the subject.
 */
function subjectOf(text: string): string {
  const words = text.replace(/[^\w\s%£$€.]/g, ' ').split(/\s+/).filter(Boolean);
  const at = words.findIndex((word) => /\d/.test(word));
  if (at <= 0) return trim(words.slice(0, 3).join(' '), 32);
  return trim(words.slice(Math.max(0, at - 3), at).join(' '), 32);
}

function withoutFigure(text: string, figure: string): string {
  return text.replace(figure, '').replace(/\s{2,}/g, ' ').trim();
}

function trim(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}
