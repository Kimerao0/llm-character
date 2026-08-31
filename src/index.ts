export { createEngine, deepMerge, type CharacterEngine } from './engine';

export {
  EMOTIONS,
  TRAITS,
  TRAIT_BANDS,
  type Emotion,
  type EmotionVector,
  type EmotionProfile,
  type Trait,
  type TraitBand,
  type Traits,
  type UnlockCondition,
  type Secret,
  type Character,
  type SceneContext,
  type BuildOptions,
  type ParsedReply,
} from './types';

export type {
  Prose,
  Markers,
  Tuning,
  ResolvedTuning,
  Threshold,
  MatchingConfig,
  EngineConfig,
  DeepPartial,
} from './prose';

export { enProse, enMarkers, defaultTuning, defaultMatching } from './defaults/en';

// Lower-level pieces, for composing something other than the standard pipeline.
export { evaluateUnlock, baselineVector, clampVector, decayEmotions } from './emotions';
export { buildContext, gatesOpen, type BuildDeps } from './build';
export {
  parseReply,
  recoverRevealed,
  type ParseOptions,
  type ParseDeps,
  type RecoverOptions,
} from './parse';
export {
  buildCore,
  buildTraitsBlock,
  buildEmotionProfileBlock,
  buildEmotionStateBlock,
  buildReportSkeleton,
  resolveTuning,
  type StateBlockOptions,
} from './blocks';
