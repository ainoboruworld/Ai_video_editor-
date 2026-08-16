import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EDIT_STYLE,
  EDIT_STYLES,
  editStyle,
  judgeCut,
  noticeability,
  reviseJudgement,
  type CutContext,
} from '@/features/edit/cutJudgement';

/** A seam nobody would notice: same take, still speaker, matching levels. */
function seam(overrides: Partial<CutContext> = {}): CutContext {
  return {
    id: 'c1',
    time: 10,
    handle: 0.4,
    visualJump: 0.02,
    brightnessShift: 0.005,
    subjectShift: 0.01,
    motionBefore: 0.03,
    motionAfter: 0.03,
    sameSource: true,
    levelJump: 0.03,
    inSilence: true,
    atSentenceBoundary: true,
    midSentence: false,
    brollAvailable: false,
    outgoingDuration: 8,
    incomingDuration: 8,
    ...overrides,
  };
}

const natural = editStyle('natural');
const budget = { punchesUsed: 0, punchesAllowed: 4 };
const judge = (ctx: CutContext, style = natural, b = budget) => reviseJudgement(judgeCut(ctx, style, b), ctx);

describe('scoring how obvious a cut is', () => {
  it('scores an invisible cut near zero and a bad one near one', () => {
    expect(noticeability(seam())).toBeLessThan(0.2);
    expect(
      noticeability(
        seam({
          visualJump: 0.4,
          subjectShift: 0.45,
          brightnessShift: 0.2,
          levelJump: 0.5,
          atSentenceBoundary: false,
          midSentence: true,
          motionBefore: 0,
          motionAfter: 0,
        }),
      ),
    ).toBeGreaterThan(0.8);
  });

  it('treats a cut made during movement as less exposed than one between two still poses', () => {
    const moving = seam({ visualJump: 0.18, subjectShift: 0.15, motionBefore: 0.09, motionAfter: 0.09 });
    const still = seam({ visualJump: 0.18, subjectShift: 0.15, motionBefore: 0.001, motionAfter: 0.001 });
    expect(noticeability(moving)).toBeLessThan(noticeability(still));
  });

  it('counts a mid-sentence cut as more exposed than one at a sentence end', () => {
    const boundary = seam({ visualJump: 0.15, atSentenceBoundary: true, midSentence: false });
    const middle = seam({ visualJump: 0.15, atSentenceBoundary: false, midSentence: true });
    expect(noticeability(middle)).toBeGreaterThan(noticeability(boundary));
  });

  it('ignores a movement shift small enough to be noise', () => {
    expect(noticeability(seam({ subjectShift: 0.05 }))).toBeCloseTo(noticeability(seam({ subjectShift: 0 })), 3);
  });
});

describe('choosing a technique', () => {
  it('leaves an already-clean cut completely alone', () => {
    const verdict = judge(seam());
    expect(verdict.technique).toBe('clean');
    expect(verdict.reason).toMatch(/nothing added/i);
  });

  it('fixes a clicking join without touching the picture', () => {
    const verdict = judge(seam({ levelJump: 0.3 }));
    expect(verdict.technique).toBe('audio-crossfade');
    expect(verdict.parameters.seconds).toBeGreaterThan(0);
  });

  it('reframes for a moderate position change', () => {
    const verdict = judge(seam({ visualJump: 0.2, subjectShift: 0.18, motionBefore: 0.001, motionAfter: 0.001 }));
    expect(verdict.technique).toBe('punch-in');
    expect(verdict.parameters.scale).toBeGreaterThan(1);
    expect(verdict.parameters.scale).toBeLessThanOrEqual(1.06);
  });

  it('prefers B-roll to any transition for a large jump', () => {
    const big = seam({ visualJump: 0.45, subjectShift: 0.4, motionBefore: 0, motionAfter: 0, brollAvailable: true });
    expect(judge(big).technique).toBe('broll');
  });

  it('falls back to a dissolve when there is no B-roll to cover a big jump', () => {
    const big = seam({ visualJump: 0.45, subjectShift: 0.4, motionBefore: 0, motionAfter: 0, brollAvailable: false });
    expect(judge(big).technique).toBe('dissolve');
  });

  it('bridges audio across a clip change that a sentence runs through', () => {
    const across = seam({
      sameSource: false,
      midSentence: true,
      atSentenceBoundary: false,
      inSilence: false,
      visualJump: 0.3,
      handle: 0,
    });
    expect(judge(across).technique).toBe('l-cut');
  });

  it('never dissolves a clip-to-clip join automatically', () => {
    // Two different recordings are two different shots; a hard cut is normal
    // filmmaking and a dissolve announces itself.
    const clips = seam({ sameSource: false, handle: 0, visualJump: 0.3, subjectShift: 0.2, midSentence: false });
    expect(judge(clips).technique).not.toBe('dissolve');
  });

  it('does not use the same technique for every cut', () => {
    const techniques = new Set(
      [
        seam(),
        seam({ levelJump: 0.3 }),
        seam({ visualJump: 0.2, subjectShift: 0.18, motionBefore: 0.001, motionAfter: 0.001 }),
        seam({ visualJump: 0.45, subjectShift: 0.4, motionBefore: 0, motionAfter: 0 }),
        seam({ visualJump: 0.45, subjectShift: 0.4, motionBefore: 0, motionAfter: 0, brollAvailable: true }),
      ].map((ctx) => judge(ctx).technique),
    );
    expect(techniques.size).toBeGreaterThanOrEqual(4);
  });
});

