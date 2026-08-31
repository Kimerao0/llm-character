import { EMOTIONS, type EmotionProfile, type EmotionVector, type Traits, type UnlockCondition } from './types';
import type { Tuning } from './prose';
import { defaultTuning } from './defaults/en';

/** Only the fields decay actually reads — accepts raw or resolved tuning alike. */
type DecayTuning = Pick<Tuning, 'decayPerStep' | 'slowDecayFactor'>;

/** Evaluate an unlock expression against a state vector. */
export function evaluateUnlock(condition: UnlockCondition, state: EmotionVector): boolean {
  if ('emotion' in condition) return (state[condition.emotion] ?? 0) >= condition.gte;
  if ('sum' in condition) return condition.sum.reduce((acc, e) => acc + (state[e] ?? 0), 0) >= condition.gte;
  if ('all' in condition) return condition.all.every((child) => evaluateUnlock(child, state));
  return condition.any.some((child) => evaluateUnlock(child, state));
}

/** A character's resting state — every axis present, unset ones at 0. */
export function baselineVector(profile: EmotionProfile): EmotionVector {
  const out = {} as EmotionVector;
  for (const emotion of EMOTIONS) out[emotion] = profile.baseline[emotion] ?? 0;
  return out;
}

/** Clamp every axis into 0-10. */
export function clampVector(state: EmotionVector): EmotionVector {
  const out = {} as EmotionVector;
  for (const emotion of EMOTIONS) out[emotion] = Math.min(10, Math.max(0, state[emotion] ?? 0));
  return out;
}

/**
 * Pull an aroused state back toward baseline by `steps`.
 *
 * Call this when time passes without contact — the player leaves the room, a scene
 * ends. Without it, emotions only ever move when the model volunteers a decrease,
 * which in practice means they ratchet upward and never come back down.
 *
 * High neuroticism decays at `slowDecayFactor`: those characters hold on longer.
 * Emotions never decay below baseline, only toward it.
 */
export function decayEmotions(
  state: EmotionVector,
  baseline: Partial<EmotionVector>,
  traits: Traits,
  steps: number,
  tuning: DecayTuning = defaultTuning
): EmotionVector {
  const slow = traits.neuroticism === 'high' || traits.neuroticism === 'very_high';
  const factor = slow ? tuning.slowDecayFactor : 1;
  const out = { ...state };
  for (const emotion of EMOTIONS) {
    const floor = baseline[emotion] ?? 0;
    const current = out[emotion] ?? 0;
    if (current > floor) {
      out[emotion] = Math.max(floor, current - tuning.decayPerStep[emotion] * factor * steps);
    }
  }
  return out;
}
