<p align="center">
  <img src="assets/dsh-md-notes.png" width="96" alt="dsh-md-notes" />
</p>

<h1 align="center">dsh-md-notes</h1>

<p align="center">
  <a href="README.zh.md">中文</a>
</p>

<p align="center">
  DSH third-party plugin (bundle): <b>MD Notes Manager</b>
  <br />
  <a href="docs/usage.md">User Guide</a> · <a href="docs/features.md">Features</a> · <a href="docs/architecture.md">Architecture</a> · <a href="docs/context.md">Context</a> · <a href="docs/TODO.md">Roadmap</a> · <a href="CHANGELOG.md">Changelog</a>
</p>

---

## Overview

A note-taking plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). It provides a full **MD notes manager** and **MD notes editor**, letting you quickly capture conversation content into notes. Notes can be maintained by syncing to a Git repository.

**Who it's for**: DSH web users who want local, file-based notes (no database, no cloud) — capture a conversation into a note with one click, keep editing the `.md` anywhere, and back up / sync with a Git repository.

**Current features**:

- **Sidebar notes entry** → full-screen notes manager: per-workspace note list (grouped, collapsible), markdown edit/preview, save, delete (in-page confirm), create with one click.
- **Assistant-message action** (next to copy) → pick or create a note and append that conversation (user question + answer) to it, with localized section labels.
- **Git sync** (optional, URL-driven): **shared repo** mode (one repo for all workspaces, per-workspace folders) or **own repos** mode (per workspace: URL + branch + subpath). Push = mirror-sync (deletions included), Update = pull with conflict confirmation, auto-pull on open, merge-remote-and-retry.
- **Settings panel** (dsh Settings → MD Notes): mode, repo URL/branch/subpath, auto-pull, commit author — with dsh-styled form controls.
- **Theme & i18n**: token-based colors (light/dark), UI copy follows dsh's language (Chinese / English), error messages localized.
- **Update notifications**: a yellow "Update available" tag appears when a newer npm version exists.

**On the roadmap** (see [docs/TODO.md](docs/TODO.md)): restyle the note picker with cross-workspace capture, reference notes as conversation context, and visual Git conflict rendering & resolution.

## Compatibility

- **Plugin version**: 0.3.0 (see [CHANGELOG.md](CHANGELOG.md) for history).
- **Requires**: the `dsh` CLI (with the `plugin` subcommand) and the `web` profile.
- **Last verified**: 2026-08-16, against deepseek-harness mainline `0.1.0-rc.7` (slots, settings, workspace, session, subprocess contracts unchanged since rc.5).
- The plugin is not pinned to a specific mainline commit; pin the plugin version at install time if you need a fixed combination. Runtime dependencies (`@deepseek-ai/*`, `react`) are declared as optional peer dependencies and resolve from the dsh installation.

## Install / Uninstall

Prerequisites: `dsh` CLI installed, target profile is `web`.

Install from npm (recommended):

```sh
dsh plugin --profile web add dsh-md-notes
```

Then **restart dsh web** (bundle layer and client package metadata are cached in the process; a restart is required for changes to take effect).

Upgrade:

```sh
dsh plugin --profile web update dsh-md-notes
```

A restart of dsh web is required for it to take effect.

Uninstall:

```sh
dsh plugin --profile web remove dsh-md-notes
```

> For development/debugging from source: run `dsh plugin --profile web add ./dsh-md-notes`
> from the parent directory of the plugin project.

## Quick start

1. Install the plugin (above), restart dsh web.
2. **Create a note**: click the notes entry at the bottom of the sidebar (above Settings) → enter a title in the "New note title…" field → **New** → type in the editor → **Save**.
3. **Capture a conversation**: below any assistant answer, click the notes icon (next to copy) → pick a target note (or create one on the spot) → **Write to note**. The user question + answer are appended to the note with a timestamped section.

Note files live in each workspace's `.dsh-notes/` directory (`<workspace>/.dsh-notes`); you can open and edit them directly with any editor. Git sync is optional — point the plugin at a repo URL and it keeps notes in sync (shared repo or per-workspace repo).

