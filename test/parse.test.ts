import { describe, expect, it } from 'vitest';
import { createEngine, recoverRevealed } from '../src';
import { porter, vector } from './fixtures';

const engine = createEngine();
const secrets = porter.secrets!;
const marker = secrets[0]!.markerPhrase!;

const block = (emotions: Record<string, number>, extra: Record<string, unknown> = {}) =>
  `<<<EMO>>>${JSON.stringify({ emotions, revealed: [], control: null, ...extra })}<<<END>>>`;

const full = { fear: 5, anger: 2, contempt: 0, sadness: 1, joy: 0, trust: 3, guilt: 4 };

describe('parseReply', () => {
  it('splits the visible text from the report block', () => {
    const parsed = engine.parseReply(`I was at the desk all night. ${block(full)}`);
    expect(parsed.visible).toBe('I was at the desk all night.');
    expect(parsed.state).toEqual(full);
    expect(parsed.control).toBeNull();
  });

  it('keeps the whole reply when there is no block', () => {
    const parsed = engine.parseReply('I was at the desk all night.');
    expect(parsed.visible).toBe('I was at the desk all night.');
    expect(parsed.state).toBeNull();
  });

  it('rounds and clamps reported intensities', () => {
    const parsed = engine.parseReply(block({ ...full, fear: 14, anger: -2, guilt: 3.6 }));
    expect(parsed.state?.fear).toBe(10);
    expect(parsed.state?.anger).toBe(0);
    expect(parsed.state?.guilt).toBe(4);
  });

  describe('failing closed', () => {
    it('drops a partial vector rather than adopting it', () => {
      const parsed = engine.parseReply(block({ fear: 3, anger: 1 }));
      expect(parsed.state).toBeNull();
    });

    it('survives malformed JSON', () => {
      const parsed = engine.parseReply('Something. <<<EMO>>>{not json<<<END>>>');
      expect(parsed.visible).toBe('Something.');
      expect(parsed.state).toBeNull();
    });

    it('rejects a non-numeric intensity', () => {
      const parsed = engine.parseReply(block({ ...full, guilt: 'high' as unknown as number }));
      expect(parsed.state).toBeNull();
    });
  });

  describe('stripping scaffolding the model parroted back', () => {
    it('removes stray secret tags and loose delimiters', () => {
      const parsed = engine.parseReply('I told you [SECRET id:"invented"] everything <<<END>>>');
      expect(parsed.visible).toBe('I told you everything');
    });

    it('removes improvised closing variants', () => {
      const parsed = engine.parseReply('Fine. [/SECRET] That is all.');
      expect(parsed.visible).toBe('Fine. That is all.');
    });

    it('leaves newlines alone', () => {
      const parsed = engine.parseReply('One.\nTwo.');
      expect(parsed.visible).toBe('One.\nTwo.');
    });
  });

  describe('control', () => {
    it('surfaces an explicit end', () => {
      expect(engine.parseReply(block(full, { control: 'end' })).control).toBe('end');
    });

    it('ignores anything else', () => {
      expect(engine.parseReply(block(full, { control: 'shout' })).control).toBeNull();
    });
  });

  describe('revealed', () => {
    it('takes the model at its word when the id is real', () => {
      const parsed = engine.parseReply(block(full, { revealed: ['left-the-desk'] }), { secrets });
      expect(parsed.revealed).toEqual(['left-the-desk']);
    });

    it('discards ids the model invented', () => {
      const parsed = engine.parseReply(block(full, { revealed: ['nonexistent'] }), { secrets });
      expect(parsed.revealed).toEqual([]);
    });

    it('recovers a reveal from the marker phrase even when the model reports nothing', () => {
      const parsed = engine.parseReply(`${marker} ${block(full)}`, { secrets });
      expect(parsed.revealed).toEqual(['left-the-desk']);
    });

    it('recovers from a paraphrase that keeps a run of the phrase intact', () => {
      const parsed = engine.parseReply(`Look — I was not at the desk. I stepped out to the yard, all right? ${block(full)}`, {
        secrets,
      });
      expect(parsed.revealed).toEqual(['left-the-desk']);
    });

    it('does not double-count a reveal reported and recovered at once', () => {
      const parsed = engine.parseReply(`${marker} ${block(full, { revealed: ['left-the-desk'] })}`, { secrets });
      expect(parsed.revealed).toEqual(['left-the-desk']);
    });

    it('ignores a marker phrase while the gate is still shut', () => {
      const parsed = engine.parseReply(`${marker} ${block({ ...full, guilt: 1 })}`, { secrets });
      expect(parsed.revealed).toEqual([]);
    });

    it('gates on this turn’s vector, not the one passed in', () => {
      // Passed-in state would keep the gate shut; the fresh report opens it.
      const parsed = engine.parseReply(`${marker} ${block(full)}`, { secrets, state: vector({ guilt: 0 }) });
      expect(parsed.revealed).toEqual(['left-the-desk']);
    });

    it('falls back to the supplied state when the block is missing', () => {
      const parsed = engine.parseReply(marker, { secrets, state: vector({ guilt: 6 }) });
      expect(parsed.revealed).toEqual(['left-the-desk']);
    });

    it('reports nothing without a secret catalogue', () => {
      expect(engine.parseReply(`${marker} ${block(full)}`).revealed).toEqual([]);
    });
  });
});

