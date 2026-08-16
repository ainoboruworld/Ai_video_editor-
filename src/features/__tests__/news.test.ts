import { describe, expect, it } from 'vitest';
import { citationDate, citationGraphic, newsCuesFromTranscript, searchQuery } from '@/features/edit/news';
import { cleanHeadline, dedupe, parseSeenDate, publisherName } from '@/lib/news/gdelt';
import type { NewsArticle } from '@/types';

function segments(...texts: string[]) {
  return texts.map((text, index) => ({
    id: `s${index}`,
    start: index * 5,
    end: index * 5 + 4,
    text,
  }));
}

function article(overrides: Partial<NewsArticle> = {}): NewsArticle {
  return {
    id: 'news-1',
    title: 'Battery costs fell again last year',
    url: 'https://www.reuters.com/business/energy/story',
    domain: 'reuters.com',
    source: 'Reuters',
    publishedAt: '2024-03-04T09:00:00.000Z',
    language: 'English',
    ...overrides,
  };
}

describe('newsCuesFromTranscript', () => {
  it('offers a citation where the speaker makes a checkable claim', () => {
    const [cue] = newsCuesFromTranscript(segments('Battery prices fell 40% between 2020 and 2023.'));
    expect(cue).toBeDefined();
    expect(cue!.start).toBe(0);
  });

  it('reads a study, a year and a money figure as claims', () => {
    for (const text of [
      'A Stanford study found the opposite of what everyone assumed.',
      'Back in 2018 the whole industry was structured differently.',
      'They raised $30 million on the strength of that demo.',
    ]) {
      expect(newsCuesFromTranscript(segments(text))).toHaveLength(1);
    }
  });

  it('says nothing about opinion or narration', () => {
    expect(
      newsCuesFromTranscript(segments('So I want to walk you through how we think about this problem.')),
    ).toHaveLength(0);
  });

  it('ignores a claim too short to be one', () => {
    expect(newsCuesFromTranscript(segments('Up 12%.'))).toHaveLength(0);
  });

  it('stays bounded so the panel is not a wall of citations', () => {
    const many = newsCuesFromTranscript(
      segments(...Array.from({ length: 20 }, (_, i) => `That segment grew ${i + 1}% according to the report we read.`)),
    );
    expect(many.length).toBeLessThanOrEqual(6);
  });

  it('gives every cue a duration long enough to read', () => {
    for (const cue of newsCuesFromTranscript(segments('Revenue rose 22% in 2023, according to their filing.'))) {
      expect(cue.duration).toBeGreaterThanOrEqual(3);
      expect(cue.duration).toBeLessThanOrEqual(6);
    }
  });
});

describe('searchQuery', () => {
  it('prefers the proper nouns, which are what identifies a claim', () => {
    expect(searchQuery('Last year Toyota and Panasonic opened the plant together.').toLowerCase()).toContain('toyota');
  });

  it('falls back to content words when there are no names', () => {
    const query = searchQuery('The regulation changed how batteries are recycled.');
    expect(query).not.toBe('');
    expect(query.split(' ').length).toBeLessThanOrEqual(4);
  });

  it('drops the filler a news index cannot match on', () => {
    const query = searchQuery('So I think we are going to see a lot of that.');
    expect(query).not.toMatch(/\b(?:think|going|that)\b/);
  });

  it('never repeats a term just because its capital differs', () => {
    const query = searchQuery('Toyota and Panasonic raised $30 million for the plant in 2022.');
    const terms = query.toLowerCase().split(' ');
    expect(new Set(terms).size).toBe(terms.length);
  });

  it('never leads with the sentence-initial capital, which is just grammar', () => {
    // "Battery" is capitalised only because it starts the sentence, so treating
    // it as a name would put a common noun ahead of the actual subject.
    expect(searchQuery('Battery makers in Norway expanded again.')).toContain('Norway');
  });
});

describe('citations', () => {
  it('puts the headline in the graphic and the publisher in the label', () => {
    const graphic = citationGraphic(article());
    expect(graphic.kind).toBe('citation');
    expect(graphic.value).toContain('Battery costs');
    expect(graphic.title).toContain('Reuters');
    expect(graphic.caption).toBe('reuters.com');
  });

  it('omits the date rather than inventing one', () => {
    const graphic = citationGraphic(article({ publishedAt: null }));
    expect(graphic.title).toBe('Reuters');
    expect(graphic.title).not.toContain('·');
  });

  it('shortens a headline too long to fit the card', () => {
    const graphic = citationGraphic(article({ title: 'x'.repeat(400) }));
    expect(graphic.value.length).toBeLessThanOrEqual(150);
  });

  it('carries no image URL — publisher photography is not ours to use', () => {
    expect(Object.values(citationGraphic(article())).join(' ')).not.toMatch(/https?:\/\/\S+\.(?:jpg|png|webp)/i);
  });

  it('formats a date a reader can parse at a glance', () => {
    expect(citationDate('2024-03-04T09:00:00.000Z')).toMatch(/2024/);
    expect(citationDate(null)).toBe('');
    expect(citationDate('not a date')).toBe('');
  });
});

describe('the news index', () => {
  it('reads GDELT stamps, and refuses the ones it cannot', () => {
    expect(parseSeenDate('20240115T123000Z')).toBe('2024-01-15T12:30:00.000Z');
    expect(parseSeenDate('20240115')).toBe('2024-01-15T00:00:00.000Z');
    expect(parseSeenDate('yesterday')).toBeNull();
    expect(parseSeenDate(undefined)).toBeNull();
  });

  it('strips the publisher suffix newsrooms staple onto headlines', () => {
    expect(cleanHeadline('Battery costs fell again - Reuters', 'reuters.com')).toBe('Battery costs fell again');
    expect(cleanHeadline('Battery costs fell again | The Guardian', 'theguardian.com')).toBe('Battery costs fell again');
  });

  it('leaves a headline alone when the suffix is not the publisher', () => {
    expect(cleanHeadline('Costs fell — and here is why', 'reuters.com')).toBe('Costs fell — and here is why');
  });

  it('names publishers the way a reader would', () => {
    expect(publisherName('www.reuters.com')).toBe('Reuters');
    expect(publisherName('bbc.co.uk')).toBe('BBC');
  });

  it('keeps one article per URL and caps any one outlet', () => {
    const merged = dedupe([
      article({ url: 'https://a.com/1', domain: 'a.com' }),
      article({ url: 'https://a.com/1?utm=x', domain: 'a.com' }),
      article({ url: 'https://a.com/2', domain: 'a.com' }),
      article({ url: 'https://a.com/3', domain: 'a.com' }),
      article({ url: 'https://b.com/1', domain: 'b.com' }),
    ]);
    expect(merged.map((a) => a.url)).toEqual(['https://a.com/1', 'https://a.com/2', 'https://b.com/1']);
  });
});
