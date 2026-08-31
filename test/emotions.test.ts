import { describe, expect, it } from 'vitest';
import { baselineVector, clampVector, decayEmotions, defaultTuning, evaluateUnlock } from '../src';
import type { Traits } from '../src';
import { porter, vector } from './fixtures';

const traits = (overrides: Partial<Traits> = {}): Traits => ({
  neuroticism: 'mid',
  agreeableness: 'mid',
  conscientiousness: 'mid',
  extraversion: 'mid',
  openness: 'mid',
  ...overrides,
});

describe('evaluateUnlock', () => {
  it('passes a single threshold when reached', () => {
    expect(evaluateUnlock({ emotion: 'guilt', gte: 4 }, vector({ guilt: 4 }))).toBe(true);
    expect(evaluateUnlock({ emotion: 'guilt', gte: 4 }, vector({ guilt: 3 }))).toBe(false);
  });

  it('sums the listed axes', () => {
    const condition = { sum: ['trust', 'sadness'] as const, gte: 6 };
    expect(evaluateUnlock(condition, vector({ trust: 3, sadness: 3 }))).toBe(true);
    expect(evaluateUnlock(condition, vector({ trust: 5, sadness: 0 }))).toBe(false);
  });

  it('requires every child of `all`', () => {
    const condition = {
      all: [
        { emotion: 'trust' as const, gte: 3 },
        { emotion: 'sadness' as const, gte: 3 },
      ],
    };
    expect(evaluateUnlock(condition, vector({ trust: 3, sadness: 3 }))).toBe(true);
    expect(evaluateUnlock(condition, vector({ trust: 9, sadness: 2 }))).toBe(false);
  });

  it('requires one child of `any`', () => {
    const condition = {
      any: [
        { emotion: 'fear' as const, gte: 7 },
        { emotion: 'trust' as const, gte: 5 },
      ],
    };
    expect(evaluateUnlock(condition, vector({ trust: 5 }))).toBe(true);
    expect(evaluateUnlock(condition, vector({ fear: 6, trust: 4 }))).toBe(false);
  });

  it('rejects degenerate corners when a sum is floored by per-axis minimums', () => {
    // The pattern that stops "trust 6, sadness 0" from opening a gate meant to
    // need both. A bare sum would pass it.
    const condition = {
      all: [
        { sum: ['trust', 'sadness'] as const, gte: 6 },
        { emotion: 'trust' as const, gte: 3 },
        { emotion: 'sadness' as const, gte: 3 },
      ],
    };
    expect(evaluateUnlock(condition, vector({ trust: 6, sadness: 0 }))).toBe(false);
    expect(evaluateUnlock(condition, vector({ trust: 3, sadness: 3 }))).toBe(true);
  });

  it('nests arbitrarily', () => {
    const condition = {
      any: [{ emotion: 'guilt' as const, gte: 8 }, { all: [{ emotion: 'trust' as const, gte: 4 }, { sum: ['sadness', 'fear'] as const, gte: 5 }] }],
    };
    expect(evaluateUnlock(condition, vector({ guilt: 8 }))).toBe(true);
    expect(evaluateUnlock(condition, vector({ trust: 4, sadness: 3, fear: 2 }))).toBe(true);
    expect(evaluateUnlock(condition, vector({ trust: 4, sadness: 1, fear: 1 }))).toBe(false);
  });
});

describe('baselineVector', () => {
  it('fills unset axes with 0', () => {
    expect(baselineVector(porter.emotion)).toEqual(vector({ fear: 2, anger: 1, guilt: 1 }));
  });
});

describe('clampVector', () => {
  it('holds every axis inside 0-10', () => {
    const clamped = clampVector(vector({ anger: 14, fear: -3 }));
    expect(clamped.anger).toBe(10);
    expect(clamped.fear).toBe(0);
  });
});

describe('decayEmotions', () => {
  const baseline = { fear: 2, anger: 1, guilt: 1 };

  it('leaves a state already at baseline untouched', () => {
    const state = vector(baseline);
    expect(decayEmotions(state, baseline, traits(), 1)).toEqual(state);
  });

  it('falls by the configured rate and never below baseline', () => {
    const decayed = decayEmotions(vector({ ...baseline, anger: 9 }), baseline, traits(), 1);
    expect(decayed.anger).toBe(9 - defaultTuning.decayPerStep.anger);

    const floored = decayEmotions(vector({ ...baseline, anger: 9 }), baseline, traits(), 20);
    expect(floored.anger).toBe(1);
  });

  it('lets trust linger far longer than anger', () => {
    const state = vector({ anger: 8, trust: 8 });
    const decayed = decayEmotions(state, {}, traits(), 1);
    expect(decayed.anger).toBe(6);
    expect(decayed.trust).toBe(7.75);
  });

  it('halves the rate for high-neuroticism characters', () => {
    const state = vector({ anger: 9 });
    const steady = decayEmotions(state, {}, traits({ neuroticism: 'low' }), 1);
    const brooding = decayEmotions(state, {}, traits({ neuroticism: 'high' }), 1);
    expect(steady.anger).toBe(7);
    expect(brooding.anger).toBe(8);
  });
});
