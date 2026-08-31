import { EMOTIONS, TRAITS, type Character, type EmotionProfile, type EmotionVector, type Traits } from './types';
import type { Prose, Tuning } from './prose';

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

/**
 * The live state block. Intensity and expression are deliberately separate
 * concerns here: the values say how much is felt, the conscientiousness gate says
 * how much of it reaches the surface. A composed character at anger 9 goes cold
 * and cutting; an uncontrolled one at anger 9 loses the grammar.
 */
export function buildEmotionStateBlock(state: EmotionVector, traits: Traits, prose: Prose, tuning: Tuning): string {
  const values = EMOTIONS.map((emotion) => `${prose.emotionLabels[emotion]}: ${state[emotion]}`).join(', ');
  const parts: string[] = [prose.emotions.stateHeader(values), prose.emotions.directive];

  const high = EMOTIONS.filter((emotion) => (state[emotion] ?? 0) >= tuning.high);
  if (high.length > 0) {
    parts.push(prose.emotions.highHeader);
    for (const emotion of high) {
      const value = state[emotion] ?? 0;
      const behavior =
        value >= tuning.extreme ? prose.emotions.extremeBehavior[emotion] : prose.emotions.highBehavior[emotion];
      parts.push(prose.emotions.behaviorLine(prose.emotionLabels[emotion], value, behavior));
    }
    parts.push(prose.emotions.dominance);
  }

  const mid = EMOTIONS.filter(
    (emotion) => (state[emotion] ?? 0) >= tuning.midLow && (state[emotion] ?? 0) < tuning.high
  );
  if (mid.length > 0) {
    parts.push(prose.emotions.midLevel(mid.map((emotion) => prose.emotionLabels[emotion])));
  }

  const c = traits.conscientiousness;
  if (c === 'low' || c === 'very_low') parts.push(prose.emotions.control.low);
  else if (c === 'high' || c === 'very_high') parts.push(prose.emotions.control.high);
  else parts.push(prose.emotions.control.mid);

  if ((state.anger ?? 0) >= tuning.hostility || (state.contempt ?? 0) >= tuning.hostility) {
    parts.push(prose.emotions.hostility);
  }

  return parts.join('\n');
}

/** The exact line the model is asked to emit, built from the configured labels and markers. */
export function buildReportSkeleton(prose: Prose, open: string, close: string): string {
  const emotions = EMOTIONS.map((emotion) => `"${prose.emotionLabels[emotion]}":N`).join(',');
  return `${open}{"emotions":{${emotions}},"revealed":[],"control":null}${close}`;
}
