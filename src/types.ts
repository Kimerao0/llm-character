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
 * it, while `concrete` — the part that would spoil it — only enters once the gates
 * open. Without the split you either leak the payload on turn one or the character
 * has no idea it has an inner life.
 */
export interface Secret<TContext = unknown> {
  id: string;
  /** Always present. What it feels like to carry this. Must contain no payload. */
  abstract: string;
  /** Injected only once the gates open. The actual content. */
  concrete: string;
  /**
   * Exact phrase the model is told to use if it chooses to reveal. Gives you a way
   * to confirm a reveal from the visible text instead of trusting a self-report.
   */
  markerPhrase?: string;
  /** The emotional gate. */
  unlock: UnlockCondition;
  /**
   * A second, non-emotional gate, evaluated in code against whatever you pass as
   * `context`. Both this and `unlock` must pass.
   *
   * Use it for anything the player must have earned rather than felt their way to:
   * evidence collected, an item in hand, a stage reached. Unlike `narrativeCondition`
   * — prose the model may or may not honour — this one is deterministic, so a
   * confession that must never be talked out of someone can be made genuinely
   * unreachable until the proof exists.
   *
   *   requires: (ctx) => ctx.evidence.length >= 3
   */
  requires?: (context: TContext) => boolean;
  /** Used in place of `unlock` when the emotional layer is disabled. */
  narrativeCondition?: string;
}

/**
 * Something the character may report having done, so the host can react to it
 * without reading prose.
 *
 * The same contract as `revealed`, for occurrences rather than secrets: you
 * declare the vocabulary, the character reports only what actually happened in
 * the visible text this turn, and anything you did not declare is discarded.
 * It is a record kept after the fact — never an instruction, and never a reason
 * for the character to do the thing.
 */
export interface ReportableEvent {
  /** Stable key your application switches on. Never shown to the user. */
  id: string;
  /** What must actually have happened in the visible text for this to count. */
  when: string;
}

export interface EmotionProfile {
  /**
   * Which axes are modelled for this character. Only these can earn a behavioural
   * instruction in the state block — a character with no `joy` will not be told to
   * turn giddy because a number drifted up. Leave it empty to model all seven.
   *
   * The reported vector always carries all seven regardless; this governs which of
   * them shape behaviour.
   */
  active: readonly Emotion[];
  /** Resting values. Anything unset is 0. */
  baseline: Partial<EmotionVector>;
  /** Prose: what raises and lowers each active emotion for this character. */
  sensitivities: string;
}

export interface Character<TContext = unknown> {
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
  secrets?: readonly Secret<TContext>[];
  /** Occurrences this character may report. See ReportableEvent. */
  events?: readonly ReportableEvent[];
  /** Stage-keyed knowledge — what this character knows and says at a given point. */
  stages?: Record<string | number, string>;
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

export interface BuildOptions<TContext = unknown> {
  /** Key into `character.stages`. Omit if the character has no stages. */
  stage?: string | number;
  /** Default true. When false, secrets fall back to `narrativeCondition` gating. */
  emotional?: boolean;
  /** Current emotion vector. Defaults to the character's baseline. */
  state?: EmotionVector;
  scene?: SceneContext;
  /** Passed to every secret's `requires` predicate. */
  context?: TContext;
}

/** What the model reported at the end of a turn, once parsed out of the reply. */
export interface ParsedReply<TControl extends string = string> {
  /** The reply with the report block stripped — what you show the player. */
  visible: string;
  /** Updated vector, or null if absent/malformed. */
  state: EmotionVector | null;
  /** Secret ids the model claims it revealed, merged with marker-phrase recovery. */
  revealed: string[];
  /** Declared event ids the model reports happened this turn. Undeclared ids are dropped. */
  events: string[];
  /** One of the engine's configured control signals, or null. */
  control: TControl | null;
}
