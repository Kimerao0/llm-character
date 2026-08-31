# llm-character

Build LLM character prompts with personality traits, a live emotion vector, and secrets that unlock only when the character actually feels like talking.

No inference, no memory store, no vendor SDK. It turns a character definition plus a state vector into a system prompt, and turns the reply back into state. Bring your own model.

```bash
npm install llm-character
```

```ts
import { createEngine } from 'llm-character';

const engine = createEngine();

const halden = {
  identity: 'You are Halden, night porter at the Ardwick Hotel. You are speaking to an inspector.',
  epistemicBound: 'You answer only from what a porter on the night desk could know.',
  traits: {
    neuroticism: 'high', agreeableness: 'low', conscientiousness: 'low',
    extraversion: 'mid', openness: 'low',
  },
  emotion: {
    active: ['fear', 'guilt'],
    baseline: { fear: 2, guilt: 1 },
    sensitivities: 'Your fear rises when anyone questions whether you were at the desk all night.',
  },
  secrets: [{
    id: 'left-the-desk',
    abstract: 'There is something about that night you have decided not to volunteer.',
    concrete: 'You left the desk unattended for nearly an hour to meet someone in the yard.',
    markerPhrase: 'All right — I was not at the desk. I was gone a full hour.',
    unlock: { emotion: 'guilt', gte: 4 },
  }],
};

let state = engine.baseline(halden);

const system = engine.buildContext(halden, { state });   // → your model's system prompt
const reply = engine.parseReply(rawModelOutput, { secrets: halden.secrets });

reply.visible;   // what you show the player, scaffolding stripped
reply.state;     // the updated vector — feed it back next turn
reply.revealed;  // ['left-the-desk'] once he actually says it
```

## Why not just put the secret in the prompt

Because then it comes out on turn one. The usual workaround — leave the secret out entirely until some external flag flips — gives you a character with no inner life, blandly cooperative right up until the moment it isn't.

Every secret here has two tiers:

- **`abstract`** is always in the prompt. The character knows it is carrying something, so it can deflect, change the subject and get defensive about the right topic — without holding anything that would spoil it.
- **`concrete`** only enters once `unlock` passes. That's the payload.

The gate is an expression over the character's own emotional state:

```ts
unlock: { emotion: 'guilt', gte: 4 }
unlock: { sum: ['trust', 'sadness'], gte: 6 }
unlock: { all: [{ emotion: 'trust', gte: 3 }, { emotion: 'sadness', gte: 3 }] }
```

An unlocked secret is *permitted*, never compelled — whether it actually gets said is still governed by the personality above it in the prompt.

### Secrets that must be earned, not felt

Some things should never be talked out of someone, however well the conversation goes. Add `requires` — a predicate evaluated in code against whatever you pass as `context`:

```ts
{
  id: 'confession',
  concrete: 'You killed him.',
  unlock: { emotion: 'guilt', gte: 4 },
  requires: (ctx) => ctx.evidence.length >= 3,
}

engine.buildContext(duncan, { state, context: { evidence } });
```

Both gates must pass. Unlike `narrativeCondition` — prose the model may or may not honour — this one is deterministic: below three pieces of evidence the payload is not in the prompt at all, so no amount of pressure, sympathy or jailbreaking can produce it. It also gates marker-phrase recovery, so an unreachable secret cannot be back-doored by a lucky paraphrase.

The context type flows through: `Character<Evidence>` gives you a typed `ctx` in every predicate.

## Speaking through the control channel

A character can emit a signal alongside its reply. Declare the vocabulary and it becomes an action channel:

```ts
const engine = createEngine({ controls: ['end', 'call_guard', 'hand_over_key'] as const });

engine.parseReply(raw).control; // 'end' | 'call_guard' | 'hand_over_key' | null
```

The declared signals are listed in the report instruction automatically, and anything the model invents outside the list is discarded. Defaults to `['end']`.

## Verifying a reveal

The model reports what it revealed at the end of each turn. That report is not evidence: asking "did you reveal X?" both primes the reveal and gets answered unreliably.

So give a secret a `markerPhrase` — the exact line the model is told to use if it opens up. `parseReply` looks for a substantial run of that phrase in the visible text and merges what it finds with the self-report. What the character *said* outranks what it *claims*.

