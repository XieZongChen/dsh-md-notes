# Changelog

> [中文](CHANGELOG.zh.md) · English

This project follows [Semantic Versioning](https://semver.org/).
Only user-visible functional changes are recorded (no documentation, code refactoring, or build/toolchain adjustments).

**Recording rules**:

- A feature that lands in the current version is recorded once, under **Added**;
  fixes to that same feature **within the same version** are **not** recorded
  (they are part of building the feature, not repairs of a shipped behavior).
- **Fixed** only records fixes to features from **earlier versions**.

## [Unreleased]

### Added

- **Git sync** (URL-driven): the plugin manages a local clone automatically — configure a repo URL,
  no path or authorization needed. Two mutually exclusive modes:
  - **Shared repo** — one repo for all workspaces, each workspace syncing into its branch under a
    per-workspace folder;
  - **Own repos** — per workspace: repo URL + branch (default `main`) + in-repo subpath (default repo root).
- Push = mirror-sync: local notes are copied into the repo target directory **and local deletions are
  synced to the remote** (after confirmation when the remote differs); Update pulls the remote branch and
  copies notes back without overwriting locally-modified files.
- Remote-change detection before push (`remote-changed`) and on open (`changed`): conflicts are surfaced
  with in-app confirmation dialogs (overwrite remote with local / use remote version), plus a
  "merge remote & retry" action for rejected pushes.
- Auto-pull on open (configurable, default on); the left list refreshes after a successful update so
  newly-pulled notes appear immediately.
- Git settings panel (dsh Settings → MD Notes): mode, repo URL/branch/subpath, auto-pull, commit author.
- Interface copy fully internationalized: host errors return machine codes + detail, the client renders
  localized text (`gitErrorText`); note-append section labels follow the UI language.
- dsh-styled form controls (DshInput / DshSelect) and a full-screen notes manager restyle (title-bar
  settings button, per-workspace grouping/collapse, status line).
- Notes are workspace-bound: without a workspace the UI prompts to create one first
  (notes manager and note picker).
- **Update notifications**: the plugin checks npm for a newer version on load (cached 10 min); a yellow
  "Update available" tag appears on the sidebar notes entry and next to the manager's settings button.

### Breaking

- **`root` config removed** — notes are now bound to workspaces (`<workspace>/.dsh-notes`); the old
  `root`-configured notes directory is ignored and existing notes there are **not auto-migrated**
  (copy them into the workspace's `.dsh-notes` manually). Without a workspace, notes can't be
  read/written (the UI prompts to create one).
- **`list` API response restructured** — previously `{ ok, notes, dir }` for a single fixed directory,
  now `{ ok, workspaces: [{ workspaceId, name, notes }], noWorkspaces }` grouped per workspace.
- **`notesApiHandler` signature changed** — from a fixed `dir` to a deps object resolving the directory
  per workspace (internal host API; the bundled client was updated in lockstep).

### Fixed

- Notes appended from an English UI previously wrote Chinese section labels ("用户"/"DSH") — now
  localized ("User"/"DSH").
- Primary buttons (save/confirm) were white-on-white in dark mode — now use theme tokens.
- Note-picker "New" button wrapped to its own line (input field consumed the row) — fixed.
- Punctuation normalized across locales (Chinese copy drops trailing periods; English sentences gain them).

## [0.2.0] - 2026-08-16

### Added

- UI copy now follows dsh's locale: all interface texts (sidebar entry, action tooltip, both popups, buttons)
  moved to the `md-notes` dictionary namespace — they switch between Chinese/English together with the host app's language.

## [0.1.1] - 2026-08-16

Docs-only release — no functional changes. README and CHANGELOG now default to English, with Chinese versions available via `README.zh.md` / `CHANGELOG.zh.md`.

## [0.1.0] - 2026-08-16

### Added

- Official bundle plugin (persists with dsh, survives restarts), installed via `dsh plugin --profile web add`
- **Sidebar entry**: notes entry at the top row of the sidebar bottom area; click to open the notes manager
- **Notes manager** (`shell.overlay` full-screen panel):
  - Left: note list (title + updated time); create (an empty title auto-falls back to "Untitled note <date>") and delete
  - Right: Edit / Preview tabs with a built-in lightweight markdown renderer; Save writes to disk
- **Add to note**: action icon below each answer; pick (or create) a target note in the popup — the user question + answer are appended to the end of the note with a timestamped section
- Notes are plain `.md` files (default `<cwd>/.dsh-notes`, overridable via Config `root`); `meta.json` records the title and updated time; editable directly on the filesystem
- Hover Tooltip "Add to note" on the assistant action (same as the copy button, side=bottom)
- Notes manager and note-picker popup titles now use the plugin SVG icon (same source as the sidebar/action icons)
- Icon trimmed: the SVG viewBox was tightened to remove the ~173px border, so it no longer renders small
- Sidebar entry and assistant-action styling aligned with native controls (Settings button / copy button)
