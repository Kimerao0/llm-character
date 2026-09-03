import { describe, expect, it } from 'vitest';
import { createEngine, enProse, recoverRevealed } from '../src';
import type { Character, Secret } from '../src';
import { porter, vector } from './fixtures';

interface Evidence {
  clues: number;
}

/** A character whose confession cannot be felt out of him — only proven. */
const marlow: Character<Evidence> = {
  identity: 'You are Marlow. You are speaking to a detective.',
  epistemicBound: 'You deny everything by default.',
  traits: {
    neuroticism: 'high',
    agreeableness: 'low',
    conscientiousness: 'low',
    extraversion: 'mid',
    openness: 'low',
  },
  emotion: { active: ['fear', 'guilt'], baseline: { fear: 2 }, sensitivities: 'Fear rises under accusation.' },
  secrets: [
    {
      id: 'confession',
      abstract: 'There is a thing you will never say.',
      concrete: 'You killed him.',
      markerPhrase: 'All right. It was me. I did it and I have nothing left to say about it.',
      unlock: { emotion: 'guilt', gte: 4 },
      requires: (ctx) => ctx.clues >= 3,
    },
  ],
};

describe('requires — the non-emotional gate', () => {
  const engine = createEngine();
  const guilty = vector({ guilt: 8 });

  it('withholds the payload when the world has not earned it, however guilty he feels', () => {
    const prompt = engine.buildContext(marlow, { state: guilty, context: { clues: 0 } });
    expect(prompt).not.toContain('You killed him.');
  });

  it('injects it once both gates pass', () => {
    const prompt = engine.buildContext(marlow, { state: guilty, context: { clues: 3 } });
    expect(prompt).toContain('You killed him.');
  });

  it('still needs the emotional gate even with the evidence in hand', () => {
    const prompt = engine.buildContext(marlow, { state: vector({ guilt: 1 }), context: { clues: 5 } });
    expect(prompt).not.toContain('You killed him.');
  });

  it('applies with the emotional layer off too — evidence is a fact, not a feeling', () => {
    const off = { emotional: false as const, context: { clues: 0 } };
    expect(engine.buildContext(marlow, off)).not.toContain('You killed him.');
    expect(engine.buildContext(marlow, { ...off, context: { clues: 3 } })).toContain('You killed him.');
  });

  it('blocks marker-phrase recovery too, so an unreachable secret cannot be back-doored', () => {
    const said = 'All right. It was me. I did it and I have nothing left to say about it.';
    expect(recoverRevealed(said, marlow.secrets!, guilty, { context: { clues: 0 } })).toEqual([]);
    expect(recoverRevealed(said, marlow.secrets!, guilty, { context: { clues: 3 } })).toEqual(['confession']);
  });

  it('reports through isUnlocked', () => {
    const secret = marlow.secrets![0] as Secret<Evidence>;
    expect(engine.isUnlocked(secret, guilty, { clues: 3 })).toBe(true);
    expect(engine.isUnlocked(secret, guilty, { clues: 2 })).toBe(false);
  });
});

describe('the control channel', () => {
  const engine = createEngine({ controls: ['end', 'call_guard'] as const });
  const block = (control: string | null) =>
    `Out. <<<EMO>>>{"emotions":{"fear":0,"anger":0,"contempt":0,"sadness":0,"joy":0,"trust":0,"guilt":0},"revealed":[],"control":${JSON.stringify(control)}}<<<END>>>`;

  it('accepts a declared signal', () => {
    expect(engine.parseReply(block('call_guard')).control).toBe('call_guard');
  });

  it('discards anything undeclared', () => {
    expect(engine.parseReply(block('set_fire')).control).toBeNull();
    expect(engine.parseReply(block(null)).control).toBeNull();
  });

  it('lists the vocabulary in the report instruction', () => {
    const prompt = engine.buildContext(porter);
    expect(prompt).toContain('"end", "call_guard"');
  });

  it('offers no way out in the hostility clause when `end` is not declared', () => {
    const stuck = createEngine({ controls: ['call_guard'] as const });
    const prompt = stuck.buildContext(porter, { state: vector({ anger: 9 }) });
    expect(prompt).toContain('Cooperation is not owed');
    expect(prompt).not.toContain('end the conversation with');
  });
});

describe('hostileEmotions', () => {
  it('can be redefined for a genre where other feelings turn someone hostile', () => {
    const engine = createEngine({ tuning: { hostileEmotions: ['fear'] } });
    expect(engine.buildContext(porter, { state: vector({ fear: 9 }) })).toContain('Cooperation is not owed');
    expect(engine.buildContext(porter, { state: vector({ anger: 9 }) })).not.toContain('Cooperation is not owed');
  });
});

