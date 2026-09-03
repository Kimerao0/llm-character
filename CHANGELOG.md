# Changelog

## 0.2.0 — 2026-09-03

- `Character.events` — a declared vocabulary of `ReportableEvent`s (`{ id, when }`)
  a character may report having done. Added to the prompt as a ledger, the same
  way `revealed` is, never as an instruction.
- `parseReply` returns `events: string[]` — the reported ids, filtered to the
  vocabulary you passed via `ParseOptions.events`; anything undeclared is
  discarded, the same rule as `control`.
- `buildEventsBlock`, exported alongside the other block builders.
- Additive at runtime: a character with no `events` gets no block and no
  `events` field in the report skeleton; `parseReply` without an `events`
  option always returns `events: []`. Not a compile-time no-op for everyone,
  though — `ParsedReply.events` is required, so TypeScript code that
  type-constructs a `ParsedReply` (a mocked `parseReply` return, say) needs to
  add it.
- Fix: marker-phrase matching now folds apostrophe variants — `'`, the curly
  `’` (`U+2019`) and `‘` (`U+2018`), and the modifier-letter `ʼ` (`U+02BC`) — to
  a plain `'` before tokenizing, on both the `Intl.Segmenter` path and the
  regex fallback in `defaultTokenize`. A marker phrase authored with one glyph
  and a reply typed with another used to tokenize as different words and
  silently fail to match — a revealed secret going unrecorded with no error.
  Accents are untouched; this is not general Unicode normalization.

## 0.1.1 — 2026-09-01

- Documentation only: refreshed the evidence-gate example in the README.

## 0.1.0 — 2026-08-31

First release.

- `createEngine(config?)` — prompt assembly and reply parsing bound to your
  wording and calibration.
- Two-tier secrets: `abstract` always in the prompt, `concrete` gated behind an
  expression over the emotion vector.
- `Secret.requires` — a second, deterministic gate evaluated in code against a
  typed context, for secrets that must be earned rather than felt.
- Reveal verification: the model's self-report merged with marker-phrase recovery
  against the visible text.
- Trait-modulated expression — conscientiousness decides how much of the state
  reaches the surface.
- `decay` — relax a state back toward baseline, at half rate for high-neuroticism
  characters.
- A declared `controls` vocabulary, validated on the way back.
- Every prompt string configurable, with English defaults; relabelling the emotion
  axes moves the prompt and the parser together.
- Marker matching via `Intl.Segmenter`, so it works in scripts without spaces.
