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
- **dsh version adaptations**: when the plugin adapts to a new deepseek-harness
  version, record one **Added** entry "Adapt to deepseek-harness `<version>`"
  describing the migration (dependency / symbol / API changes). It means "this
  plugin version is verified against that dsh version", complementing the
  [compatibility table](docs/compatibility.md) — the table records which plugin
  version maps to which dsh version, the CHANGELOG records what the adaptation
  changed.
- **No operational how-to details**: an entry states the feature and links to
  the matching section (anchor to the heading) of the [user guide](docs/usage.md).
  Usage instructions live in the guide, not here — if the guide lacks a feature,
  document it there first, then reference it.
- Unreleased changes go under **`## NEXT_VERSION`** at the top; on release, run
  `npm run changelog:release -- <version>` — it renames `NEXT_VERSION` to `[<version>] - <date>`
  and does **not** create a new one (no empty blocks while nothing is in development). When a
  change lands, check whether a `NEXT_VERSION` block exists — if not, add one, then record the
  change under it.

## NEXT_VERSION

### Breaking

- **After upgrading to dsh ≥ `0.1.5-alpha.1`, historical sessions that used `@` note references
  on older dsh builds cannot be opened**: dsh `0.1.5-alpha.1` upgrades the session-log format
  to V3, and the V2→V3 migration validates message `source.kind` against a whitelist — the
  context injected by older plugin versions used the custom kind `'md-notes'`, which is not on
  it, so any log containing such events is **refused entirely** (`cannot safely transform
  unclassified message source`). The root cause is dsh's format-migration policy, and **the
  plugin cannot repair logs already written** (log files belong to dsh; the plugin only
  produces events and never touches storage). Mitigation: export/archive sessions that used
  `@` references before upgrading dsh, or wait for dsh upstream to admit `'md-notes'` to the
  migration whitelist (tracked in the compatibility entry at the top of
  [docs/TODO.md](docs/TODO.md)). From this version on the injection uses the official source
  shape, so **new sessions are unaffected** — and sessions written by the new plugin version
  on older dsh (V2 logs) also migrate smoothly. The settings panel now ships a one-click
  **"Repair legacy sessions"** action (see Added below) that rewrites affected logs in place.

### Added

