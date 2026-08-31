import {
  EMOTIONS,
  TRAITS,
  type Character,
  type Emotion,
  type EmotionProfile,
  type EmotionVector,
  type Traits,
} from './types';
import type { Prose, ResolvedTuning, Threshold, Tuning } from './prose';
import { defaultTuning } from './defaults/en';

/** Expand a threshold that may be uniform or per-emotion into a full record. */
function expand(value: Threshold | undefined, fallback: number): Record<Emotion, number> {
  const out = {} as Record<Emotion, number>;
  for (const emotion of EMOTIONS) {
    out[emotion] = typeof value === 'number' ? value : (value?.[emotion] ?? fallback);
  }
  return out;
}

/** Normalise user-supplied tuning into the shape the builders consume. */
export function resolveTuning(tuning: Partial<Tuning> = {}): ResolvedTuning {
  return {
    high: expand(tuning.high, defaultTuning.high as number),
    extreme: expand(tuning.extreme, defaultTuning.extreme as number),
    midLow: expand(tuning.midLow, defaultTuning.midLow as number),
    hostility: expand(tuning.hostility, defaultTuning.hostility as number),
    hostileEmotions: tuning.hostileEmotions ?? defaultTuning.hostileEmotions,
    decayPerStep: { ...defaultTuning.decayPerStep, ...tuning.decayPerStep },
    slowDecayFactor: tuning.slowDecayFactor ?? defaultTuning.slowDecayFactor,
  };
}

export function buildCore(character: Pick<Character, 'identity' | 'epistemicBound'>, prose: Prose): string {
  return `${character.identity} ${character.epistemicBound} ${prose.behaviorRules}`;
}

export function buildTraitsBlock(traits: Traits, prose: Prose): string {
  const lines = TRAITS.map((trait) =>
    prose.traits.line(prose.traits.guidance[trait], prose.traits.bandLabels[traits[trait]])
  );
  return `${prose.traits.header}\n${lines.join('\n')}`;
}

export function buildEmotionProfileBlock(profile: EmotionProfile, prose: Prose): string {
  const labels = profile.active.map((emotion) => prose.emotionLabels[emotion]);
  return prose.emotions.activeHeader(labels, profile.sensitivities);
}

export interface StateBlockOptions {
  prose: Prose;
  tuning: ResolvedTuning;
  /**
   * Emotions modelled for this character. Only these earn behavioural
   * instructions. Empty or omitted means all seven.
   */
  active?: readonly Emotion[];
  /** Control vocabulary, so the hostility clause can offer the right escape. */
  controls?: readonly string[];
}

/**
 * The live state block. Intensity and expression are deliberately separate
 * concerns here: the values say how much is felt, the conscientiousness gate says
 * how much of it reaches the surface. A composed character at anger 9 goes cold
 * and cutting; an uncontrolled one at anger 9 loses the grammar.
 *
 * The full vector is always listed, so the report contract stays stable, but only
 * a character's `active` emotions can earn a behavioural instruction — nobody gets
 * told to turn giddy because an axis they do not model drifted upward.
 */
export function buildEmotionStateBlock(
  state: EmotionVector,
  traits: Traits,
  options: StateBlockOptions
): string {
  const { prose, tuning, active, controls = ['end'] } = options;
  const modelled = active && active.length > 0 ? EMOTIONS.filter((e) => active.includes(e)) : EMOTIONS;
  const at = (emotion: Emotion): number => state[emotion] ?? 0;

  const values = EMOTIONS.map((emotion) => `${prose.emotionLabels[emotion]}: ${at(emotion)}`).join(', ');
  const parts: string[] = [prose.emotions.stateHeader(values), prose.emotions.directive];

  const high = modelled.filter((emotion) => at(emotion) >= tuning.high[emotion]);
  if (high.length > 0) {
    parts.push(prose.emotions.highHeader);
    for (const emotion of high) {
      const behavior =
        at(emotion) >= tuning.extreme[emotion]
          ? prose.emotions.extremeBehavior[emotion]
          : prose.emotions.highBehavior[emotion];
      parts.push(prose.emotions.behaviorLine(prose.emotionLabels[emotion], at(emotion), behavior));
    }
    parts.push(prose.emotions.dominance);
  }

  const mid = modelled.filter(
    (emotion) => at(emotion) >= tuning.midLow[emotion] && at(emotion) < tuning.high[emotion]
  );
  if (mid.length > 0) {
    parts.push(prose.emotions.midLevel(mid.map((emotion) => prose.emotionLabels[emotion])));
  }

  const c = traits.conscientiousness;
  if (c === 'low' || c === 'very_low') parts.push(prose.emotions.control.low);
  else if (c === 'high' || c === 'very_high') parts.push(prose.emotions.control.high);
  else parts.push(prose.emotions.control.mid);

  const hostile = tuning.hostileEmotions.filter((emotion) => modelled.includes(emotion));
  if (hostile.some((emotion) => at(emotion) >= tuning.hostility[emotion])) {
    parts.push(prose.emotions.hostility(controls));
  }

  return parts.join('\n');
}

/** The exact line the model is asked to emit, built from the configured labels and markers. */
export function buildReportSkeleton(prose: Prose, open: string, close: string): string {
  const emotions = EMOTIONS.map((emotion) => `"${prose.emotionLabels[emotion]}":N`).join(',');
  return `${open}{"emotions":{${emotions}},"revealed":[],"control":null}${close}`;
}