> For everything the plugin can do — the notes manager, capturing conversations, Git sync (shared / per-workspace repos), pushing/updating, conflict handling, and the settings panel — see the [User Guide](docs/usage.md).

## Configuration

All options are plugin Config keys, overridable in the profile's `cordis.patch.yml` (a patch replaces the whole `config` of the row):

```yaml
- id: md-notes
  config:
    route: '/plugins/md-notes'   # HTTP API prefix; default is fine
    gitMode: 'off'               # 'off' | 'shared' | 'own'
    gitAutoPull: true            # pull remote before opening a note
```

| Key | Default | Meaning |
|---|---|---|
| `route` | `/plugins/md-notes` | HTTP API prefix served by the plugin; also hosts the icon at `<route>/icon.svg`. |

There are **no environment variables and no secrets** in this plugin's configuration.

## Permissions & data

- **Filesystem**: reads and writes notes as plain `.md` files (plus a `meta.json` sidecar) under each workspace's `.dsh-notes` directory (notes are workspace-bound); git operations touch only the plugin-managed clones under `$DSH_HOME/md-notes-repos/`.
- **Network**: a loopback HTTP API (`POST <route>`, browser ↔ local dsh server) and the icon served from the same origin. **No external network calls, no telemetry.**
- **Credentials**: none collected or transmitted.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Changes don't appear after install/upgrade | Restart dsh web — bundle layer and client metadata are cached in the process. |
| Icon looks stale | Hard-refresh the page; the icon is served with `no-cache` and reflects `assets/dsh-md-notes.svg` on every request. |
| Plugin doesn't load | Verify the layer: `dsh --profile web --dump-config` and look for the `md-notes` row. |
| Installed from git and `add` failed | pnpm ≥10 blocks build scripts by default; add the printed package key under `allowBuilds` in the profile's `pnpm-workspace.yaml`, then re-run `add`. |
| Notes can't be created/saved | Make sure the workspace's `.dsh-notes` points to an existing writable directory (create a workspace in the dsh sidebar first). |

Rollback: `dsh plugin --profile web remove dsh-md-notes` restores the previous state (notes files are untouched).

## Development

```sh
npm install --legacy-peer-deps   # first time or after dependency changes
npm run link-deps                # link deepseek-harness checkout types (before changing code)
npm run build                    # build lib/index.js + lib/client.js
```

After changing code and building successfully, restart dsh web for it to take effect.

Common scripts:

| Command | Purpose |
|---|---|
| `npm run build` | Full build (tsc host → tsc client → tsdown) |
| `npm run typecheck` | Type-check only (both programs) |
| `npm run link-deps` | Re-link `@deepseek-ai/*` types to the checkout |
| `npm run bundle` | Build only the client bundle |

Contributions are welcome: open an issue to discuss, then a PR. Design docs: [docs/features.md](docs/features.md) · [docs/architecture.md](docs/architecture.md).

## Repository structure

| Path | Contents |
|---|---|
| `src/` | Source code (host half + client half) |
| `src/host/` | Notes domain logic (`notes.ts`) + HTTP layer (`http.ts`) |
| `src/client/` | Browser half: entry (`index.ts`) + feature modules under `features/` |
| `src/client/features/locales/` | zh/en UI dictionaries (dsh locale namespace `md-notes`) |
| `assets/` | Plugin icon (SVG source + PNG) |
| `docs/` | Design docs: `features.md` (functional), `architecture.md`, `TODO.md` |
| `scripts/` | Dev tooling (e.g. `link-deps.mjs`) |
| `lib/` | Build output (gitignored; what npm publishes) |

## License & security

Licensed under the **MIT License** (see [LICENSE](LICENSE)).

Security issues: please report them **privately** via the repository's [Security Advisory](https://github.com/XieZongChen/dsh-md-notes/security/advisories) rather than a public issue, so they can be addressed before disclosure.
