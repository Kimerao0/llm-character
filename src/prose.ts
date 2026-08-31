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
    /** Fires when a hostile emotion reaches its threshold. Receives the control vocabulary. */
    hostility: (controls: readonly string[]) => string;
  };

  scene: {
    cast: (cast: string) => string;
  };

  secrets: {
    /** Wraps the payload once the gates open. */
    reveal: (secret: Secret<never>, secretTag: string) => string;
    /** Used instead when the emotional layer is off. */
    narrativeGated: (secret: Secret<never>) => string;
  };

  /**
   * The end-of-turn self-report instruction. Receives the exact skeleton the model
   * should emit (already built from your labels and markers), the delimiters, the
   * secret tag, and the control signals you have declared.
   */
  report: (skeleton: string, open: string, close: string, secretTag: string, controls: readonly string[]) => string;
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

/**
 * A threshold that is either uniform across the axes, or set per emotion.
 * Unlisted emotions fall back to the library default for that field.
 */
export type Threshold = number | Partial<Record<Emotion, number>>;

/** Numeric calibration as you supply it. */
export interface Tuning {
  /** At or above this, an emotion gets an explicit behavioural instruction. */
  high: Threshold;
  /** At or above this, the instruction escalates further. */
  extreme: Threshold;
  /** At or above this (and below `high`), an emotion is named as moderate. */
  midLow: Threshold;
  /** A hostile emotion at or above this unlocks refusing to cooperate. */
  hostility: Threshold;
  /** Which emotions can trigger the hostility clause. */
  hostileEmotions: readonly Emotion[];
  /** Points per step each emotion falls back toward baseline. */
  decayPerStep: Record<Emotion, number>;
  /** Multiplier applied to decay for high-neuroticism characters — they hold on longer. */
  slowDecayFactor: number;
}

/** Calibration after per-emotion thresholds have been expanded. What the builders consume. */
export interface ResolvedTuning extends Omit<Tuning, 'high' | 'extreme' | 'midLow' | 'hostility'> {
  high: Record<Emotion, number>;
  extreme: Record<Emotion, number>;
  midLow: Record<Emotion, number>;
  hostility: Record<Emotion, number>;
}

/** How marker phrases are matched against what the character actually said. */
export interface MatchingConfig {
  /**
   * How many consecutive words of a marker phrase must appear before a reveal is
   * counted. Lower catches looser paraphrase; higher avoids matching a denial
   * built from the same vocabulary.
   */
  minConsecutiveWords: number;
  /** BCP-47 locale for the default word segmenter. */
  locale?: string;
  /**
   * Split text into comparable words. The default uses `Intl.Segmenter`, which
   * handles scripts that do not separate words with spaces; override only if you
   * need segmentation the platform does not give you.
   */
  tokenize?: (text: string, locale?: string) => string[];
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export interface EngineConfig<TControl extends string = 'end'> {
  prose?: DeepPartial<Prose>;
  markers?: Partial<Markers>;
  tuning?: Partial<Tuning>;
  matching?: Partial<MatchingConfig>;
  /**
   * Control signals the character may emit alongside a reply. Defaults to `['end']`.
   *
   * Declare more and dialogue becomes an action channel: the model can hand you
   * `call_guard` or `open_the_door` and you dispatch on it. Anything the model
   * emits that is not on this list is discarded.
   */
  controls?: readonly TControl[];
  /** Placed between the prompt's top-level blocks. Defaults to a single newline. */
  separator?: string;
  /** Last hook before the prompt is returned. Prefix, redact, count tokens, whatever. */
  transform?: (prompt: string) => string;
}