- **Capture into note carries deliverables and images**: when capturing an
  answer into a note, files the answer produced (`write` / `edit` /
  `str_replace_editor` paths) ride along as note-dir-relative links (a
  `📎 produced files` section, deduped); images in the answer are referenced
  IN PLACE through the plugin's own route — **zero copy** (the URL carries the
  durable attachment reference; the host reads bytes from dsh's attachment
  store on demand and writes nothing anywhere; previews render them inline).
  Limitation: image bytes stay in the local attachment store — on machines a
  git-synced note reaches, the text arrives but images do not display (a
  "copy into repo" option could follow if cross-machine images matter). See
  [docs/usage.md §3](docs/usage.md#3-capturing-a-conversation-into-a-note).
- **Settings: "Repair legacy sessions"**: a one-click sweep over every local
  session log rewrites the `md-notes` message sources written by old plugin
  versions into the official `plugin` **minimal form** (dropping extra members
  such as `path` per the v0→v1 migration's exact key set; idempotent — a
  second pass cleans earlier intermediate output), restoring readability of history
  that dsh 0.1.5+ refuses to open. Each original is backed up beside its file
  (`*.dsh-md-notes-repair.bak`), replacement is atomic, no restart needed; the
  result reports scanned/repaired counts, failures, and any dsh-native legacy
  source kinds that may still block a session. See
  [docs/usage.md §6](docs/usage.md#6-the-settings-panel).
- **dsh version alignment rule (stable versions only)**: from now on the plugin
  aligns only with dsh `rc` and (future) `final` releases — dsh's npm `latest`
  dist-tag points at an rc, which is what users actually install; alphas are no
  longer checked per-version (one rc check covers the whole line's alpha range;
  a specific alpha is spot-checked only to use a capability it introduced or to
  confirm a breaking change). See the
  [README compatibility section](README.md#compatibility) and
  [docs/compatibility.md](docs/compatibility.md).
- **@ note-chip click preview**: clicking an inserted note chip in the composer
  opens that note in the right-sidebar viewer before sending (the dsh 0.1.5+
  reference-preview gesture); on builds without the right sidebar the click
  behavior is unchanged. See
  [docs/usage.md §4.1](docs/usage.md#41-picking-a-note).
- **@ candidate rows now lead with the plugin logo**, matching the chip (the
  generic file icon before).
- **Search results "view in sidebar"**: every note row in the notes manager's
  search results gains a panel action — opens that note in the right-sidebar
  note viewer (absolute file address routed through `openResource`; the same
  note reuses its tab) and dismisses the fullscreen manager. Requires the
  dsh 0.1.5+ right sidebar; the action hides on older builds. See
  [docs/usage.md §9](docs/usage.md#9-quick-note-viewing-in-the-right-sidebar-dsh-015).
- **Local images render in previews**: local-path images in notes
  (`![](img.png)`, `../shot.png`, absolute paths) display inline in the
  manager preview and the sidebar viewer — rewritten through
  `MarkdownText`'s `pathImages` vocabulary to the same-origin authenticated
  `/api/file` URL (destinations resolve against the note's own directory).
  Not enabled on dsh < 0.1.5 or non-HTTP transports (Electron `file://`),
  falling back to alt text. See
  [docs/usage.md §9](docs/usage.md#9-quick-note-viewing-in-the-right-sidebar-dsh-015).
- **Right-sidebar note viewer**: on dsh 0.1.5+'s right dockable sidebar, note files
  (`/.dsh-notes/…/*.md` addresses) open rendered as markdown (taking over the
  built-in plain-text preview at `extension` priority) — reachable from
  conversation file links and the file tree; interlinks in the body
  (`` `name` `` / `[[name]]`) open the target note as another sidebar tab; the
  header carries the title, its workspace, and a manual reload; read-only
  (editing stays in the manager). Disables itself on older dsh. See
  [docs/usage.md §9](docs/usage.md#9-quick-note-viewing-in-the-right-sidebar-dsh-015).
- **Adapt to deepseek-harness `0.1.5-alpha.1`**: the injected-context source migrates to the
  official `plugin` variant (`{ kind: 'plugin', plugin: 'md-notes', path }`), satisfying the
  V2→V3 log migration's source whitelist — `@` reference injection, injected-context row
  rendering (label still `md-notes`), and cross-step dedupe behave unchanged. Rationale in
  [docs/context.md §3.7](docs/context.md#37-模型可靠性host-端内容注入已实现).

### Fixed

- **Clicking a cross-workspace note chip crashed the composer (no viewer, chip
  undeletable)**: the preview address for cross-workspace references carries
  `..` segments, which picomatch's `**` (the sidebar's tab routing) cannot
  match — no type claims it, `claim` throws through Lexical's chip command and
  poisons the editor (the #20 error cascade; the chip could not be deleted).
  Cross-workspace refs now resolve through the settled workspace snapshot to
  an ABSOLUTE address (an in-memory navigation argument only — never enters
  the draft, message, notes, or logs); an unsettled snapshot or any open
  failure declines safely (the click becomes a no-op) instead of throwing
  into the editor.
- **`@` menu empty on the first page after startup (refresh fixed it)**: on the
  page auto-opened right after `dsh web` starts, a draft session is not yet
  materialized host-side, and the `@` source's per-session note list cached
  that "transiently empty" result **forever** — the menu stayed blank no
  matter how long one waited; only a page refresh recovered. Empty results are
  now retried on the next `@` unless no workspaces exist at all.
- **`.conflicts` leftovers after conflict resolution**: sidecar cleanup only
  rode the AI push tool's path — resolving through the manager's push or
  "merge remote & retry" left the `.dsh-notes/.conflicts/` directory behind.
  Cleanup now runs at gitPush's success exit (shared by every push path; the
  AI flow is unchanged).
- **@ references no longer carry absolute paths**: in a rare window (picking a
  note before the session workspace list settles) a reference could serialize
  an absolute path containing the machine's home directory into the message,
  which could then reach a git-synced repo via "capture into note". The pick
  now declines instead (just pick again); absolute-path chips persisted by
  older versions are rewritten at submit time to
  `workspace-name/.dsh-notes/note-name` — references are relative-only now.

## [0.12.0] - 2026-09-06

### Added

- **AI conflict resolution**: the push-blocked and update-conflict dialogs gain
  an "AI resolve" action — a conversation is created in the conflicting workspace
  and the local/base/remote versions of each conflicting note are handed to the
  model for a semantic merge (undecidable points are asked back via ask_user);
  when done the AI requests the push through dsh's native approval panel, and
  the remote is only touched after you confirm. See
  [docs/ai-conflict.md](docs/ai-conflict.md).
- **Note search**: the notes manager gains a search box in its top bar —
  full-text search across every workspace's notes (titles and bodies,
  case-insensitive; space-separated keywords combine with AND). Results are
  grouped by workspace with matched-line snippets and keyword highlighting;
  clicking a hit opens the note in the editor on that line with the keyword
  selected. See [docs/usage.md §2 "Searching notes"](docs/usage.md#searching-notes).
- The settings panel's Git-mode dropdown now opens the harness-style custom
  menu (portaled card, check-marked rows, outside-click/Escape dismissal)
  instead of the OS-native select popup, and text-input borders/focus follow
  the harness settings form. See
  [docs/usage.md §6](docs/usage.md#6-the-settings-panel).

### Fixed

- Fixed saves stalling 10+ seconds on slow networks: the per-workspace git
  status requests fired when the manager opens were parallel (on shared-repo
  mode the server serializes them anyway, so the extra connections just sat
  parked); together with the auto-pull they could occupy every same-origin
  browser connection, queueing the save POST behind git fetches. Statuses are
  now fetched strictly one at a time.
- Fixed the git clone being permanently wedged after "merge remote & retry" hit a
  merge conflict (an uncleaned MERGE_HEAD broke every later sync); the leftover
  merge is now aborted automatically and the clone recovers.

## [0.11.0] - 2026-09-04

### Breaking

- Removed the unused `gitSuggest` API method (and its client wrapper): nothing
  in the plugin ever called it, and it exposed workspace paths to any caller.
- Removed the `route` config option. The HTTP API prefix is now the fixed
  constant `/plugins/md-notes` on both sides: the browser frontend always
  hardcoded it, so overriding the backend prefix only severed the frontend↔backend
  link. Existing configs carrying a `route` key keep loading (schemastery
  passes unknown keys through; the value is ignored).

### Added

- New `checkUpdate` config (default `true`): set it to `false` and the host
  never contacts registry.npmjs.org — for offline or managed deployments the
  update check used to be an unconditional outbound call.

### Fixed

- Fixed two Git first-sync defects on a fresh device (fresh clone + empty
  notes dir): ① pulling did nothing — an absent local file read as a local
  edit (skipped), and the auto-pull short-circuited on "no new remote
  commits", so remote notes never came down; ② pushing from that state
  mirror-deleted the ENTIRE remote without confirmation. The last-synced
  baseline is now empty until the first completed sync (a marker persisted
  inside the clone's `.git/`, never committed): the first pull brings all
  remote notes down, and the first push blocks with remote-changed asking
  for confirmation.
- Fixed the sidebar footer entries squeezing/overflowing each other ([#2]):
  dsh's `.footerActions` lays its `width:100%` children (the default-bundled
  cordis entry and the notes entry) out in one non-wrapping row. The plugin
  now stacks them via a `[data-slot]`-anchored rule — one declarative
  `<style>` of its own (auto-removed on unload), no ancestor inline styles,
  visually unchanged when only one entry is present. (The root fix belongs
  upstream; see docs/TODO.md.)
- Security: the plugin's HTTP API and icon routes now run behind the same
  trust fence as dsh's official `/api` channel (`connection.requestRejection`):
  requests without an authenticated browser session are rejected with 401 and
  untrusted Host/Origin with 403, before any note/git operation or settings
  write is dispatched (see [architecture §3](docs/architecture.md#3-后端src)).
  Profiles without the connection service (e.g. Electron IPC) are unchanged.
- Security: `gitStatus` no longer returns the raw git remote URL; embedded
  credentials (`https://user:token@…`) are redacted to `https://***@…` in the
  display copy (the settings form still edits the raw value).

[#2]: https://github.com/XieZongChen/dsh-md-notes/issues/2

## [0.10.1] - 2026-09-03

### Fixed

- Fixed the @ reference candidate menu not re-opening after a cross-workspace
  auto-complete (moved re-track off the deprecated `conversation.input.track/snapshot`
  to `inputTriggers.sessionOf().track()`).

## [0.10.0] - 2026-09-01

### Added

- **Git card interaction redesign**: workspace rows drop the collapse arrow for a
  **git status icon** (theme-tinted + red/amber dots for local-unpushed /
  remote-updated + tooltip); the Git card is collapsed by default and opens on
  icon click, closing when its workspace collapses; card info lines (branch /
  subpath / last commit) don't wrap, ellipsize when overflowing, and show the
  full text on hover; workspaces without a configured repo don't show the git
  icon. See [User guide §5 — Git sync](docs/usage.md#5-git-sync-optional).
- **Push interaction redesign**: clicking **Push** switches the button row to a
  **commit-message row** (replacing the old commit popover); it reverts on
  success/cancel and stays on failure (including non-fast-forward). See
  [User guide §5.2 — Pushing notes](docs/usage.md#52-pushing-notes).
- **Dialog close buttons match dsh**: the notes manager and note picker close
  buttons now use dsh's closeBtn (`IconCloseOutline16`). See
  [User guide §2 — Opening the notes manager](docs/usage.md#2-opening-the-notes-manager).
- **Adapt to deepseek-harness `0.1.2-alpha.2`**: drop the removed
  `settingsNamespace` dependency; `MD_NOTES_NS` is now a plain string (validated
  at register time).

## [0.9.0] - 2026-08-29

### Breaking

- **Shared-repo subdirectories are now pinned by a mapping (rename-safe)**: shared mode now uses a
  committed `.dsh-notes-workspaces.json` (keyed by workspace id) to pin each workspace's
  subdirectory — renaming a workspace no longer moves or orphans its folder, and same-named
  workspaces no longer overwrite each other. **Migration impact**: only workspaces renamed *before*
  this upgrade are affected — the old subdirectory stays in the remote repo (the plugin no longer
  reads/writes it); local notes are **unaffected** (they always live locally under
  `<workspace>/.dsh-notes/`, git sync is only a mirror). To clean up, delete the old remote
  subdirectory — leaving it is harmless.

### Added

- **Note interlinking in the preview**: `[[笔记名]]` (wiki) and `` `笔记名` `` (backtick) written in a
  note's body render as clickable links that jump to the target note, including across workspaces.
  Links resolve by title or file name (case-insensitive), preferring the current workspace on name
  collisions; cross-workspace collisions disambiguate with `[[workspace/note]]`, and same-workspace
  title collisions show a hover hint ("N notes share this title — use the file name to be precise").
  See [User guide §2 — Opening the notes manager](docs/usage.md#2-opening-the-notes-manager).
- **Create-note dialog**: title and file name are decoupled at creation — you can set an explicit
  file name (blank = derived from the title; invalid chars → `-`, forced `.md` suffix). The dialog
  shows a live "Will create" preview plus a red duplicate warning that disables creation; both the
  manager and the note picker reuse this dialog. See
  [User guide §2 — Opening the notes manager](docs/usage.md#2-opening-the-notes-manager).
- **Adapt to deepseek-harness `0.1.2-alpha.1`**: the `@deepseek-ai/dsh-client-runtime`
  package was removed and split into several packages — migrated dependencies (added
  `dsh-client-store` / `dsh-client-ui-chat` / `dsh-client-ui-renderer`; `dsh.client.inject`
  now lists renderer / locale / conversation / input-trigger / chat); migrated symbols
  (`createSnapshotStore` → store, `ConversationSnapshot`/`AssistantBlock`/`ConversationNode`
  → ui-conversation, `SessionId` → session, `ClientContext` → cordis `Context`); the
  `assistant-actions` slot moved to ui-chat; `inputTriggers` became an `inject` hard
  dependency; `InputTriggerCandidate.icon` narrowed to `'file' | 'folder' | 'session'`,
  `Modal`'s `headless` branch no longer accepts `closeLabel`, and `MarkdownText` gained a
  required `labels` prop.

### Fixed

- Note capture sanitizes `noteName`, closing a path-traversal hole.
- Git operations are serialized per clone directory, removing concurrent push/pull races.
- `mergeSettings` no longer drops the L2 configured shared/own mode.

## [0.8.0] - 2026-08-25

### Added

- **Remote-update detection on the Git card**: `gitStatus` fetches the remote and
  returns `remoteAhead`; when the remote has new commits, the Git card shows
  "Remote has updates — update manually". See
  [User guide §5 — Git sync](docs/usage.md#5-git-sync-optional).
- **Overwrite dialog uses three-way conflict detection** (base / local / remote):
  differing content no longer always prompts — only a true three-way conflict
  asks. See [User guide §5 — Git sync](docs/usage.md#5-git-sync-optional).

### Fixed

- **Sidebar note-entry styles fixed**: it no longer depends on the footer's
  flex-wrap / flex-basis — a plain full-width row with `.notesRow` aligned to
  ui-cordis (not compressed by other footer entries). See
  [User guide §2 — Opening the notes manager](docs/usage.md#2-opening-the-notes-manager).

## [0.7.1] - 2026-08-23

### Fixed

- **Sidebar note-entry no longer pollutes ancestor styles**: the entry now only
  adjusts its direct parent's flex-wrap and no longer writes ancestor inline
  styles onto SidebarRoot (switched to an injected `:has()` CSS rule). See
  [User guide §2 — Opening the notes manager](docs/usage.md#2-opening-the-notes-manager).

## [0.7.0] - 2026-08-23

### Added

- **Notes-manager panel redesign**: each workspace row in the manager's left
  panel gains a **Git sync card** (branch / subpath / last commit / "Synced" or
  "N unpushed" status, update/push actions), layered above the note actions;
  the header adds a global Git summary line (`{ws} workspaces · {pending} to
  sync`). See
  [User guide §2 — Opening the notes manager](docs/usage.md#2-opening-the-notes-manager).
- **Note-reference chip shows the plugin logo**: the chip in the chat input now
  leads with the plugin icon (keeping the `appearance='notes'` scope). See
  [User guide §4.1 — Picking a note](docs/usage.md#41-picking-a-note).
- **`meta.json` is rebuilt automatically when missing**: the cache is
  reconstructed from note titles and file mtimes — no manual repair needed. See
  [User guide §1 — Where your notes live](docs/usage.md#1-where-your-notes-live).

### Fixed

- **Shared-repo Git status and commits are isolated per workspace subdirectory**:
  cross-workspace status/commit bleed in shared-repo mode is fixed. See
  [User guide §5 — Git sync](docs/usage.md#5-git-sync-optional).
- **`@` reference path falls back to the title**: references no longer point at
  a missing location after a workspace rename. See
  [User guide §4.2 — Referencing notes from other workspaces](docs/usage.md#42-referencing-notes-from-other-workspaces).

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
