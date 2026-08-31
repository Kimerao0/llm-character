/**
 * The full loop, with the model faked so it runs anywhere:
 *
 *   npx tsx examples/interrogation.ts
 *
 * Watch the secret stay shut, the state move, the gate open, and the reveal get
 * caught from the text rather than taken on trust.
 */
import { createEngine, type Character, type EmotionVector } from '../src';

const engine = createEngine();

const halden: Character = {
  identity: 'You are Halden, night porter at the Ardwick Hotel. You are speaking to an inspector.',
  epistemicBound: 'You answer only from what a porter on the night desk could know.',
  traits: {
    neuroticism: 'high',
    agreeableness: 'low',
    conscientiousness: 'low',
    extraversion: 'mid',
    openness: 'low',
  },
  emotion: {
    active: ['fear', 'guilt', 'anger'],
    baseline: { fear: 2, guilt: 1 },
    sensitivities: 'Your fear rises when anyone questions whether you were at the desk all night.',
  },
  voice: 'Clipped and deferential. You fill silences with irrelevant detail when you are nervous.',
  secrets: [
    {
      id: 'left-the-desk',
      abstract: 'There is something about that night you have decided not to volunteer.',
      concrete: 'You left the desk unattended for nearly an hour to meet someone in the yard.',
      markerPhrase: 'All right — I was not at the desk. I was gone a full hour.',
      unlock: { emotion: 'guilt', gte: 4 },
    },
  ],
};

const report = (v: Partial<EmotionVector>, revealed: string[] = []) =>
  `<<<EMO>>>${JSON.stringify({
    emotions: { fear: 0, anger: 0, contempt: 0, sadness: 0, joy: 0, trust: 0, guilt: 0, ...v },
    revealed,
    control: null,
  })}<<<END>>>`;

/** Stand-in for the model. Replace with a real call and nothing else changes. */
const fakeModel = (turn: number): string =>
  [
    `I was at the desk the whole night, inspector. Same as every night. ${report({ fear: 4, guilt: 2 })}`,
    `(His hands go still on the register.) The yard door? It... it sticks, that one. ${report({ fear: 6, guilt: 5 })}`,
    `All right — I was not at the desk. I was gone a full hour. ${report({ fear: 7, guilt: 8 })}`,
  ][turn]!;

const line = (label: string) => console.log(`\n${'─'.repeat(64)}\n${label}\n${'─'.repeat(64)}`);

let state = engine.baseline(halden);
const revealed = new Set<string>();

line('TURN 0 — the prompt at baseline');
const opening = engine.buildContext(halden, { state });
console.log(`prompt length: ${opening.length} chars`);
console.log(`payload in prompt? ${opening.includes('left the desk unattended')}   (guilt ${state.guilt} < 4)`);

for (let turn = 0; turn < 3; turn++) {
  const prompt = engine.buildContext(halden, { state });
  const raw = fakeModel(turn);
  const parsed = engine.parseReply(raw, { secrets: halden.secrets, state });

  line(`TURN ${turn + 1}`);
  console.log(`gate open in this turn's prompt: ${prompt.includes('left the desk unattended')}`);
  console.log(`\nHalden: ${parsed.visible}`);

  if (parsed.state) {
    const moved = (Object.keys(parsed.state) as (keyof EmotionVector)[])
      .filter((k) => parsed.state![k] !== state[k])
      .map((k) => `${k} ${state[k]}→${parsed.state![k]}`);
    console.log(`\nstate: ${moved.join(', ') || 'unchanged'}`);
    state = parsed.state;
  }

  for (const id of parsed.revealed) {
    if (!revealed.has(id)) {
      revealed.add(id);
      // Note: turn 3's report claims nothing. This is recovered from the text.
      console.log(`\n>>> REVEALED: ${id}  (recovered from the marker phrase, not self-reported)`);
    }
  }
}

line('AFTERWARDS — he is left alone for a while');
const cooled = engine.decay(state, halden, 4);
console.log(`fear ${state.fear}→${cooled.fear}, guilt ${state.guilt}→${cooled.guilt}`);
console.log('(high neuroticism, so he decays at half rate — he holds on to it)\n');
