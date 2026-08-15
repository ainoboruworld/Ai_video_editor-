import { describe, expect, it } from 'vitest';
import { deriveQueries, orientationForAspect, rankItems, scoreItem, tokenize } from '@/lib/media/rank';
import type { StockMediaItem } from '@/types';

function item(partial: Partial<StockMediaItem>): StockMediaItem {
  return {
    id: 'x',
    provider: 'pexels',
    type: 'video',
    title: 'a clip',
    thumbnailUrl: 't',
    previewUrl: null,
    downloadUrl: 'd',
    width: 1920,
    height: 1080,
    duration: 10,
    orientation: 'landscape',
    creator: null,
    creatorUrl: null,
    sourceUrl: 's',
    license: 'l',
    ...partial,
  };
}

describe('tokenize', () => {
  it('drops stop words and short tokens', () => {
    expect(tokenize('a close up shot of the mango farm')).toEqual(['mango', 'farm']);
  });
});

describe('deriveQueries', () => {
  it('produces specific-to-generic variants', () => {
    const queries = deriveQueries('farmer harvesting ripe mangoes in an orchard');
    expect(queries[0]).toContain('farmer harvesting');
    expect(queries.length).toBeGreaterThan(1);
    expect(new Set(queries).size).toBe(queries.length);
  });

  it('returns nothing for an empty description', () => {
    expect(deriveQueries('   ')).toEqual([]);
  });
});

describe('scoreItem', () => {
  it('prefers footage that matches the project orientation', () => {
    const portrait = scoreItem(item({ orientation: 'portrait', width: 1080, height: 1920 }), {
      query: 'a clip',
      orientation: 'portrait',
    });
    const landscape = scoreItem(item({ orientation: 'landscape' }), { query: 'a clip', orientation: 'portrait' });
    expect(portrait).toBeGreaterThan(landscape);
  });

  it('prefers relevant titles', () => {
    const relevant = scoreItem(item({ title: 'mango orchard harvest' }), {
      query: 'mango orchard',
      orientation: 'landscape',
    });
    const irrelevant = scoreItem(item({ title: 'city traffic at night' }), {
      query: 'mango orchard',
      orientation: 'landscape',
    });
    expect(relevant).toBeGreaterThan(irrelevant);
  });

  it('penalises clips shorter than the scene', () => {
    const long = scoreItem(item({ duration: 12 }), { query: 'a clip', orientation: 'landscape', targetDuration: 6 });
    const short = scoreItem(item({ duration: 2 }), { query: 'a clip', orientation: 'landscape', targetDuration: 6 });
    expect(long).toBeGreaterThan(short);
  });
});

describe('rankItems', () => {
  it('sorts by score and de-duplicates identical files', () => {
    const ranked = rankItems(
      [
        item({ id: 'a', title: 'city traffic', downloadUrl: 'one' }),
        item({ id: 'b', title: 'mango orchard harvest', downloadUrl: 'two' }),
        item({ id: 'c', title: 'mango orchard harvest', downloadUrl: 'two' }),
      ],
      { query: 'mango orchard', orientation: 'landscape' },
    );
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.title).toBe('mango orchard harvest');
  });
});

describe('orientationForAspect', () => {
  it('maps project aspect ratios to footage orientation', () => {
    expect(orientationForAspect('9:16')).toBe('portrait');
    expect(orientationForAspect('4:5')).toBe('portrait');
    expect(orientationForAspect('1:1')).toBe('square');
    expect(orientationForAspect('16:9')).toBe('landscape');
  });
});
