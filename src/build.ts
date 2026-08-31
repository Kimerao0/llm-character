import type { BuildOptions, Character, Secret } from './types';
import type { Markers, Prose, Tuning } from './prose';
import { baselineVector, evaluateUnlock } from './emotions';
import {
  buildCore,
  buildEmotionProfileBlock,
  buildEmotionStateBlock,
  buildReportSkeleton,
  buildTraitsBlock,
} from './blocks';

/**
 * Assemble the system prompt.
 *
 * Order is load-bearing. Identity and the standing rules open the prompt, the
 * volatile per-turn material sits in the middle, and the rules are re-anchored at
 * the tail — models weight the beginning and end of a long context most heavily,
 * and the tail is what survives once the conversation grows.
 *
 * Every secret contributes its `abstract` in the CHARACTER slab, so the character
 * always knows it is carrying something. Only an unlocked secret contributes its
 * `concrete`, and only in the EMOTIONAL slab, well after the personality that
 * governs whether it actually gets said.
 */
export function buildContext(
  character: Character,
  options: BuildOptions,
  prose: Prose,
  markers: Markers,
  tuning: Tuning
): string {
  const parts: string[] = [];
  const secrets: readonly Secret[] = character.secrets ?? [];
  const emotional = options.emotional ?? true;
  const scene = options.scene ?? {};

  // 1 — core: who you are, what binds you, the standing rules
  parts.push(buildCore(character, prose));

  // 2 — character: stable disposition
  parts.push(buildTraitsBlock(character.traits, prose));
  if (character.emotion.active.length > 0) parts.push(buildEmotionProfileBlock(character.emotion, prose));
  if (character.relationships) parts.push(character.relationships);
  if (character.voice) parts.push(character.voice);
  if (character.background) parts.push(character.background);
  for (const secret of secrets) parts.push(secret.abstract);

  // 3 — scene
  if (scene.scenario) parts.push(scene.scenario);
  if (scene.cast) parts.push(prose.scene.cast(scene.cast));
  if (scene.focus) parts.push(scene.focus);
  for (const block of scene.extra ?? []) parts.push(block);

  // 4 — character in time
  const stageText = options.stage === undefined ? undefined : character.stages?.[options.stage];
  if (stageText) parts.push(stageText);

  // 5 — emotional layer, or plain narrative gating when it is off
  if (emotional) {
    const state = options.state ?? baselineVector(character.emotion);
    parts.push(buildEmotionStateBlock(state, character.traits, prose, tuning));
    for (const secret of secrets) {
      if (evaluateUnlock(secret.unlock, state)) parts.push(prose.secrets.reveal(secret, markers.secretTag));
    }
    parts.push(
      prose.report(
        buildReportSkeleton(prose, markers.open, markers.close),
        markers.open,
        markers.close,
        markers.secretTag
      )
    );
  } else {
    for (const secret of secrets) parts.push(prose.secrets.narrativeGated(secret));
  }

  // 6 — who else is here, and the facts everyone must agree on
  if (scene.coPresence) parts.push(scene.coPresence);
  if (scene.facts) parts.push(scene.facts);

  // 7 — re-anchor
  parts.push(prose.coreReanchor);

  return parts.join('\n').trim();
}
