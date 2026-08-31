/** The seven emotion axes. Fixed by design: the calibration in `defaults` is tuned to them. */
export const EMOTIONS = ['fear', 'anger', 'contempt', 'sadness', 'joy', 'trust', 'guilt'] as const;
export type Emotion = (typeof EMOTIONS)[number];

/** Intensity per emotion, 0–10. */
export type EmotionVector = Record<Emotion, number>;

/** Big Five. Fixed by design, same reason as EMOTIONS. */
export const TRAITS = ['neuroticism', 'agreeableness', 'conscientiousness', 'extraversion', 'openness'] as const;
export type Trait = (typeof TRAITS)[number];

export const TRAIT_BANDS = ['very_low', 'low', 'mid', 'high', 'very_high'] as const;
export type TraitBand = (typeof TRAIT_BANDS)[number];
export type Traits = Record<Trait, TraitBand>;

/**
 * A boolean expression over the emotion vector. Evaluated against the state the
 * character reported, to decide whether a secret's payload enters the prompt.
 *
 *   { emotion: 'guilt', gte: 4 }
 *   { sum: ['trust', 'sadness'], gte: 6 }
 *   { all: [{ emotion: 'trust', gte: 3 }, { emotion: 'sadness', gte: 3 }] }
 *
 * Prefer single thresholds and `sum` over deep `all` conjunctions: the vector is
 * self-reported and noisy by a few points per turn, so conjunctions of several
 * axes are markedly harder to satisfy than they look on paper.
 */
export type UnlockCondition =
  | { emotion: Emotion; gte: number }
  | { sum: readonly Emotion[]; gte: number }
  | { all: readonly UnlockCondition[] }
  | { any: readonly UnlockCondition[] };

/**
 * Two-tier secret. The point of the split: `abstract` is always in the prompt, so
 * the character knows it is holding something back and can behave evasively about
 * it, while `concrete` — the part that would spoil it — only enters once `unlock`
 * passes. Without the split you either leak the payload on turn one or the
 * character has no idea it has an inner life.
 */
export interface Secret {
  id: string;
  /** Always present. What it feels like to carry this. Must contain no payload. */
  abstract: string;
  /** Injected only once `unlock` passes. The actual content. */
  concrete: string;
  /**
   * Exact phrase the model is told to use if it chooses to reveal. Gives you a way
   * to confirm a reveal from the visible text instead of trusting a self-report.
   */
  markerPhrase?: string;
  unlock: UnlockCondition;
  /** Used in place of `unlock` when the emotional layer is disabled. */
  narrativeCondition?: string;
}

export interface EmotionProfile {
  /** Which axes are live for this character. Unlisted ones stay at baseline. */
  active: readonly Emotion[];
  /** Resting values. Anything unset is 0. */
  baseline: Partial<EmotionVector>;
  /** Prose: what raises and lowers each active emotion for this character. */
  sensitivities: string;
}

export interface Character {
  /** Who you are, where you are, who you are talking to. */
  identity: string;
  /** What you may know, what you must not do, and what no amount of pressure changes. */
  epistemicBound: string;
  traits: Traits;
  emotion: EmotionProfile;
  relationships?: string;
  /** Register, verbal habits, observable tells. */
  voice?: string;
  /** Any additional standing context for this character. */
  background?: string;
  secrets?: readonly Secret[];
  /** Stage-indexed knowledge — what this character knows and says at a given point. */
  stages?: Record<number, string>;
}

/** Per-turn situational context. Everything optional; omitted blocks are simply absent. */
export interface SceneContext {
  /** The situation all characters share. */
  scenario?: string;
  /** Who else exists, as prose. */
  cast?: string;
  /** What is on the table right now — an item shown, a topic raised. */
  focus?: string;
  /** Who else is in the room. */
  coPresence?: string;
  /** Facts every character must agree on, so nobody invents a contradicting version. */
  facts?: string;
  /** Arbitrary extra blocks, appended after `focus`. Use for per-run generated context. */
  extra?: readonly string[];
}

export interface BuildOptions {
  /** Index into `character.stages`. Omit if the character has no stages. */
  stage?: number;
  /** Default true. When false, secrets fall back to `narrativeCondition` gating. */
  emotional?: boolean;
  /** Current emotion vector. Defaults to the character's baseline. */
  state?: EmotionVector;
  scene?: SceneContext;
}

/** What the model reported at the end of a turn, once parsed out of the reply. */
export interface ParsedReply {
  /** The reply with the report block stripped — what you show the player. */
  visible: string;
  /** Updated vector, or null if absent/malformed. */
  state: EmotionVector | null;
  /** Secret ids the model claims it revealed, merged with marker-phrase recovery. */
  revealed: string[];
  /** Set to 'end' when the character wants to end the conversation. */
  control: 'end' | null;
}
