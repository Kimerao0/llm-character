import type { BuildOptions, Character, EmotionVector, Secret } from './types';
import type { Markers, Prose, ResolvedTuning } from './prose';
import { baselineVector, evaluateUnlock } from './emotions';
import {
  buildCore,
  buildEmotionProfileBlock,
  buildEmotionStateBlock,
  buildReportSkeleton,
  buildTraitsBlock,
} from './blocks';

export interface BuildDeps {
  prose: Prose;
  markers: Markers;
  tuning: ResolvedTuning;
  controls: readonly string[];
  /** Placed between top-level blocks. */
  separator: string;
  transform?: (prompt: string) => string;
}

/**
 * Both gates on a secret. The emotional one asks whether the character could bear
 * to say it; `requires` asks whether the world has earned it. A secret that must
 * never be talked out of someone — only proven — carries a `requires` and stays
 * out of the prompt entirely until it passes, no matter how the conversation goes.
 */
export function gatesOpen<C>(secret: Secret<C>, state: EmotionVector, context: C): boolean {
  if (secret.requires && !secret.requires(context)) return false;
  return evaluateUnlock(secret.unlock, state);
}

/**
 * Assemble the system prompt.
 *
 * Order is load-bearing. Identity and the standing rules open the prompt, the
 * volatile per-turn material sits in the middle, and the rules are re-anchored at
 * the tail — models weight the beginning and end of a long context most heavily,
 * and the tail is what survives once the conversation grows.
 *
 * Every secret contributes its `abstract` in the CHARACTER slab, so the character
 * always knows it is carrying something. Only a secret whose gates are open
 * contributes its `concrete`, and only in the EMOTIONAL slab, well after the
 * personality that governs whether it actually gets said.
 */
export function buildContext<C = unknown>(
  character: Character<C>,
  options: BuildOptions<C>,
  deps: BuildDeps
): string {
  const { prose, markers, tuning, controls, separator, transform } = deps;
  const parts: string[] = [];
  const secrets: readonly Secret<C>[] = character.secrets ?? [];
  const emotional = options.emotional ?? true;
  const scene = options.scene ?? {};
  const context = options.context as C;

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
    parts.push(
      buildEmotionStateBlock(state, character.traits, {
        prose,
        tuning,
        active: character.emotion.active,
        controls,
      })
    );
    for (const secret of secrets) {
      if (gatesOpen(secret, state, context)) parts.push(prose.secrets.reveal(secret, markers.secretTag));
    }
    parts.push(
      prose.report(
        buildReportSkeleton(prose, markers.open, markers.close),
        markers.open,
        markers.close,
        markers.secretTag,
        controls
      )
    );
  } else {
    // `requires` still applies — it is a fact about the world, not about feeling.
    for (const secret of secrets) {
      if (secret.requires && !secret.requires(context)) continue;
      parts.push(prose.secrets.narrativeGated(secret));
    }
  }

  // 6 — who else is here, and the facts everyone must agree on
  if (scene.coPresence) parts.push(scene.coPresence);
  if (scene.facts) parts.push(scene.facts);

  // 7 — re-anchor
  parts.push(prose.coreReanchor);

  const prompt = parts.join(separator).trim();
  return transform ? transform(prompt) : prompt;
}
