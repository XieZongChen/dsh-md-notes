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
- **Assistant-message action** (next to copy) → pick or create a note and append that conversation (user question + answer) to it **instantly** — the text is captured from the conversation itself, so there's no waiting; section labels are localized (reasoning is not captured — only the final answer).
- **Reference notes in chat (`@`)**: type `@` to pick notes (cross-workspace included); on send the host injects each note's content into the model context, so the model can cite it without being asked to read files.
- **Git sync** (optional, URL-driven): **shared repo** mode (one repo for all workspaces, per-workspace folders) or **own repos** mode (per workspace: URL + branch + subpath). Push = mirror-sync (deletions included), Update = pull with three-way conflict confirmation, auto-pull on open, merge-remote-and-retry. Each workspace shows a **Git sync card** in the manager: "Synced" / "N unpushed" status, plus a hint when the remote has new commits.
- **Note write mutex**: writes to the same note are locked across sessions — the sidebar entry, picker and manager stay in sync until the write finishes.
- **Settings panel** (dsh Settings → MD Notes): mode, repo URL/branch/subpath, auto-pull, commit author — with dsh-styled form controls.
- **Theme & i18n**: token-based colors (light/dark), UI copy follows dsh's language (Chinese / English), error messages localized.
- **Update notifications**: a yellow "Update available" tag appears when a newer npm version exists.

**On the roadmap** (see [docs/TODO.md](docs/TODO.md)): visual Git conflict rendering & resolution, note capability enhancements (search / TOC / wiki links), and interaction UX polish (dirty-editor reminders, save shortcut, etc.).

## Compatibility

dsh iterates fast and provides **no backward compatibility**, so a fixed dsh version only
matches fixed plugin versions. Verified combinations are listed below (full adaptation
history in [docs/compatibility.md](docs/compatibility.md)):

| Plugin version | dsh version | Verified on |
|---|---|---|
| 0.10.1 | `0.1.2-alpha.5` | 2026-09-03 |
| 0.10.0 | `0.1.2-alpha.5` | 2026-09-02 |
| 0.10.0 | `0.1.2-alpha.4` | 2026-09-02 |

The plugin is not pinned to a specific mainline commit; pin the plugin version at install
time if you need a fixed combination (e.g. `dsh plugin --profile web add dsh-md-notes@0.10.1`).
Runtime dependencies (`@deepseek-ai/*`, `react`) are declared as optional peer dependencies
and resolve from the dsh installation.

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
2. **Create a note**: click the notes entry at the bottom of the sidebar (above Settings) → click **+** on a workspace row → in the dialog enter a title (default "Untitled note <date>") and an optional **file name** → type in the editor → **Save**.
3. **Capture a conversation**: below any assistant answer, click the notes icon (next to copy) → pick a target note (or create one on the spot) → **Write to note**. The user question + answer are appended to the note as a "<session title> -- <timestamp>" section.
4. **Reference a note**: type `@` in the chat input to pick a note (cross-workspace included); on send the note's content enters the model context automatically.

Note files live in each workspace's `.dsh-notes/` directory (`<workspace>/.dsh-notes`); you can open and edit them directly with any editor. Git sync is optional — point the plugin at a repo URL and it keeps notes in sync (shared repo or per-workspace repo).

> For everything the plugin can do — the notes manager, capturing conversations, Git sync (shared / per-workspace repos), pushing/updating, conflict handling, and the settings panel — see the [User Guide](docs/usage.md).

## Configuration

All options are plugin Config keys, overridable in the profile's `cordis.patch.yml` (a patch replaces the whole `config` of the row):

```yaml
- id: md-notes
  config:
    gitMode: 'off'               # 'off' | 'shared' | 'own'
    gitAutoPull: true            # pull remote before opening a note
```

The HTTP API prefix is fixed at `/plugins/md-notes` (the browser half hardcodes the same constant, so it is intentionally not configurable).

| Key | Default | Meaning |
|---|---|---|
| `gitMode` | `'off'` | Git sync mode: `'off'` off / `'shared'` shared repo / `'own'` per-workspace repos. |
| `gitAutoPull` | `true` | Pull the remote before opening a note. |

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

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Repository structure

| Path | Contents |
|---|---|
| `src/` | Source code (host half + client half) |
| `src/host/` | Notes domain (`notes.ts`) + Git (`git.ts`) + HTTP layer (`http.ts`) + context injection (`context-inject.ts`) + write mutex (`keyed-lock.ts`) |
| `src/client/` | Browser half: entry (`index.ts`) + feature modules under `features/` (one directory per feature; when one outgrows a single file it splits out feature-private `components/` and `hooks/` subdirectories — see `NotesManager/` for the pattern, `docs/architecture.md`) |
| `src/client/features/locales/` | zh/en UI dictionaries (dsh locale namespace `md-notes`) |
| `assets/` | Plugin icon (SVG source + PNG) |
| `docs/` | Docs: `usage.md`/`usage.zh.md` (user guide), `features.md` (functional), `architecture.md`, `context.md` (@ references), `git.md` (Git sync), `state.md` / `write-lock.md` (state & write-mutex design), `manager-redesign.md` (manager redesign), `compatibility.md` / `compatibility.zh.md` (dsh ↔ plugin version compatibility matrix, en/zh), `TODO.md` |
| `scripts/` | Dev tooling (e.g. `link-deps.mjs`) |
| `lib/` | Build output (gitignored; what npm publishes) |

## License & security

Licensed under the **MIT License** (see [LICENSE](LICENSE)).

Security issues: please report them **privately** via the repository's [Security Advisory](https://github.com/XieZongChen/dsh-md-notes/security/advisories) rather than a public issue, so they can be addressed before disclosure.
