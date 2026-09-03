import {
  EMOTIONS,
  type Emotion,
  type EmotionVector,
  type ParsedReply,
  type ReportableEvent,
  type Secret,
} from './types';
import type { Markers, MatchingConfig, Prose } from './prose';
import { defaultMatching } from './defaults/en';
import { evaluateUnlock } from './emotions';

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Split text into comparable words.
 *
 * `Intl.Segmenter` is used when available because splitting on spaces silently
 * excludes every script that does not use them — Chinese, Japanese, Thai — and it
 * drops punctuation for us rather than needing a hand-maintained list of marks
 * per language. The fallback keeps letters and numbers and throws the rest away.
 *
 * Apostrophe variants are folded to plain `U+0027` before either path runs:
 * the curly `U+2019` and `U+2018` (models occasionally type the left quote
 * where an apostrophe belongs, not only the right one), and the
 * modifier-letter apostrophe `U+02BC`, used to spell elisions in several
 * languages. `Intl.Segmenter` already keeps all four glued inside a word
 * rather than splitting on them — the straight and curly forms because
 * UAX#29's word-joining rule names them explicitly, `U+02BC` because it is
 * itself classified as a letter — but "not split on" is not "treated as the
 * same word": the segmenter compares codepoints, not roles, so "wasn't" and
 * "wasn’t" come out as two different tokens, never one. A marker phrase is
 * authored once, in one file; a model reply is typed by a model with no
 * reason to prefer that glyph. Without the fold, whichever one the author
 * didn't happen to pick silently breaks recovery — the secret was said, and
 * nothing records it.
 *
 * This is a regression, not a new problem. The regex fallback below strips
 * every character that is not a letter or a digit, so it was already
 * glyph-consistent on its own — all four apostrophe variants disappear the
 * same way. Preferring `Intl.Segmenter` when it exists is what routed
 * matching back through the one path with no such fold, reintroducing a bug
 * a downstream consumer of this matcher had already hit and fixed on its own
 * copy, before this library existed to extract it into.
 *
 * Deliberately narrower than general Unicode normalization: accents are left
 * alone because they carry meaning in the languages this library serves, and
 * folding those would be a different, much larger decision.
 */
function defaultTokenize(text: string, locale?: string): string[] {
  const lower = text.toLowerCase().replace(/[‘’ʼ]/g, "'");
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
    return Array.from(segmenter.segment(lower))
      .filter((segment) => segment.isWordLike)
      .map((segment) => segment.segment);
  }
  return lower
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Does `haystack` contain `run` as a contiguous sequence? */
function hasRun(haystack: readonly string[], run: readonly string[]): boolean {
  if (run.length === 0 || run.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - run.length; i++) {
    for (let j = 0; j < run.length; j++) {
      if (haystack[i + j] !== run[j]) continue outer;
    }
    return true;
  }
  return false;
}

function containsSubstantialPortion(haystack: string, phrase: string, matching: MatchingConfig): boolean {
  const tokenize = matching.tokenize ?? defaultTokenize;
  const target = tokenize(haystack, matching.locale);
  const words = tokenize(phrase, matching.locale);
  if (words.length === 0) return false;

  const window = Math.min(matching.minConsecutiveWords, words.length);
  for (let i = 0; i <= words.length - window; i++) {
    if (hasRun(target, words.slice(i, i + window))) return true;
  }
  return false;
}

export interface RecoverOptions<TContext = unknown> {
  /** Passed to each secret's `requires` predicate. */
  context?: TContext;
  matching?: Partial<MatchingConfig>;
}

/**
 * Recover secret ids from the visible text by looking for their marker phrases.
 *
 * This exists because a model's own account of what it just revealed is not
 * evidence. Asking "did you reveal X?" both primes the reveal and gets answered
 * unreliably, so the self-report is merged with — not trusted over — what the
 * text actually contains.
 *
 * Only secrets whose gates are open are eligible, which keeps a marker phrase
 * that happens to surface early from registering as a reveal.
 */
export function recoverRevealed<TContext = unknown>(
  text: string,
  secrets: readonly Secret<TContext>[],
  state: EmotionVector,
  options: RecoverOptions<TContext> = {}
): string[] {
  const matching: MatchingConfig = { ...defaultMatching, ...options.matching };
  const context = options.context as TContext;
  const recovered: string[] = [];

  for (const secret of secrets) {
    if (!secret.markerPhrase) continue;
    if (secret.requires && !secret.requires(context)) continue;
    if (!evaluateUnlock(secret.unlock, state)) continue;
    if (containsSubstantialPortion(text, secret.markerPhrase, matching) && !recovered.includes(secret.id)) {
      recovered.push(secret.id);
    }
  }
  return recovered;
}

