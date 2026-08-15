import { describe, expect, it } from 'vitest';
import { emptyGraphic, suggestGraphics } from '@/features/edit/graphics';
import { applyCommand, makeClip, makeSequence, trackByRole, type Sequence } from '@/lib/engine';
import { CAPTION_PRESETS } from '@/features/timeline/compositor';

function segments(...texts: string[]) {
  return texts.map((text, index) => ({
    id: `s${index}`,
    start: index * 3,
    end: index * 3 + 2.5,
    text,
  }));
}

describe('suggestGraphics', () => {
  it('offers a stat when the speaker names a figure', () => {
    const [found] = suggestGraphics(segments('Our revenue grew to $40m last year.'));
    expect(found).toBeDefined();
    expect(found!.graphic.kind).toBe('stat');
    expect(found!.graphic.value).toMatch(/40m/i);
  });

  it('reads percentages, multipliers and counted nouns as figures', () => {
    for (const text of ['About 80% of users stayed.', 'That is a 10x improvement.', 'We hired 50 people.']) {
      const [found] = suggestGraphics(segments(text));
      expect(found?.graphic.kind).toBe('stat');
    }
  });

  it('labels the stat with the words leading up to the number', () => {
    const [found] = suggestGraphics(segments('Our customer retention hit 92% this quarter.'));
    expect(found!.graphic.title.toLowerCase()).toContain('retention');
  });

  it('builds a list from the sentences after an enumeration', () => {
    const [found] = suggestGraphics(
      segments('There are three things to get right.', 'Hire slowly.', 'Ship weekly.', 'Talk to customers.'),
    );
    expect(found!.graphic.kind).toBe('list');
    expect(found!.graphic.items).toHaveLength(3);
    expect(found!.graphic.items[0]).toContain('Hire slowly');
  });

  it('ignores an enumeration with nothing following it', () => {
    expect(suggestGraphics(segments('There are three things to get right.'))).toHaveLength(0);
  });

  it('pulls a quote when the speaker flags their own takeaway', () => {
    const [found] = suggestGraphics(segments('The key point is that nobody reads the manual.'));
    expect(found!.graphic.kind).toBe('quote');
  });

  it('says nothing about an ordinary sentence', () => {
    expect(suggestGraphics(segments('So today I want to talk about our approach.'))).toHaveLength(0);
  });

  it('keeps suggestions in timeline order and bounded', () => {
    const many = suggestGraphics(segments(...Array.from({ length: 20 }, (_, i) => `We saw ${i + 1}% growth.`)));
    expect(many.length).toBeLessThanOrEqual(6);
    const starts = many.map((entry) => entry.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it('gives each suggestion a real duration', () => {
    for (const entry of suggestGraphics(segments('Revenue was $2m.', 'Costs were 40% lower.'))) {
      expect(entry.duration).toBeGreaterThan(2);
      expect(entry.duration).toBeLessThanOrEqual(5);
    }
  });
});

describe('graphic clips', () => {
  function timeline(): Sequence {
    return makeSequence('s', 'test');
  }

  it('lands on the text track and keeps its content', () => {
    const seq = timeline();
    const text = trackByRole(seq, 'text')!;
    const graphic = emptyGraphic('stat');
    const after = applyCommand(seq, {
      type: 'ADD_GRAPHIC',
      trackId: text.id,
      clipId: 'g1',
      start: 2,
      duration: 4,
      graphic,
    });

    const clip = after.tracks.find((t) => t.id === text.id)!.clips[0]!;
    expect(clip.kind).toBe('graphic');
    expect(clip.graphic).toEqual(graphic);
    expect(clip.start).toBe(2);
  });

  it('patches one field without clearing the others', () => {
    const seq = timeline();
    const text = trackByRole(seq, 'text')!;
    let after = applyCommand(seq, {
      type: 'ADD_GRAPHIC',
      trackId: text.id,
      clipId: 'g1',
      start: 0,
      duration: 4,
      graphic: emptyGraphic('list'),
    });
    after = applyCommand(after, { type: 'SET_GRAPHIC', clipId: 'g1', graphic: { accent: '#34d399' } });

    const clip = after.tracks.find((t) => t.id === text.id)!.clips[0]!;
    expect(clip.graphic!.accent).toBe('#34d399');
    expect(clip.graphic!.items).toHaveLength(3);
  });
});

describe('caption colours', () => {
  function withCaption(): { sequence: Sequence; clipId: string } {
    const seq = makeSequence('s', 'test');
    const track = trackByRole(seq, 'caption')!;
    const sequence = applyCommand(seq, {
      type: 'ADD_CLIP',
      trackId: track.id,
      clip: makeClip({ id: 'c1', kind: 'caption', start: 0, duration: 2, text: 'hello', captionStyle: 'bold' }),
    });
    return { sequence, clipId: 'c1' };
  }

  it('merges rather than replaces, so setting one colour keeps the rest', () => {
    const { sequence, clipId } = withCaption();
    let after = applyCommand(sequence, { type: 'SET_CAPTION_COLORS', clipId, colors: { text: '#ff0000' } });
    after = applyCommand(after, { type: 'SET_CAPTION_COLORS', clipId, colors: { highlight: '#00ff00' } });

    const clip = after.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)!;
    expect(clip.captionColors).toEqual({ text: '#ff0000', highlight: '#00ff00' });
  });

  it('treats null as "turn it off", not as "not set"', () => {
    const { sequence, clipId } = withCaption();
    const after = applyCommand(sequence, { type: 'SET_CAPTION_COLORS', clipId, colors: { stroke: null } });
    const clip = after.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)!;

    // The bold preset has an outline; null is the user removing it, which has to
    // survive the merge with the preset rather than falling back to it.
    expect(CAPTION_PRESETS.bold!.stroke).not.toBeNull();
    expect(clip.captionColors!.stroke).toBeNull();
  });

  it('clears every override when the whole record is nulled', () => {
    const { sequence, clipId } = withCaption();
    let after = applyCommand(sequence, { type: 'SET_CAPTION_COLORS', clipId, colors: { text: '#ff0000' } });
    after = applyCommand(after, { type: 'SET_CAPTION_COLORS', clipId, colors: null });

    const clip = after.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)!;
    expect(clip.captionColors).toBeNull();
  });
});