describe('recoverRevealed', () => {
  const open = vector({ guilt: 6 });

  it('returns nothing for an empty catalogue or empty text', () => {
    expect(recoverRevealed(marker, [], open)).toEqual([]);
    expect(recoverRevealed('', secrets, open)).toEqual([]);
  });

  it('skips secrets that have no marker phrase', () => {
    const unmarked = [{ ...secrets[0]!, markerPhrase: undefined }];
    expect(recoverRevealed(marker, unmarked, open)).toEqual([]);
  });

  it('does not fire on unrelated text', () => {
    expect(recoverRevealed('The lamp was broken and I could barely read the register.', secrets, open)).toEqual([]);
  });

  it('KNOWN LIMITATION: a denial sharing six consecutive words registers as a reveal', () => {
    // The heuristic looks for a run of six consecutive words from the marker
    // phrase. A denial built from the same vocabulary can contain one — here
    // "at the desk i stepped out" appears in both. Marker phrases should be
    // written so that no six-word run of them survives inside a plausible
    // denial: put something distinctive early ("gone a full hour").
    expect(recoverRevealed('I was at the desk. I stepped out for nothing.', secrets, open)).toEqual([
      'left-the-desk',
    ]);
  });

  it('recovers several secrets at once', () => {
    const two = [
      secrets[0]!,
      {
        id: 'the-key',
        abstract: 'a',
        concrete: 'b',
        markerPhrase: 'I kept a copy of the key to room twelve in my coat',
        unlock: { emotion: 'guilt' as const, gte: 4 },
      },
    ];
    const text = `${marker} And more. I kept a copy of the key to room twelve in my coat.`;
    expect(recoverRevealed(text, two, open).sort()).toEqual(['left-the-desk', 'the-key']);
  });

  // UAX#29 classifies both the straight apostrophe (U+0027) and the curly right
  // single quotation mark (U+2019) as MidLetter, so `Intl.Segmenter` keeps either
  // one glued inside its word rather than treating it as a break — correct for
  // word-hood, but it means "wasn't" and "wasn’t" tokenize as two different
  // words, never one. A marker phrase is authored once in a file; a model reply
  // is typed by a model with no reason to prefer that glyph. The marker below is
  // deliberately exactly `minConsecutiveWords` long so the run has nowhere else
  // to land — with a longer phrase, a window further from the elision can dodge
  // the mismatched token entirely and the bug hides, which is how it survived
  // unnoticed in a real deployment's marker set.
  describe('apostrophe glyphs do not change whether a reveal is recovered', () => {
    const confession = {
      id: 'left-the-gate',
      abstract: 'a',
      concrete: 'b',
      markerPhrase: "It wasn't me who did it.",
      unlock: { emotion: 'guilt' as const, gte: 4 },
    };

    it('recovers a straight-apostrophe marker from a reply typed with the curly glyph', () => {
      const reply = 'Fine. It wasn’t me who did it, I swear.';
      expect(recoverRevealed(reply, [confession], open)).toEqual(['left-the-gate']);
    });

    it('recovers a curly-apostrophe marker from a reply typed with the straight glyph', () => {
      const curlyMarker = { ...confession, markerPhrase: 'It wasn’t me who did it.' };
      const reply = "Fine. It wasn't me who did it, I swear.";
      expect(recoverRevealed(reply, [curlyMarker], open)).toEqual(['left-the-gate']);
    });
  });
});

describe('reported events', () => {
  const declared = [{ id: 'paid', when: 'you confirmed the payment' }];
  const block = (json: string) => `Very good. <<<EMO>>>${json}<<<END>>>`;
  const full = (extra: string) =>
    `{"emotions":{"fear":0,"anger":0,"contempt":0,"sadness":0,"joy":0,"trust":0,"guilt":0},"revealed":[]${extra},"control":null}`;

  it('returns a declared id the model reported', () => {
    const out = engine.parseReply(block(full(',"events":["paid"]')), { events: declared });
    expect(out.events).toEqual(['paid']);
  });

  it('drops an id nobody declared', () => {
    const out = engine.parseReply(block(full(',"events":["refunded"]')), { events: declared });
    expect(out.events).toEqual([]);
  });

  it('is empty when nothing is declared, even if the model reports something', () => {
    const out = engine.parseReply(block(full(',"events":["paid"]')), { events: [] });
    expect(out.events).toEqual([]);
  });

  it('dedupes a repeated reported id', () => {
    const out = engine.parseReply(block(full(',"events":["paid","paid"]')), { events: declared });
    expect(out.events).toEqual(['paid']);
  });

  it('is empty when the field is absent, so an old prompt still parses', () => {
    expect(engine.parseReply(block(full('')), { events: declared }).events).toEqual([]);
  });

  it('is empty when the field is not an array', () => {
    const out = engine.parseReply(block(full(',"events":"paid"')), { events: declared });
    expect(out.events).toEqual([]);
  });

  it('strips a stray event tag out of the visible text', () => {
    const out = engine.parseReply(`Fine. [EVENT id:"paid"] ${block(full(''))}`, { events: declared });
    expect(out.visible).not.toContain('EVENT');
  });
});
