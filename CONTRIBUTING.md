# Contributing

Welcome to **dsh-md-notes** — code, docs, and suggestions are all welcome.
Design docs live in [docs/](docs/).

## Development environment

- **Node.js** and npm (the project builds with npm scripts).
- **deepseek-harness checkout**: `npm run link-deps` links types from a local
  `deepseek-harness` repository's build output; the default path is
  `deepseek-harness` two levels above this directory, overridable via the
  `DSH_CHECKOUT` environment variable.

## Quick start

```sh
npm install --legacy-peer-deps   # first time or after dependency changes (skips @deepseek-ai/* peer resolution)
npm run link-deps                # link deepseek-harness checkout types (before changing code)
npm run build                    # build lib/index.js + lib/client.js
```

After changing code and building successfully, **restart dsh web** for it to
take effect (bundle layer and client package metadata are cached in the process).

## Common scripts

| Command | Purpose |
|---|---|
| `npm run build` | Full build (tsc host → tsc client → tsdown) |
| `npm run typecheck` | Type-check only (both programs) |
| `npm run link-deps` | Re-link `@deepseek-ai/*` types to the checkout |
| `npm run bundle` | Build only the client bundle |

## Code conventions

- **Two tsc programs**: host (`src/`, excludes `src/client`) and client
  (`src/client/`) compile separately to avoid `Context.sessions` type clashes.
- **i18n**: all UI copy goes through `src/client/features/locales/` (`zh.ts` is
  the source dictionary, `en.ts` is key-locked by its mapped type); the host
  never returns user-facing localized text (it returns error codes + English detail).
- **HMR safety**: side effects (route registration, slot registration, the `@`
  source, event listeners) are wrapped in `ctx.effect(..., label)` so teardown
  cleans them up.
- **Rendering safety**: the note preview uses dsh's `MarkdownText` (XSS-safe by
  construction); no raw-HTML passthrough, and no global styles injected into the
  core composer.
- **CHANGELOG**: user-visible changes are recorded in `CHANGELOG.md` /
  `CHANGELOG.zh.md` (unreleased work goes under `## NEXT_VERSION`; see the rules
  at the top of each file).
- **Docs sync**: functional changes update `docs/` and `README.md` /
  `README.zh.md` (user-visible features get operation instructions in
  `docs/usage.md` / `docs/usage.zh.md`).

## Commits & PRs

1. Open an **issue** to discuss the approach first, then implement.
2. Make the change on a branch: code + tests (if any) + docs + CHANGELOG.
3. Write commit messages describing the change (see `git log` for style).
4. Open a PR linked to the issue; wait for review once CI (if any) passes.

## Design docs

[docs/features.md](docs/features.md) (features) · [docs/architecture.md](docs/architecture.md)
(architecture) · [docs/context.md](docs/context.md) (`@` references & injection) ·
[docs/TODO.md](docs/TODO.md) (roadmap)
