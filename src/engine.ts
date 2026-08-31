import type {
  BuildOptions,
  Character,
  EmotionVector,
  ParsedReply,
  Secret,
  UnlockCondition,
} from './types';
import type { DeepPartial, EngineConfig, Markers, Prose, Tuning } from './prose';
import { defaultTuning, enMarkers, enProse } from './defaults/en';
import { buildContext } from './build';
import { parseReply, type ParseOptions } from './parse';
import { baselineVector, decayEmotions, evaluateUnlock } from './emotions';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Merge overrides over defaults. Functions and arrays are replaced wholesale, not merged. */
export function deepMerge<T>(base: T, override?: DeepPartial<T>): T {
  if (!override) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isPlainObject(value) && isPlainObject(current) ? deepMerge(current, value) : value;
  }
  return out as T;
}

export interface CharacterEngine {
  readonly prose: Prose;
  readonly markers: Markers;
  readonly tuning: Tuning;

  /** Assemble the system prompt for one turn. */
  buildContext(character: Character, options?: BuildOptions): string;

  /**
   * Split a raw reply into visible text, updated state, and revealed secret ids.
   * Pass the character's secrets to enable marker-phrase verification.
   */
  parseReply(raw: string, options?: ParseOptions): ParsedReply;

  /** A character's resting state. */
  baseline(character: Character): EmotionVector;

  /** Relax a state back toward the character's baseline by `steps`. */
  decay(state: EmotionVector, character: Character, steps?: number): EmotionVector;

  /** Whether a secret's gate is currently open. */
  isUnlocked(secret: Secret, state: EmotionVector): boolean;

  /** Evaluate any unlock expression directly. */
  evaluate(condition: UnlockCondition, state: EmotionVector): boolean;
}

/**
 * Build an engine bound to your wording and calibration.
 *
 * Everything is optional — `createEngine()` gives you the English defaults, which
 * are what the calibration was tuned against. Overrides are merged field by field,
 * so replacing one line of prose does not mean restating the rest.
 */
export function createEngine(config: EngineConfig = {}): CharacterEngine {
  const prose = deepMerge(enProse, config.prose);
  const markers: Markers = { ...enMarkers, ...config.markers };
  const tuning: Tuning = {
    ...defaultTuning,
    ...config.tuning,
    decayPerStep: { ...defaultTuning.decayPerStep, ...config.tuning?.decayPerStep },
  };

  return {
    prose,
    markers,
    tuning,
    buildContext: (character, options = {}) => buildContext(character, options, prose, markers, tuning),
    parseReply: (raw, options = {}) => parseReply(raw, prose, markers, options),
    baseline: (character) => baselineVector(character.emotion),
    decay: (state, character, steps = 1) =>
      decayEmotions(state, character.emotion.baseline, character.traits, steps, tuning),
    isUnlocked: (secret, state) => evaluateUnlock(secret.unlock, state),
    evaluate: (condition, state) => evaluateUnlock(condition, state),
  };
}
