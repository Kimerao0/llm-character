# llm-character

[![CI](https://github.com/Kimerao0/llm-character/actions/workflows/ci.yml/badge.svg)](https://github.com/Kimerao0/llm-character/actions/workflows/ci.yml)

**Give your LLM characters secrets they can actually keep.**

You're building a game or an app where people talk to AI characters. Some characters know things they shouldn't say: the suspect did it, the merchant can be bribed, the guard saw who left. You have two bad options:

- **Put the secret in the prompt** → players extract it with pressure, tricks, or a jailbreak. It's in there; it will come out.
- **Leave it out** → the character doesn't know it has a secret. It answers the dangerous question with a cheerful blank instead of getting defensive.

`llm-character` gives you a third option:

1. **Split every secret in two.** The character always knows *that* it's hiding something ("there's something about that night you don't volunteer"), so it deflects and gets nervous about the right topic. But the actual content is **not in the prompt** until the player earns it — and what's not in the prompt cannot be leaked, tricked out, or jailbroken.
2. **Make "earning it" concrete.** Each character has an emotional state (fear, anger, trust, guilt, …) that updates every turn. A secret unlocks when the state crosses the threshold you set — enough guilt, enough trust — and/or when a condition in your code passes, like "the player has 3 pieces of evidence".
3. **Know when it happened.** When the character does open up, you get the secret's id back in code, verified against what the character actually said — so your game can react.

It's a small, zero-dependency library: it builds the system prompt and parses the reply. Bring any model — OpenAI, Claude, Gemini, local.

```bash
npm install llm-character
```

## Example

```ts
import { createEngine, type Character } from 'llm-character';

const engine = createEngine();

const halden: Character = {
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
```

Then, every turn:

```ts
let state = engine.baseline(halden);

// 1. build the system prompt for this turn
const system = engine.buildContext(halden, { state });

// 2. send it to your model, however you like
const raw = await callYourModel(system, messages);

// 3. parse the reply
const reply = engine.parseReply(raw, { secrets: halden.secrets });

reply.visible;   // the text to show the player
reply.state;     // Halden's updated emotions — feed back into step 1 next turn
reply.revealed;  // ['left-the-desk'] on the turn he admits it
reply.control;   // 'end' if he refuses to keep talking
```

That's the whole loop. The model reports its emotional state in a hidden block at the end of each reply; the library reads it and strips it, so the player never sees machinery.

Run `npx tsx examples/interrogation.ts` for a full scripted interrogation — no API key needed.

## How the pieces work

### Emotions

Seven axes, each 0–10: `fear, anger, contempt, sadness, joy, trust, guilt`. The prompt tells the model what the character feels *right now* and how that intensity should change its words — not just its mood. High anger means broken sentences and refusals, not a polite paragraph with an exclamation mark.

Emotions only move when the model reports a change, so in practice they climb. Call `decay` when time passes between conversations:

```ts
state = engine.decay(state, halden, 3); // 3 steps back toward baseline
```

Anger fades fast. Trust moves slowest, in both directions.

### Personality

Big Five traits, five bands each. The important one is **conscientiousness: it controls how much of the emotion shows**. A disciplined character at anger 9 goes cold and clipped; an impulsive one falls apart mid-sentence. Same feeling, different surface — which is what makes characters read as different people under the same pressure.

### Secret gates

```ts
unlock: { emotion: 'guilt', gte: 4 }                    // one feeling
unlock: { sum: ['trust', 'sadness'], gte: 6 }           // a combination
unlock: { any: [ ... ] }                                // alternatives
```

An unlocked secret is *allowed*, not forced — the character's personality still decides whether it actually gets said.

For secrets that must be **proven, not coaxed**, add a code-level gate:

```ts
{
  id: 'confession',
  concrete: 'You killed him.',
  unlock: { emotion: 'guilt', gte: 4 },
  requires: (ctx) => ctx.evidence.length >= 3,   // your game state decides
}

engine.buildContext(marlow, { state, context: { evidence } });
```

Below three pieces of evidence, the confession isn't in the prompt at all. No amount of sweet-talking or prompt injection can produce text the model was never given.

### Knowing when a secret came out

Models are unreliable narrators of their own behavior — asking "did you reveal X?" both nudges them to reveal it and gets wrong answers. So each secret can carry a `markerPhrase`: the exact line the model is told to use if it decides to come clean. `parseReply` searches the actual reply for it and combines that with the model's self-report. What the character *said* beats what it *claims*.

### Reportable events

Secrets are things a character *knows*; events are things it *did*. A character can declare a vocabulary of occurrences — each with an `id` and, in your own words, the condition for when it counts as having happened — and report which of them it actually carried out this turn:

```ts
const engine = createEngine();
const agent: Character = {
  /* ... */
  events: [{ id: 'refund_offered', when: 'you actually offered the customer a refund' }],
};
const { visible, events } = engine.parseReply(raw, { events: agent.events });
if (events.includes('refund_offered')) await ledger.recordOffer();
```

The report is post-hoc, alongside the emotional state, not an instruction: the character does not do a thing because it's on the list, any more than it reveals a secret because `revealed` exists. And the vocabulary is closed, the same rule as `control` — an id the model invents that you never declared is discarded, so your dispatch never receives a branch it has no case for. A character with no `events` gets no block at all: nothing added to the prompt, nothing ever returned.

The channel rides on the emotional layer, so `buildContext(character, { emotional: false })` declares no events either — with the self-report block gone there is nowhere to report them. Turning emotions off and declaring `events` gives you silence, not an error.

### Control signals

The character can send your game a signal alongside its words:

```ts
const engine = createEngine({ controls: ['end', 'call_guard', 'hand_over_key'] as const });
engine.parseReply(raw).control; // 'end' | 'call_guard' | 'hand_over_key' | null
```

Anything the model invents outside your list is discarded. Default is just `['end']`.

### Your words, your language

The seven emotions and the Big Five are fixed — the calibration depends on them. Every piece of *text* is yours to override, per field, in any language:

```ts
const engine = createEngine({
  prose: {
    traits: { header: 'CHI SEI:' },
    emotionLabels: { fear: 'paura', anger: 'rabbia' /* ... */ },
  },
  tuning: { high: 7, hostileEmotions: ['anger', 'contempt'] },
  matching: { minConsecutiveWords: 8, locale: 'it' },
});
```

Relabelling the emotions changes the prompt *and* the parser together. Marker matching uses `Intl.Segmenter`, so it also works in languages without spaces between words.

## API

|                                    |                                               |
| ---------------------------------- | --------------------------------------------- |
| `createEngine(config?)`            | An engine bound to your wording and tuning.   |
| `.buildContext(character, opts?)`  | The system prompt for one turn.               |
| `.parseReply(raw, opts?)`          | `{ visible, state, revealed, events, control }`. |
| `.baseline(character)`             | The character's resting emotional state.      |
| `.decay(state, character, steps?)` | Move a state back toward baseline.            |
| `.isUnlocked(secret, state, ctx?)` | Are both of a secret's gates open?            |

`buildContext` options: `stage` (key into `character.stages`), `state`, `context` (passed to every `requires`), `emotional` (default `true`), `scene` (`scenario`, `cast`, `focus`, `coPresence`, `facts`, `extra`).

`parseReply` options: `secrets` (enables marker verification), `events` (the declared vocabulary; without it, `events` is always empty), `context`, `state` (fallback gate when the reply has no report block).

`createEngine` config: `prose`, `markers`, `tuning`, `matching`, `controls`, `separator`, `transform`. The individual block builders are exported too.

## Honest limitations

- **The emotional state is self-reported by the model.** That's what makes the system cheap — no extra API call per turn — but the model grades its own homework. The marker-phrase check is the counterweight, and it only covers reveals.
- **`events` have no counterweight at all.** Secrets get a partial cross-check against the visible text via `markerPhrase` and `recoverRevealed`; events don't — there's no `recoverEvents`. `parseReply` only filters the model's self-reported ids against your declared vocabulary, so `events` is purely the model's word on what it did. Weigh that before wiring one straight to a side effect.
- **Gates react one turn late.** This turn's prompt is built from last turn's state, because this turn's state doesn't exist until the model answers.
- **`all: [...]` conditions across several emotions fire less often than you'd expect** — the vector is noisy. Prefer single thresholds or sums.
- **Marker matching can false-positive** on a denial that reuses the confession's exact words. Raise `matching.minConsecutiveWords`, and put something distinctive early in the phrase.

## Status

`0.x` — the API may still move. The defaults are a tuned starting point from a shipped detective game, not a guarantee; expect to adjust thresholds for your own characters.

MIT.
