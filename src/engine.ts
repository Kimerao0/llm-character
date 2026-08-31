import type {
  BuildOptions,
  Character,
  EmotionVector,
  ParsedReply,
  Secret,
  UnlockCondition,
} from './types';
import type {
  DeepPartial,
  EngineConfig,
  Markers,
  MatchingConfig,
  Prose,
  ResolvedTuning,
} from './prose';
import { defaultMatching, enMarkers, enProse } from './defaults/en';
import { buildContext, gatesOpen, type BuildDeps } from './build';
import { parseReply, type ParseOptions } from './parse';
import { resolveTuning } from './blocks';
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

/** Everything needed for `baseline` and `decay` — no secrets, so no context type. */
type EmotionalShape = Pick<Character<unknown>, 'emotion' | 'traits'>;

export interface CharacterEngine<TControl extends string = 'end'> {
  readonly prose: Prose;
  readonly markers: Markers;
  readonly tuning: ResolvedTuning;
  readonly matching: MatchingConfig;
  readonly controls: readonly TControl[];

  /** Assemble the system prompt for one turn. */
  buildContext<TContext = unknown>(character: Character<TContext>, options?: BuildOptions<TContext>): string;

  /**
   * Split a raw reply into visible text, updated state, and revealed secret ids.
   * Pass the character's secrets to enable marker-phrase verification.
   */
  parseReply<TContext = unknown>(raw: string, options?: ParseOptions<TContext>): ParsedReply<TControl>;

  /** A character's resting state. */
  baseline(character: EmotionalShape): EmotionVector;

  /** Relax a state back toward the character's baseline by `steps`. */
  decay(state: EmotionVector, character: EmotionalShape, steps?: number): EmotionVector;

  /** Whether both of a secret's gates are open. */
  isUnlocked<TContext = unknown>(secret: Secret<TContext>, state: EmotionVector, context?: TContext): boolean;

  /** Evaluate any unlock expression directly. */
  evaluate(condition: UnlockCondition, state: EmotionVector): boolean;
}

/**
 * Build an engine bound to your wording and calibration.
 *
 * Everything is optional — `createEngine()` gives you the English defaults, which
 * are what the calibration was tuned against. Overrides are merged field by field,
 * so replacing one line of prose does not mean restating the rest.
 *
 * Declaring `controls` widens the control channel and narrows its type:
 *
 *   const engine = createEngine({ controls: ['end', 'call_guard'] as const });
 *   engine.parseReply(raw).control; // 'end' | 'call_guard' | null
 */
export function createEngine<TControl extends string = 'end'>(
  config: EngineConfig<TControl> = {}
): CharacterEngine<TControl> {
  const prose = deepMerge(enProse, config.prose);
  const markers: Markers = { ...enMarkers, ...config.markers };
  const tuning = resolveTuning(config.tuning);
  const matching: MatchingConfig = { ...defaultMatching, ...config.matching };
  const controls = config.controls ?? (['end'] as unknown as readonly TControl[]);
  const separator = config.separator ?? '\n';

  const buildDeps: BuildDeps = { prose, markers, tuning, controls, separator, transform: config.transform };

  return {
    prose,
    markers,
    tuning,
    matching,
    controls,
    buildContext: (character, options = {}) => buildContext(character, options, buildDeps),
    parseReply: (raw, options = {}) => parseReply(raw, { prose, markers, matching, controls }, options),
    baseline: (character) => baselineVector(character.emotion),
    decay: (state, character, steps = 1) =>
      decayEmotions(state, character.emotion.baseline, character.traits, steps, tuning),
    isUnlocked: (secret, state, context) => gatesOpen(secret, state, context as never),
    evaluate: (condition, state) => evaluateUnlock(condition, state),
  };
}
