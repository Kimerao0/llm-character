import { describe, expect, it } from 'vitest';
import { createEngine, deepMerge, defaultTuning } from '../src';
import { porter, vector } from './fixtures';

describe('createEngine', () => {
  it('ships usable defaults with no configuration', () => {
    const engine = createEngine();
    expect(engine.buildContext(porter)).toContain('YOUR PERSONALITY:');
    expect(engine.tuning.high.anger).toBe(6);
    expect(engine.controls).toEqual(['end']);
  });

  it('merges a single prose override without disturbing the rest', () => {
    const engine = createEngine({ prose: { traits: { header: 'WHO YOU ARE:' } } });
    const prompt = engine.buildContext(porter);
    expect(prompt).toContain('WHO YOU ARE:');
    expect(prompt).not.toContain('YOUR PERSONALITY:');
    // untouched siblings survive
    expect(prompt).toContain('Neuroticism (emotional reactivity)');
  });

  it('merges a single tuning value without dropping the decay table', () => {
    const engine = createEngine({ tuning: { high: 8 } });
    expect(engine.tuning.high.anger).toBe(8);
    expect(engine.tuning.decayPerStep).toEqual(defaultTuning.decayPerStep);
  });

  describe('relabelling the axes', () => {
    const engine = createEngine({
      prose: {
        emotionLabels: {
          fear: 'paura',
          anger: 'rabbia',
          contempt: 'disprezzo',
          sadness: 'tristezza',
          joy: 'gioia',
          trust: 'fiducia',
          guilt: 'colpa',
        },
      },
    });

    it('renames them in the prompt', () => {
      const prompt = engine.buildContext(porter, { state: vector({ anger: 7 }) });
      expect(prompt).toContain('rabbia: 7');
      expect(prompt).not.toContain('anger: 7');
    });

    it('reads the renamed keys back out of a reply', () => {
      const emotions = { paura: 5, rabbia: 2, disprezzo: 0, tristezza: 1, gioia: 0, fiducia: 3, colpa: 4 };
      const raw = `Va bene. <<<EMO>>>${JSON.stringify({ emotions, revealed: [], control: null })}<<<END>>>`;
      const parsed = engine.parseReply(raw);
      expect(parsed.visible).toBe('Va bene.');
      expect(parsed.state).toEqual({ fear: 5, anger: 2, contempt: 0, sadness: 1, joy: 0, trust: 3, guilt: 4 });
    });
  });

  describe('custom markers', () => {
    const engine = createEngine({ markers: { open: '[[S]]', close: '[[E]]', secretTag: 'HIDDEN' } });

    it('emits and strips the configured delimiters', () => {
      const prompt = engine.buildContext(porter, { state: vector({ guilt: 6 }) });
      expect(prompt).toContain('[[S]]{"emotions"');
      expect(prompt).toContain('[HIDDEN id:"left-the-desk"]');

      const parsed = engine.parseReply('Done. [[S]]{"broken"[[E]] [HIDDEN id:"x"]');
      expect(parsed.visible).toBe('Done.');
    });

    it('escapes regex metacharacters in the delimiters', () => {
      const tricky = createEngine({ markers: { open: 'a.b(', close: ')c' } });
      const parsed = tricky.parseReply('Visible. a.b({"emotions":{}})c');
      expect(parsed.visible).toBe('Visible.');
    });
  });

  it('exposes the gate directly', () => {
    const engine = createEngine();
    const secret = porter.secrets![0]!;
    expect(engine.isUnlocked(secret, vector({ guilt: 4 }))).toBe(true);
    expect(engine.isUnlocked(secret, vector({ guilt: 3 }))).toBe(false);
    expect(engine.evaluate({ emotion: 'fear', gte: 2 }, vector({ fear: 2 }))).toBe(true);
  });

  it('decays a state using the character’s own baseline and traits', () => {
    const engine = createEngine();
    // porter is high-neuroticism, so anger falls at half rate: 9 - (2 * 0.5)
    expect(engine.decay(vector({ anger: 9 }), porter).anger).toBe(8);
    expect(engine.baseline(porter)).toEqual(vector({ fear: 2, anger: 1, guilt: 1 }));
  });
});

describe('deepMerge', () => {
  it('replaces functions and arrays wholesale', () => {
    const fn = () => 'new';
    const merged = deepMerge({ fn: () => 'old', list: [1, 2], nested: { a: 1, b: 2 } }, {
      fn,
      list: [3],
      nested: { b: 9 },
    });
    expect(merged.fn()).toBe('new');
    expect(merged.list).toEqual([3]);
    expect(merged.nested).toEqual({ a: 1, b: 9 });
  });

  it('returns the base untouched when there is nothing to merge', () => {
    const base = { a: 1 };
    expect(deepMerge(base, undefined)).toBe(base);
  });
});
