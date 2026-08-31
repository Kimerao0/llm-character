# Contributing

```bash
pnpm install
pnpm test           # vitest, watch with pnpm test:watch
pnpm run typecheck  # library first, then tests+examples
pnpm run build      # tsup → dual ESM/CJS + declarations
pnpm run example    # the interrogation walkthrough, no API key needed
```

Read [docs/design.md](docs/design.md) before changing anything in `src/` — several
things that look removable are load-bearing, and it says which.

## The two tsconfigs

`tsconfig.json` covers `src` only, with `types: []` and no DOM or Node lib. That is
what proves the published library makes no assumption about where it runs — if you
reach for `process`, `console` or `window` in `src/`, it fails to compile, and that
is the point.

`tsconfig.dev.json` adds `test` and `examples` with Node types. `pnpm run typecheck`
runs both.

## Adding a configurable string

1. Add the field to `Prose` in `src/prose.ts`. Use a plain `string` for static text
   and a function where anything is interpolated.
2. Add the English text to `src/defaults/en.ts`.
3. Read it from the builder in `src/blocks.ts` or `src/build.ts` — never inline a
   literal there.
4. Add a test asserting an override reaches the prompt.

Deep-merging means a user overriding one field keeps the rest, so never require
them to restate a whole object.

## Releasing

Publishing runs on tag push via `.github/workflows/release.yml`, using npm
trusted publishing (OIDC). There is no `NPM_TOKEN` anywhere and there should
never be one.

```bash
# bump version in package.json, update CHANGELOG.md, commit
git tag v0.1.1 && git push --tags
```

The workflow installs, typechecks, tests and builds with pnpm, then publishes with
the **npm** CLI. That split is deliberate: `pnpm publish` with OIDC is broken on
pnpm 11 (pnpm/pnpm#11513). Don't "tidy" the last step back to pnpm.

One-time setup on npmjs.com: Package settings → Trusted publisher → GitHub
Actions, this repo, workflow `release.yml`. Provenance attestations are then
generated automatically — no `--provenance` flag needed.
