import { describe, expect, it } from 'vitest';
import { audibleClips, clipOpacity, coverRect, filterString, visibleLayers } from '@/features/timeline/compositor';
import { applyCommand, makeClip, makeSequence, trackByRole } from '@/lib/engine';

describe('coverRect', () => {
  it('crops the sides of wide footage in a tall frame instead of stretching it', () => {
    const rect = coverRect(1920, 1080, 1080, 1920);
    expect(rect.sh).toBe(1080);
    expect(rect.sw).toBeCloseTo(1080 * (1080 / 1920), 3);
    expect(rect.sx).toBeGreaterThan(0);
    expect(rect.sy).toBe(0);
  });

  it('crops the top and bottom of tall footage in a wide frame', () => {
    const rect = coverRect(1080, 1920, 1920, 1080);
    expect(rect.sw).toBe(1080);
    expect(rect.sy).toBeGreaterThan(0);
  });

  it('is a no-op when the ratios already match', () => {
    const rect = coverRect(1920, 1080, 1280, 720);
    expect(rect).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080 });
  });
});

describe('clipOpacity', () => {
  const clip = makeClip({ id: 'c', kind: 'video', start: 0, duration: 4 });

  it('is the clip opacity in the middle of the clip', () => {
    expect(clipOpacity(clip, 2)).toBe(1);
  });

  it('ramps up during an in transition', () => {
    const withIn = { ...clip, transitionIn: { kind: 'fade' as const, duration: 1, position: 'in' as const } };
    expect(clipOpacity(withIn, 0)).toBeCloseTo(0, 5);
    expect(clipOpacity(withIn, 1)).toBeCloseTo(1, 5);
    expect(clipOpacity(withIn, 0.5)).toBeGreaterThan(0);
    expect(clipOpacity(withIn, 0.5)).toBeLessThan(1);
  });

  it('ramps down during an out transition', () => {
    const withOut = { ...clip, transitionOut: { kind: 'fade' as const, duration: 1, position: 'out' as const } };
    expect(clipOpacity(withOut, 4)).toBeCloseTo(0, 5);
    expect(clipOpacity(withOut, 3)).toBeCloseTo(1, 5);
  });

  it('meets at zero on both sides of a butt join, which is what makes the dip', () => {
    // The join a recut leaves behind: the outgoing clip's last frame and the
    // incoming clip's first frame are both fully faded, so the cut lands in
    // darkness rather than on a hard jump.
    const outgoing = { ...clip, transitionOut: { kind: 'dip-to-black' as const, duration: 0.5, position: 'out' as const } };
    const incoming = { ...clip, transitionIn: { kind: 'dip-to-black' as const, duration: 0.5, position: 'in' as const } };
    expect(clipOpacity(outgoing, 4)).toBeCloseTo(0, 5);
    expect(clipOpacity(incoming, 0)).toBeCloseTo(0, 5);
  });

  it('leaves slide, zoom and blur fully opaque — they are not fades', () => {
    for (const kind of ['slide', 'zoom', 'blur'] as const) {
      const withIn = { ...clip, transitionIn: { kind, duration: 1, position: 'in' as const } };
      expect(clipOpacity(withIn, 0)).toBe(1);
      expect(clipOpacity(withIn, 0.5)).toBe(1);
    }
  });
});

describe('visibleLayers', () => {
  it('paints video first, then text, then captions', () => {
    let sequence = makeSequence('s', 'test', '9:16');
    const broll = trackByRole(sequence, 'broll')!;
    const text = trackByRole(sequence, 'text')!;
    const caption = trackByRole(sequence, 'caption')!;

    sequence = applyCommand(sequence, {
      type: 'ADD_CLIP',
      trackId: broll.id,
      clip: makeClip({ id: 'v', kind: 'video', start: 0, duration: 5, assetId: 'a' }),
    });
    sequence = applyCommand(sequence, {
      type: 'ADD_TEXT',
      trackId: text.id,
      clipId: 't',
      text: 'hi',
      start: 0,
      duration: 5,
    });
    sequence = applyCommand(sequence, {
      type: 'ADD_CAPTION',
      trackId: caption.id,
      clipId: 'c',
      text: 'hi',
      start: 0,
      duration: 5,
    });

    expect(visibleLayers(sequence, 2).map((layer) => layer.clip.id)).toEqual(['v', 't', 'c']);
    expect(visibleLayers(sequence, 9)).toHaveLength(0);
  });

  it('skips hidden tracks', () => {
    let sequence = makeSequence('s', 'test', '9:16');
    const broll = trackByRole(sequence, 'broll')!;
    sequence = applyCommand(sequence, {
      type: 'ADD_CLIP',
      trackId: broll.id,
      clip: makeClip({ id: 'v', kind: 'video', start: 0, duration: 5, assetId: 'a' }),
    });
    sequence = applyCommand(sequence, { type: 'SET_TRACK_STATE', trackId: broll.id, visible: false });
    expect(visibleLayers(sequence, 1)).toHaveLength(0);
  });
});

describe('audibleClips', () => {
  it('honours mute and solo', () => {
    let sequence = makeSequence('s', 'test', '9:16');
    const music = trackByRole(sequence, 'music')!;
    const voice = trackByRole(sequence, 'voiceover')!;
    sequence = applyCommand(sequence, {
      type: 'ADD_CLIP',
      trackId: music.id,
      clip: makeClip({ id: 'm', kind: 'audio', start: 0, duration: 5, assetId: 'a' }),
    });
    sequence = applyCommand(sequence, {
      type: 'ADD_CLIP',
      trackId: voice.id,
      clip: makeClip({ id: 'vo', kind: 'audio', start: 0, duration: 5, assetId: 'b' }),
    });

    expect(audibleClips(sequence, 1).map((entry) => entry.clip.id).sort()).toEqual(['m', 'vo']);

    const muted = applyCommand(sequence, { type: 'SET_TRACK_STATE', trackId: music.id, muted: true });
    expect(audibleClips(muted, 1).map((entry) => entry.clip.id)).toEqual(['vo']);

    const soloed = applyCommand(sequence, { type: 'SET_TRACK_STATE', trackId: music.id, solo: true });
    expect(audibleClips(soloed, 1).map((entry) => entry.clip.id)).toEqual(['m']);
  });
});

describe('filterString', () => {
  it('emits nothing for a neutral clip', () => {
    expect(filterString(makeClip({ id: 'c', kind: 'video', start: 0, duration: 1 }))).toBe('');
  });

  it('emits CSS filters for adjusted clips', () => {
    const clip = makeClip({ id: 'c', kind: 'video', start: 0, duration: 1 });
    clip.filters = { ...clip.filters, brightness: 0.2, saturation: 1.5, grayscale: true };
    const css = filterString(clip);
    expect(css).toContain('brightness(1.200)');
    expect(css).toContain('saturate(1.500)');
    expect(css).toContain('grayscale(1)');
  });
});
