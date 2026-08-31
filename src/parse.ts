import { EMOTIONS, type Emotion, type EmotionVector, type ParsedReply, type Secret } from './types';
import type { Markers, Prose } from './prose';
import { evaluateUnlock } from './emotions';

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * How many consecutive words of a marker phrase must appear verbatim before we
 * count a secret as revealed. Conservative enough to survive light paraphrase
 * without firing on incidental word overlap.
 */
const MIN_CONSECUTIVE_WORDS = 6;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,;:!?'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsSubstantialPortion(haystack: string, phrase: string): boolean {
  const target = normalize(haystack);
  const words = normalize(phrase).split(' ').filter(Boolean);
  if (words.length === 0) return false;

  const window = Math.min(MIN_CONSECUTIVE_WORDS, words.length);
  for (let i = 0; i <= words.length - window; i++) {
    if (target.includes(words.slice(i, i + window).join(' '))) return true;
  }
  return false;
}

/**
 * Recover secret ids from the visible text by looking for their marker phrases.
 *
 * This exists because a model's own account of what it just revealed is not
 * evidence. Asking "did you reveal X?" both primes the reveal and gets answered
 * unreliably, so the self-report is merged with — not trusted over — what the
 * text actually contains.
 *
 * Only currently-unlocked secrets are eligible, which keeps a marker phrase that
 * happens to surface early from registering as a reveal.
 */
export function recoverRevealed(text: string, secrets: readonly Secret[], state: EmotionVector): string[] {
  const recovered: string[] = [];
  for (const secret of secrets) {
    if (!secret.markerPhrase) continue;
    if (!evaluateUnlock(secret.unlock, state)) continue;
    if (containsSubstantialPortion(text, secret.markerPhrase) && !recovered.includes(secret.id)) {
      recovered.push(secret.id);
    }
  }
  return recovered;
}

export interface ParseOptions {
  /** Enables marker-phrase recovery. Without these the reveal list is the model's word alone. */
  secrets?: readonly Secret[];
  /**
   * Fallback state for recovery gating, used only when the reply carries no
   * usable report block. When the block parses, this turn's fresh vector is used
   * instead — the gate that matters is the one the character was actually under.
   */
  state?: EmotionVector;
}

/**
 * Split a raw model reply into what the player sees and what the engine keeps.
 *
 * Fails closed: an incomplete or malformed report leaves `state` null so the
 * caller keeps the previous vector rather than adopting a half-parsed one.
 */
export function parseReply(
  raw: string,
  prose: Prose,
  markers: Markers,
  options: ParseOptions = {}
): ParsedReply {
  const open = escapeRe(markers.open);
  const close = escapeRe(markers.close);
  const blockRe = new RegExp(`${open}([\\s\\S]*?)${close}`);

  // Defense in depth: the model is told never to write these scaffolding tokens
  // in the visible text, but under pressure it parrots them back — stray
  // [SECRET id:"..."] tags (sometimes with invented ids), improvised closing
  // variants like [/SECRET], or loose delimiters. Strip whatever survives so it
  // never reaches a player, then collapse the double space a mid-sentence
  // removal leaves behind, without touching newlines.
  const strayRe = new RegExp(`\\[/?${escapeRe(markers.secretTag)}[^\\]]*\\]|${open}|${close}`, 'gi');
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
  let control: 'end' | null = null;
  let reported: string[] = [];

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

        if (obj.control === 'end') control = 'end';

        if (Array.isArray(obj.revealed)) {
          reported = obj.revealed.filter((x): x is string => typeof x === 'string' && x.length > 0);
        }
      }
    } catch {
      // Malformed JSON — keep the visible text, report nothing.
    }
  }

  const gateState = state ?? options.state;
  const recovered =
    options.secrets && gateState ? recoverRevealed(visible, options.secrets, gateState) : [];

  const known = new Set(options.secrets?.map((secret) => secret.id));
  const revealed = [...new Set([...reported, ...recovered])].filter(
    // Drop ids the model invented, but only when we have a catalogue to check against.
    (id) => known.size === 0 || known.has(id)
  );

  return { visible, state, revealed, control };
}
