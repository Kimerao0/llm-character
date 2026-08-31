# Changelog

## Unreleased

### 0.1.0

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