describe('per-emotion thresholds', () => {
  // porter does not model trust, so this needs a character that does —
  // the two gates compose: an axis must be both active and over threshold.
  const openhearted: Character = { ...porter, emotion: { ...porter.emotion, active: [] } };

  it('lets one axis escalate earlier than another', () => {
    const engine = createEngine({ tuning: { high: { trust: 3 } } });
    const prompt = engine.buildContext(openhearted, { state: vector({ trust: 3, anger: 3 }) });
    expect(prompt).toContain('you trust blindly');
    expect(prompt).not.toContain('you explode');
  });

  it('still respects the active list — a low threshold cannot activate an unmodelled axis', () => {
    const engine = createEngine({ tuning: { high: { trust: 3 } } });
    expect(engine.buildContext(porter, { state: vector({ trust: 9 }) })).not.toContain('you trust blindly');
  });

  it('falls back to the library default for axes left unlisted', () => {
    const engine = createEngine({ tuning: { high: { trust: 3 } } });
    expect(engine.tuning.high.anger).toBe(6);
  });
});

describe('active emotions', () => {
  it('does not hand a behavioural instruction to an axis the character does not model', () => {
    // porter models fear, guilt and anger — not joy
    const prompt = createEngine().buildContext(porter, { state: vector({ joy: 9 }) });
    expect(prompt).toContain('joy: 9'); // still reported
    expect(prompt).not.toContain('you laugh helplessly'); // but never instructed
  });

  it('models every axis when active is empty', () => {
    const everyone: Character = { ...porter, emotion: { ...porter.emotion, active: [] } };
    expect(createEngine().buildContext(everyone, { state: vector({ joy: 9 }) })).toContain('you laugh helplessly');
  });
});

describe('marker matching', () => {
  const secrets = porter.secrets!;
  const open = vector({ guilt: 6 });

  it('gets stricter as minConsecutiveWords rises', () => {
    const denial = 'I was at the desk. I stepped out for nothing.';
    expect(recoverRevealed(denial, secrets, open, { matching: { minConsecutiveWords: 6 } })).toEqual([
      'left-the-desk',
    ]);
    expect(recoverRevealed(denial, secrets, open, { matching: { minConsecutiveWords: 9 } })).toEqual([]);
  });

  it('segments languages that do not put spaces between words', () => {
    const zh: Secret[] = [
      {
        id: 'zh',
        abstract: 'a',
        concrete: 'b',
        markerPhrase: '那天晚上我不在前台我去了后面的院子',
        unlock: { emotion: 'guilt', gte: 4 },
      },
    ];
    const said = '好吧。那天晚上我不在前台我去了后面的院子。';
    expect(recoverRevealed(said, zh, open, { matching: { locale: 'zh' } })).toEqual(['zh']);
    expect(recoverRevealed('我一直在前台。', zh, open, { matching: { locale: 'zh' } })).toEqual([]);
  });

  it('takes a custom tokenizer', () => {
    const chars = (text: string) => text.toLowerCase().replace(/\s/g, '').split('');
    const marker = secrets[0]!.markerPhrase!;
    expect(recoverRevealed(marker, secrets, open, { matching: { tokenize: chars } })).toEqual(['left-the-desk']);
  });
});

describe('assembly options', () => {
  it('accepts named stages, not just numbers', () => {
    const named: Character = { ...porter, stages: { prologue: 'You have heard nothing yet.' } };
    expect(createEngine().buildContext(named, { stage: 'prologue' })).toContain('You have heard nothing yet.');
  });

  it('uses a configurable block separator', () => {
    const engine = createEngine({ separator: '\n\n---\n\n' });
    expect(engine.buildContext(porter)).toContain('\n\n---\n\n');
  });

  it('runs the transform hook last', () => {
    const engine = createEngine({ transform: (p) => `<<${p.length}>>` });
    expect(engine.buildContext(porter)).toMatch(/^<<\d+>>$/);
  });
});

describe('event prose is overridable', () => {
  it('reaches the prompt through an override', () => {
    const engine = createEngine({
      prose: { events: { block: () => 'CUSTOM EVENT BLOCK' } },
    });
    const out = engine.buildContext(
      { ...porter, events: [{ id: 'paid', when: 'you confirmed the payment' }] },
      {}
    );
    expect(out).toContain('CUSTOM EVENT BLOCK');
  });

  it('says nothing at all when the character declares no events', () => {
    const out = createEngine().buildContext(porter, {});
    expect(out).not.toContain(enProse.events.reportLine('EVENT'));
  });

  it('appends no orphan newline when a host renders reportLine empty, even with events declared', () => {
    // A host whose `report` prose already covers events overrides `reportLine`
    // to render nothing. The guard must key off that rendered value, not off
    // `events.length` — otherwise a bare "\n" survives into the prompt and a
    // byte-identity gate downstream breaks with no failing test to explain it.
    const engine = createEngine({
      prose: { events: { reportLine: () => '' } },
    });
    const out = engine.buildContext(
      { ...porter, events: [{ id: 'paid', when: 'you confirmed the payment' }] },
      {}
    );
    expect(out).toContain(`\n${engine.prose.coreReanchor}`);
    expect(out).not.toContain(`\n\n${engine.prose.coreReanchor}`);
  });
});
