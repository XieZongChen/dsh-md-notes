# Changelog

> [中文](CHANGELOG.zh.md) · English

This project follows [Semantic Versioning](https://semver.org/).
Only user-visible functional changes are recorded (no documentation, code refactoring, or build/toolchain adjustments).

**Recording rules**:

- Sections are fixed to **Breaking → Added → Fixed**, in that order; when a
  change's section does not exist yet, **add it**; when a section ends up with
  no entries, **remove it**.
- A feature that lands in the current version is recorded once, under **Added**;
  fixes to that same feature **within the same version** are **not** recorded
  (they are part of building the feature, not repairs of a shipped behavior).
- **Fixed** only records fixes to features from **earlier versions**.
- **No operational how-to details**: an entry states the feature and links to
  the matching section (anchor to the heading) of the [user guide](docs/usage.md).
  Usage instructions live in the guide, not here — if the guide lacks a feature,
  document it there first, then reference it.
- Unreleased changes go under **`## NEXT_VERSION`** at the top; on release, run
  `npm run changelog:release -- <version>` — it renames `NEXT_VERSION` to `[<version>] - <date>`
  and does **not** create a new one (no empty blocks while nothing is in development). When a
  change lands, check whether a `NEXT_VERSION` block exists — if not, add one, then record the
  change under it.

## [0.6.0] - 2026-08-20

### Added

- **Note write mutex (write lock)**: writes to a note (save / append-from-conversation
  / delete) are mutually exclusive **across sessions** — while a note is being written,
  writes to it from any session are rejected (host keyed lock, `note-writing`), and the
  in-progress state is surfaced everywhere: the picker disables the note with a row
  loading, the manager shows a row loading (delete hidden) and disables edit/update/
  save/push with a "Writing file…" hint, and the sidebar entry shows a loading with a
  "{count} note(s) writing" tooltip. All positions restore automatically when the write
  finishes. Design: [docs/write-lock.md](docs/write-lock.md); state conventions:
  [docs/state.md](docs/state.md).

### Fixed

- **Note append is instant and no longer blocks the manager**: the question/answer
  text + session title are captured client-side from the browser conversation
  snapshot (same source as the copy button) and sent to the host, which only
  writes the file — the previous `sessionQuery.readSession` read the whole
  session log (deep-cloning + replay-validating it), which synchronously blocked
  the event loop on long sessions and froze the manager's list/read requests
  until the write finished.
- **Git sync pull/update no longer fails**: gitPull is no longer short-circuited
  by a premature remoteAhead check (the check now runs before checkout), and a
  manual update can pull remote content when "local is behind but git refs are
  in sync". See
  [User guide §5 — Git sync](docs/usage.md#5-git-sync-optional).
- **Cross-workspace `@` reference no longer reports "note not found"**: path
  resolution failed for cross-workspace / nested-workspace references, breaking
  serialization — fixed. See
  [User guide §4.2 — Referencing notes from other workspaces](docs/usage.md#42-referencing-notes-from-other-workspaces).

## [0.5.0] - 2026-08-19

### Added

- **Append-section format** (记入笔记): the timestamp heading is now
  `## <session title> -- <timestamp>` and role labels are h3 subsection
  headings `### 👤 <user>` / `### 🤖 <assistant>`, so the question and the
  answer read as distinct blocks in the preview; reasoning is intentionally
  NOT captured — only the final answer is recorded, matching how dsh surfaces
  the response (Think is transient).
- **Note references serialize as standard markdown links**: a referenced note now
  appears in the message as `引用笔记 [title](path)` / `Referenced note
  [title](path)` — the title and path bind as one structured token the model
  parses reliably and any markdown renderer (including a future note-jump
  feature) recognizes as a link.
- **Note preview uses dsh's `MarkdownText`**: the notes-manager preview now renders
  with dsh's own MarkdownText (micromark stack: GFM tables / task lists / ordered
  lists, TeX math, code highlighting, built-in XSS safety), matching the chat
  rendering. See
  [User guide §2 — Opening the notes manager](docs/usage.md#2-opening-the-notes-manager).
- **Notes-manager open behavior**: clicking an existing note opens **Preview**
  by default (the Preview tab comes first); a newly created note opens directly
  in **Edit** mode. See
  [User guide §2 — Opening the notes manager](docs/usage.md#2-opening-the-notes-manager).

### Fixed

- Remote-update detection no longer false-positives: it now compares git
  references (rev-list ahead count) instead of file contents — unsynced local
  edits no longer report "update available"; a manual update no longer
  overwrites local changes when the remote has nothing new.
  See [User guide §5 — Git sync](docs/usage.md#5-git-sync-optional).

## [0.4.0] - 2026-08-18

### Added

- **Referencing notes in a conversation (`@`)**: pick notes as chips in the chat
  input — on send the host folds each referenced note's CONTENT into the model
  request (`agent/pre-step`), so citations work without relying on the model
  calling `read`; cross-workspace supported. See
  [User guide §4 — Referencing notes in a conversation](docs/usage.md#4-referencing-notes-in-a-conversation).
- **Note-picker enhancements**: the list is now grouped by workspace with
  fold/collapse (matching the manager's left panel) and notes from any
  workspace can be targeted; a **+** button on each workspace row creates a new
  note on the spot; a progress hint shows while the list loads. See
  [User guide §3 — Capturing a conversation into a note](docs/usage.md#3-capturing-a-conversation-into-a-note).
- **Update/push shortcut buttons on workspace rows**: each workspace row in the
  manager's left panel gains update/push icon buttons (still usable after the
  workspace's last note is deleted). See
  [User guide §2 — Opening the notes manager](docs/usage.md#2-opening-the-notes-manager).

## [0.3.0] - 2026-08-16

### Breaking

- **`root` config removed** — notes are now bound to workspaces (`<workspace>/.dsh-notes`); the old
  `root`-configured notes directory is ignored and existing notes there are **not auto-migrated**
  (copy them into the workspace's `.dsh-notes` manually). Without a workspace, notes can't be
  read/written (the UI prompts to create one).
- **`list` API response restructured** — previously `{ ok, notes, dir }` for a single fixed directory,
  now `{ ok, workspaces: [{ workspaceId, name, notes }], noWorkspaces }` grouped per workspace.
- **`notesApiHandler` signature changed** — from a fixed `dir` to a deps object resolving the directory
  per workspace (internal host API; the bundled client was updated in lockstep).

### Added

- **Git sync** (URL-driven): configure a repo URL and the plugin manages a local
  clone; two mutually exclusive modes (shared repo / own repos), mirror-sync
  push, conflict handling and auto-pull. See
  [User guide §5 — Git sync](docs/usage.md#5-git-sync-optional) (modes
  [§5.1](docs/usage.md#51-two-modes-choose-one), push
  [§5.2](docs/usage.md#52-pushing-notes), update
  [§5.3](docs/usage.md#53-updating-notes-pulling), auto-pull
  [§5.4](docs/usage.md#54-auto-pull-when-opening-a-note), rejected pushes
  [§5.5](docs/usage.md#55-when-a-push-is-rejected)).
- Git settings panel (dsh Settings → MD Notes) —
  [User guide §6](docs/usage.md#6-the-settings-panel).
- **Update notifications**: an npm version check on load shows an "Update
  available" tag — [User guide §7](docs/usage.md#7-update-notifications).
- Notes are workspace-bound (`<workspace>/.dsh-notes`); without a workspace the
  UI prompts to create one first — [User guide §1](docs/usage.md#1-where-your-notes-live).
- Interface copy fully internationalized: host errors return machine codes +
  detail, the client renders localized text (`gitErrorText`).
- dsh-styled form controls (DshInput / DshSelect) and a restyled full-screen
  notes manager (title-bar settings button, per-workspace grouping/collapse,
  status line).

### Fixed

- Notes appended from an English UI previously wrote Chinese section labels ("用户"/"DSH") — now
  localized ("User"/"DSH").
- Primary buttons (save/confirm) were white-on-white in dark mode — now use theme tokens.
- Note-picker "New" button wrapped to its own line (input field consumed the row) — fixed.
- Punctuation normalized across locales (Chinese copy drops trailing periods; English sentences gain them).

## [0.2.0] - 2026-08-16

### Added

- UI copy now follows dsh's locale: all interface texts (sidebar entry, action tooltip, both popups, buttons)
  moved to the `md-notes` dictionary namespace — they switch between Chinese/English together with the host app's language
  ([User guide §8](docs/usage.md#8-tips--notes)).

## [0.1.1] - 2026-08-16

Docs-only release — no functional changes. README and CHANGELOG now default to English, with Chinese versions available via `README.zh.md` / `CHANGELOG.zh.md`.

## [0.1.0] - 2026-08-16

### Added

- Official bundle plugin (persists with dsh, survives restarts), installed via `dsh plugin --profile web add`
- **Sidebar entry** and **notes manager** (create / edit / preview / delete) —
  [User guide §2](docs/usage.md#2-opening-the-notes-manager)
- **Add to note**: capture the current question + answer into a note from the
  assistant action bar — [User guide §3](docs/usage.md#3-capturing-a-conversation-into-a-note)
- Notes are plain `.md` files (default `<cwd>/.dsh-notes`, overridable via Config `root`);
  `meta.json` records the title and updated time