export interface ParseOptions<TContext = unknown> {
  /** Enables marker-phrase verification. Without these the reveal list is the model's word alone. */
  secrets?: readonly Secret<TContext>[];
  /**
   * Fallback state for recovery gating, used only when the reply carries no
   * usable report block. When the block parses, this turn's fresh vector is used
   * instead — the gate that matters is the one the character was actually under.
   */
  state?: EmotionVector;
  /** Passed to each secret's `requires` predicate. */
  context?: TContext;
  /** The declared vocabulary. Ids outside it are discarded. Without this, no events are returned. */
  events?: readonly ReportableEvent[];
}

export interface ParseDeps<TControl extends string = string> {
  prose: Prose;
  markers: Markers;
  matching: MatchingConfig;
  controls: readonly TControl[];
}

/**
 * Split a raw model reply into what the player sees and what the engine keeps.
 *
 * Fails closed: an incomplete or malformed report leaves `state` null so the
 * caller keeps the previous vector rather than adopting a half-parsed one.
 */
export function parseReply<TContext = unknown, TControl extends string = string>(
  raw: string,
  deps: ParseDeps<TControl>,
  options: ParseOptions<TContext> = {}
): ParsedReply<TControl> {
  const { prose, markers, matching, controls } = deps;
  const open = escapeRe(markers.open);
  const close = escapeRe(markers.close);
  const blockRe = new RegExp(`${open}([\\s\\S]*?)${close}`);

  // Defense in depth: the model is told never to write these scaffolding tokens
  // in the visible text, but under pressure it parrots them back — stray
  // [SECRET id:"..."] tags (sometimes with invented ids), improvised closing
  // variants like [/SECRET], or loose delimiters. Strip whatever survives so it
  // never reaches a player, then collapse the double space a mid-sentence
  // removal leaves behind, without touching newlines.
  const strayRe = new RegExp(
    `\\[/?(?:${escapeRe(markers.secretTag)}|${escapeRe(markers.eventTag)})[^\\]]*\\]|${open}|${close}`,
    'gi'
  );
  const strip = (text: string): string =>
    text
      .replace(strayRe, '')
      .replace(/[^\S\n]{2,}/g, ' ')
      .trimEnd();

  const match = raw.match(blockRe);
  const visible = strip(match ? raw.replace(blockRe, '') : raw);

  const labelToEmotion = new Map<string, Emotion>(
    EMOTIONS.map((emotion) => [prose.emotionLabels[emotion], emotion] as const)
  );

  let state: EmotionVector | null = null;
  let control: TControl | null = null;
  let reported: string[] = [];
  let reportedEvents: string[] = [];

  if (match?.[1] !== undefined) {
    try {
      const payload: unknown = JSON.parse(match[1]);
      if (payload && typeof payload === 'object') {
        const obj = payload as Record<string, unknown>;

        const rawEmotions = obj.emotions;
        if (rawEmotions && typeof rawEmotions === 'object') {
          const source = rawEmotions as Record<string, unknown>;
          const clean = {} as EmotionVector;
          let complete = true;
          for (const [label, emotion] of labelToEmotion) {
            const value = source[label];
            if (typeof value !== 'number' || !Number.isFinite(value)) {
              complete = false;
              break;
            }
            clean[emotion] = Math.max(0, Math.min(10, Math.round(value)));
          }
          if (complete) state = clean;
        }

        // Anything outside the declared vocabulary is discarded, invented or not.
        if (typeof obj.control === 'string' && (controls as readonly string[]).includes(obj.control)) {
          control = obj.control as TControl;
        }

        if (Array.isArray(obj.revealed)) {
          reported = obj.revealed.filter((x): x is string => typeof x === 'string' && x.length > 0);
        }

        if (Array.isArray(obj.events)) {
          reportedEvents = obj.events.filter((x): x is string => typeof x === 'string' && x.length > 0);
        }
      }
    } catch {
      // Malformed JSON — keep the visible text, report nothing.
    }
  }

  const gateState = state ?? options.state;
  const recovered =
    options.secrets && gateState
      ? recoverRevealed(visible, options.secrets, gateState, { context: options.context, matching })
      : [];

  const known = new Set(options.secrets?.map((secret) => secret.id));
  const revealed = [...new Set([...reported, ...recovered])].filter(
    // Drop ids the model invented, but only when we have a catalogue to check against.
    (id) => known.size === 0 || known.has(id)
  );

  // Declared-only, matching how `control` is handled: models invent plausible
  // ids, and a host's dispatch must never receive one it has no branch for.
  const declaredEvents = new Set((options.events ?? []).map((event) => event.id));
  const events = [...new Set(reportedEvents)].filter((id) => declaredEvents.has(id));

  return { visible, state, revealed, control, events };
}