describe('rationing the visual treatments', () => {
  it('stops reframing once the budget is spent', () => {
    const ctx = seam({ visualJump: 0.2, subjectShift: 0.18, motionBefore: 0.001, motionAfter: 0.001 });
    expect(judge(ctx, natural, { punchesUsed: 0, punchesAllowed: 2 }).technique).toBe('punch-in');
    expect(judge(ctx, natural, { punchesUsed: 2, punchesAllowed: 2 }).technique).not.toBe('punch-in');
  });

  it('never reframes at all in the conservative style', () => {
    const ctx = seam({ visualJump: 0.2, subjectShift: 0.18, motionBefore: 0.001, motionAfter: 0.001 });
    expect(judge(ctx, editStyle('conservative'), { punchesUsed: 0, punchesAllowed: 0 }).technique).not.toBe('punch-in');
  });

  it('leaves more cuts alone the more conservative the style', () => {
    const ctx = seam({ visualJump: 0.08, subjectShift: 0.09, motionBefore: 0.03, motionAfter: 0.03 });
    expect(judge(ctx, editStyle('conservative')).technique).toBe('clean');
    expect(judge(ctx, editStyle('dynamic')).technique).not.toBe('clean');
  });

  it('never treats a cut more heavily as the style gets more conservative', () => {
    // The real contract behind the three styles: for any given seam, moving
    // down the list can only ever do less to it, never more.
    const intrusiveness = ['clean', 'audio-crossfade', 'j-cut', 'l-cut', 'punch-in', 'dissolve', 'broll'];
    const cases = [
      seam(),
      seam({ visualJump: 0.14, subjectShift: 0.09, motionBefore: 0.02, motionAfter: 0.02 }),
      seam({ visualJump: 0.2, subjectShift: 0.18, motionBefore: 0.001, motionAfter: 0.001 }),
      seam({ visualJump: 0.45, subjectShift: 0.4, motionBefore: 0, motionAfter: 0, brollAvailable: true }),
    ];
    for (const ctx of cases) {
      const rank = (id: 'conservative' | 'natural' | 'dynamic') =>
        intrusiveness.indexOf(judge(ctx, editStyle(id), { punchesUsed: 0, punchesAllowed: id === 'conservative' ? 0 : 4 }).technique);
      expect(rank('conservative')).toBeLessThanOrEqual(rank('dynamic'));
    }
  });

  it('defaults to natural', () => {
    expect(DEFAULT_EDIT_STYLE).toBe('natural');
    expect(EDIT_STYLES.map((s) => s.id)).toEqual(['conservative', 'natural', 'dynamic']);
  });
});

describe('the final "would an editor keep this?" pass', () => {
  it('drops a dissolve too short to be anything but a flicker', () => {
    const ctx = seam({ visualJump: 0.45, subjectShift: 0.4, motionBefore: 0, motionAfter: 0, handle: 0.02 });
    const verdict = judge(ctx);
    expect(verdict.technique).not.toBe('dissolve');
    expect(verdict.reason).toMatch(/flicker|nothing here would hide it/i);
  });

  it('drops a dissolve the neighbouring clips are too short to carry', () => {
    const raw = { ...judgeCut(seam({ visualJump: 0.5, subjectShift: 0.4 }), natural, budget) };
    const revised = reviseJudgement(
      { ...raw, technique: 'dissolve', parameters: { seconds: 0.18 } },
      seam({ outgoingDuration: 0.3, incomingDuration: 0.3 }),
    );
    expect(revised.technique).toBe('audio-crossfade');
    expect(revised.reason).toMatch(/too short/i);
  });

  it('drops a punch-in the next shot is too brief to settle into', () => {
    const ctx = seam({
      visualJump: 0.2,
      subjectShift: 0.18,
      motionBefore: 0.001,
      motionAfter: 0.001,
      incomingDuration: 0.6,
    });
    expect(judge(ctx).technique).not.toBe('punch-in');
  });

  it('drops a punch-in that would fight an existing gesture', () => {
    const ctx = seam({ visualJump: 0.2, subjectShift: 0.18, motionBefore: 0.12, motionAfter: 0.12 });
    const verdict = judge(ctx);
    if (verdict.technique === 'punch-in') throw new Error('should not reframe over movement');
    expect(verdict.technique).toBeDefined();
  });

  it('drops a J/L cut where the audio was already continuous', () => {
    const raw = judgeCut(seam({ sameSource: false, midSentence: true, atSentenceBoundary: false }), natural, budget);
    const revised = reviseJudgement({ ...raw, technique: 'l-cut' }, seam({ sameSource: true }));
    expect(revised.technique).toBe('audio-crossfade');
    expect(revised.reason).toMatch(/already continuous/i);
  });

  it('never leaves a treatment more noticeable than the cut it hides', () => {
    for (const ctx of [
      seam(),
      seam({ levelJump: 0.4 }),
      seam({ visualJump: 0.5, subjectShift: 0.45 }),
      seam({ sameSource: false, handle: 0 }),
      seam({ handle: 0.01, visualJump: 0.4 }),
    ]) {
      const verdict = judge(ctx);
      expect(verdict.residual).toBeLessThanOrEqual(verdict.noticeability + 0.001);
    }
  });
});
