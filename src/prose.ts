import type { Emotion, Secret, Trait, TraitBand } from './types';

/**
 * Every string this library can put into a prompt. Nothing is hardcoded in the
 * builders — override any field to change wording, tone, or language.
 *
 * The English defaults live in `defaults/en.ts` and are what you get for free.
 */
export interface Prose {
  /** Appended to every character's opening block. */
  behaviorRules: string;
  /** Repeated verbatim at the very end of the prompt, to survive a long context. */
  coreReanchor: string;

  /**
   * How each emotion is written in the prompt AND keyed in the report block JSON.
   * Change these and the parser follows automatically — that is how you move the
   * whole engine to another language without touching code.
   */
  emotionLabels: Record<Emotion, string>;

  traits: {
    header: string;
    /** One line per trait, naming it and explaining both ends of the scale. */
    guidance: Record<Trait, string>;
    bandLabels: Record<TraitBand, string>;
    line: (guidance: string, band: string) => string;
  };

  emotions: {
    activeHeader: (labels: string[], sensitivities: string) => string;
    stateHeader: (values: string) => string;
    /** "This is not a label, it is what you feel now." */
    directive: string;
    highHeader: string;
    highBehavior: Record<Emotion, string>;
    extremeBehavior: Record<Emotion, string>;
    behaviorLine: (label: string, value: number, behavior: string) => string;
    /** Emotion must deform the words, not just the stage directions in parentheses. */
    dominance: string;
    midLevel: (labels: string[]) => string;
    /** Conscientiousness gate — how much of the state reaches the surface. */
    control: Record<'low' | 'mid' | 'high', string>;
    /** Fires when anger or contempt reach the hostility threshold. */
    hostility: string;
  };

  scene: {
    cast: (cast: string) => string;
  };

  secrets: {
    /** Wraps the payload once the gate opens. */
    reveal: (secret: Secret, secretTag: string) => string;
    /** Used instead when the emotional layer is off. */
    narrativeGated: (secret: Secret) => string;
  };

  /**
   * The end-of-turn self-report instruction. Receives the exact skeleton the model
   * should emit (already built from your labels and markers) plus the delimiters.
   */
  report: (skeleton: string, open: string, close: string, secretTag: string) => string;
}

/** Delimiters wrapping the model's end-of-turn state report. */
export interface Markers {
  open: string;
  close: string;
  /**
   * The tag naming a secret block in the prompt (`[SECRET id:"..."]`). The parser
   * strips these from the visible text, so it has to know what you called them.
   */
  secretTag: string;
}

/** Numeric calibration. Tuned against the English defaults — change with care. */
export interface Tuning {
  /** At or above this, an emotion gets an explicit behavioural instruction. */
  high: number;
  /** At or above this, the instruction escalates further. */
  extreme: number;
  /** At or above this (and below `high`), an emotion is named as moderate. */
  midLow: number;
  /** Anger or contempt at or above this unlocks refusing to cooperate. */
  hostility: number;
  /** Points per step each emotion falls back toward baseline. */
  decayPerStep: Record<Emotion, number>;
  /** Multiplier applied to decay for high-neuroticism characters — they hold on longer. */
  slowDecayFactor: number;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export interface EngineConfig {
  prose?: DeepPartial<Prose>;
  markers?: Partial<Markers>;
  tuning?: Partial<Tuning>;
}
