# Design notes

Why this library is shaped the way it is. The README explains what it does; this
explains what will break if you change it.

## Dependency direction

```
types.ts        no imports — the data model
prose.ts        types            — the shape of every configurable string
defaults/en.ts  prose            — the English text and the calibration
emotions.ts     types, defaults  — pure predicates and decay
blocks.ts       types, prose, defaults — one prompt block each
build.ts        blocks, emotions — assembly
parse.ts        types, prose, emotions — the reply direction
engine.ts       everything       — binds config once, hands back methods
```

Nothing imports `engine.ts`. Every builder takes its prose and tuning as an
argument rather than reaching for a module-level default, which is what makes two
engines with different configuration able to coexist in one process. Do not add a
module-level mutable default and read it from inside a builder.

## Things that look like cruft and are not

**The report block is a single line at the very end of the reply.**
Not a formatting preference. It lets a server buffer the tail: forward bytes to
the client until the opening delimiter appears, then hold everything back. If the
block could appear mid-reply you would have to buffer the whole response before
showing any of it, and streaming dies. The instruction says "the LAST thing you
write" and "write nothing after" for this reason.

**`revealed` carries an anti-priming disclaimer in three separate places.**
`prose.secrets.reveal`, `prose.report`, and the comment above both. Asking a model
"did you reveal X?" is not a neutral question — it raises the salience of X and
makes revealing more likely. The repetition is load-bearing; each one was added
because the instruction alone was not enough. If you trim this for token cost,
measure reveal rates before and after.

**Reveal detection merges the self-report with marker-phrase recovery instead of
preferring one.** The self-report is cheap but unreliable (see above). The text
match is reliable but only fires when the model used something close to the marker
phrase. Neither alone is sufficient, so the union is taken and unknown ids are
dropped.

**Partial vectors are discarded, not patched.** `parse.ts` requires all seven axes
to be present and numeric or it returns `state: null`. A half-parsed vector is
worse than no vector: the caller keeps last turn's state, which is at least
coherent. Do not "helpfully" fill missing axes with zeros — that would silently
reset a character's whole emotional history because one key was misspelled.

**The stray-token stripper.** `[/?SECRET[^\]]*\]`, the delimiters, and the double-space
collapse. The model is told never to write its own scaffolding into the visible
text, and mostly obeys — but under pressure it parrots the prompt back, including
invented secret ids and improvised closing tags like `[/SECRET]`. All of that was
observed reaching real players. The `[^\S\n]{2,}` (rather than `\s{2,}`) is
deliberate: collapsing whitespace after a mid-sentence removal must not eat
newlines.

**`.trimEnd()` and not `.trim()`** in the same place — leading whitespace may be
significant to the caller's own formatting.

**Regex metacharacters in markers are escaped.** Someone will configure
`open: '[[STATE]]'`. Without escaping, that is a character class.

## The decisions

**Fixed dimensions, configurable prose.** The seven emotions and the Big Five are
not overridable. Every default string, every threshold and the whole decay table
are written *about* those specific axes — `highBehavior.contempt` is a sentence
about contempt. Allow arbitrary axes and the library keeps only its plumbing and
loses everything that makes the defaults worth having. This was a deliberate
trade, not an oversight.

**Two-tier secrets.** `abstract` is always present so the character can be
evasive about the right subject; `concrete` enters only when the gates open. The
alternative designs both fail: everything in the prompt leaks on turn one, and
nothing in the prompt gives a character with no interior life who is blandly
cooperative until a flag flips.

**Prompt order.** Identity and rules first, volatile per-turn material in the
middle, rules restated at the tail. Attention concentrates at the beginning and
end of a long context, and the tail is what survives as the conversation grows.
Secret *abstracts* sit high with the personality; secret *payloads* sit low, after
the state block that unlocked them, so the disposition governing whether to speak
is read before the thing that could be said.

**`requires` is code; `narrativeCondition` is prose.** A prose condition is a
request the model may ignore under pressure. `requires` is evaluated before
assembly, so a secret that has not been earned is not in the prompt at all —
nothing to jailbreak. Use prose for colour, `requires` for anything that must
actually hold.

**Intensity and expression are separate.** The vector says how much is felt; the
conscientiousness band says how much surfaces. Without the split, every character
at anger 9 writes the same way, which is the single most obvious tell of a naive
emotion prompt. High conscientiousness explicitly keeps the *verbal register*
intact while the physical tells leak.

**`active` filters instructions, not the reported vector.** All seven axes are
always in the report block, so the parser never needs to know which character
produced a reply and the JSON contract stays fixed. But only active axes earn a
behavioural instruction, so a character who does not model joy is never told to
turn giddy because a number drifted. The alternative — filtering the JSON too —
saves tokens and was rejected for making parsing character-dependent.

**Controls are validated against a declared list.** Models invent plausible
signals. An undeclared `control` is discarded rather than passed through, so a
caller's dispatch never receives something it has no branch for.

**`Intl.Segmenter` for tokenising.** Splitting on spaces excludes Chinese,
Japanese and Thai outright, and stripping punctuation by hand needs a per-language
list of marks. The segmenter handles both. There is a whitespace fallback for
environments without it.

## Calibration

Thresholds: high 6, extreme 9, moderate 4, hostility 8. Decay per step: anger 2,
fear 1.5, contempt/sadness/joy 1, guilt 0.5, trust 0.25 — anger burns off fast,
trust is slow to rebuild, and high neuroticism halves all of it.

These came from tuning against one detective game, not from a study. Treat them as
a defensible starting point. Two known weaknesses, both documented in the README:

- **The gate lags one turn.** The prompt is built from the state reported last
  turn, because this turn's state does not exist until the model answers.
  `parseReply` de-lags *detection* by gating recovery on the fresh vector, but
  *injection* is still behind by one.
- **Conjunctions underfire.** With a few points of self-report noise per turn,
  `all: [A, B, C]` across three axes is far harder to satisfy than the numbers
  suggest. Single thresholds and floored sums are the robust shapes.

## Testing

`test/fixtures.ts` holds one character used across the suite. The tests assert on
distinctive fragments of the default prose rather than whole strings, so wording
can be improved without a mass update — but that also means a fragment you delete
from `defaults/en.ts` will fail a test somewhere. That is intentional.

One test is named `KNOWN LIMITATION`: a denial built from a marker phrase's own
vocabulary can contain a six-word run and register as a reveal. It asserts the
wrong-looking behaviour on purpose, so that changing the matcher is a deliberate
act rather than an accident.