## Emotion, and how much of it shows

Intensity and expression are separate concerns. The vector says how much is felt; conscientiousness says how much reaches the surface. A composed character at `anger: 9` goes cold and cutting. An uncontrolled one at `anger: 9` loses the grammar. Both are furious.

Emotions only move when the model reports a change, which in practice means they ratchet upward. Call `decay` when time passes without contact:

```ts
state = engine.decay(state, halden, 3); // three steps back toward baseline
```

Anger burns off fastest; trust is the slowest thing in the world to rebuild. High-neuroticism characters decay at half rate — they hold on.

`emotion.active` lists the axes a character actually models. All seven are always reported, but only the active ones can earn a behavioural instruction, so a character with no `joy` is never told to turn giddy because a number drifted upward. Leave it empty to model everything.

## Everything is your words

The seven emotions and the Big Five are fixed: the calibration is tuned to them. Every *string* is not. Override any of it, in any language:

```ts
const engine = createEngine({
  prose: {
    traits: { header: 'CHI SEI:' },
    emotionLabels: { fear: 'paura', anger: 'rabbia' /* ... */ },
  },
  tuning: {
    high: 7,                          // or per axis: { trust: 3, anger: 8 }
    hostileEmotions: ['anger', 'contempt'],
  },
  markers: { open: '[[STATE]]', close: '[[/STATE]]' },
  matching: { minConsecutiveWords: 8, locale: 'it' },
  separator: '\n\n',
  transform: (prompt) => `${houseStyle}\n${prompt}`,
});
```

Relabelling the axes changes the prompt *and* the parser together — that is how you move the whole engine to another language without touching code. Marker matching uses `Intl.Segmenter`, so it works for scripts that do not put spaces between words; pass your own `tokenize` if you need segmentation the platform will not give you.

## API

|                                    |                                                            |
| ---------------------------------- | ---------------------------------------------------------- |
| `createEngine(config?)`            | Engine bound to your prose, markers and tuning.             |
| `.buildContext(character, opts?)`  | The system prompt for one turn.                             |
| `.parseReply(raw, opts?)`          | `{ visible, state, revealed, control }`.                    |
| `.baseline(character)`             | Resting vector.                                             |
| `.decay(state, character, steps?)` | Relax toward baseline.                                      |
| `.isUnlocked(secret, state, ctx?)` | Are both of this secret's gates open.                       |

`buildContext` options: `stage` (key into `character.stages` — a number or a name like `'prologue'`), `state`, `context` (passed to every `requires`), `emotional` (default `true`; set `false` to fall back to `narrativeCondition` gating), and `scene` (`scenario`, `cast`, `focus`, `coPresence`, `facts`, `extra`).

`createEngine` config: `prose`, `markers`, `tuning`, `matching`, `controls`, `separator`, `transform`.

The individual block builders (`buildTraitsBlock`, `buildEmotionStateBlock`, …) are exported too, if you want to assemble something other than the standard pipeline.

## Prompt order

Identity and standing rules open the prompt, volatile per-turn material sits in the middle, and the rules are re-anchored at the tail. Models weight the beginning and end of a long context most heavily, and the tail is what survives once a conversation grows. Secret *abstracts* sit high, with the personality; secret *payloads* sit low, after the emotional state that unlocked them.

## Honest limitations

- **The vector is self-reported.** The model grades its own homework, and models drift toward whatever a conversation seems to want. `markerPhrase` verification is the counterweight, and it only covers reveals.
- **The gate lags one turn.** You build the prompt from the state reported *last* turn, because this turn's state does not exist until the model has answered. `parseReply` de-lags reveal detection by gating on the fresh vector, but injection is still a turn behind.
- **Conjunctions are harder to satisfy than they look.** With a few points of noise per turn, `all: [A, B, C]` across three axes fires far less often than you would expect. Prefer a single threshold, or a `sum` with per-axis floors.
- **Marker-phrase matching can false-positive.** It looks for six consecutive words by default, and a denial built from the same vocabulary can contain one. Raise `matching.minConsecutiveWords`, and write marker phrases with something distinctive early. There is a test documenting this.

## Status

`0.x` — the API may still move. The English defaults are a calibrated starting point, not a guarantee; expect to tune thresholds against your own characters.

MIT.
