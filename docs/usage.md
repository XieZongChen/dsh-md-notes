# dsh-md-notes User Guide

A note-taking plugin for DeepSeek Harness (DSH). This guide covers **everything**
the plugin can do — from your first note to syncing notes with Git. It assumes
the plugin is installed (see [README](../README.md)).

**In a nutshell**: notes are plain `.md` files stored under each workspace's
`.dsh-notes/` directory. You can write them here, capture conversations into
them, and — optionally — back them up / sync them with a Git repository.

---

## 1. Where your notes live

- Every dsh **workspace** has its own notes folder: `<workspace>/.dsh-notes/`.
- Each note is a plain `.md` file. Open and edit it with any editor — the
  plugin picks up your changes the next time it reads the file.
- `meta.json` in the same folder is just a cache of titles/timestamps; ignore
  it (it's never committed to Git).

> Notes are **workspace-bound**: without a workspace there's nowhere to store
> them — create a workspace in the dsh sidebar first.

## 2. Opening the notes manager

Click the **notes entry** at the bottom of the sidebar. A full-screen manager
opens with two columns:

- **Left — note list**, grouped by workspace. Each workspace row has a folder
  icon, a collapse arrow, and a **+** button to create a note in that
  workspace (with Git enabled it also carries update/push icon buttons — see
  [§5](#5-git-sync-optional)).
- **Right — editor**, with **Edit / Preview** tabs and a **Save** button.

### Creating a note

Click **+** on a workspace row. A note is created with an auto title
("Untitled note <date>") and opens in the editor immediately.

### Editing & previewing

- **Edit** tab: write markdown source.
- **Preview** tab: see the rendered result (GFM tables / task lists / math /
   code highlighting).
- **Save**: writes to the local `.md` file and refreshes the list.

### Deleting a note

Hover a note in the list and click the 🗑 icon. A confirmation dialog asks for
confirmation (deleting cannot be undone).

## 3. Capturing a conversation into a note

Below any assistant answer, click the **notes icon** (next to the copy button).
A picker opens:

1. Choose an existing note — the list shows **all workspaces' notes**, grouped
   by workspace (fold/collapse a workspace row to browse; the current
   workspace's notes are included), or create a new one on the spot with the
   **+** button on any workspace row.
2. Click **Write to note**. The user question + the answer are appended to the
   note as a timestamped section (the picker closes itself ~1 second after a
   successful write):

   ```markdown
   ---

   ## <session title> -- <timestamp>

   ### 👤 <user label>
   <question>

   ### 🤖 <assistant label>
   <answer>

   > 💭 Think
   > <reasoning content>
   > 💭 Think end
   ```

## 4. Referencing notes in a conversation (@)

Type **`@`** in the chat input to pick a note: the pick inserts a **note chip**,
and on send the note's **content** is put into the model context automatically —
the model can see and cite the note without you having to tell it to read files.

### 4.1 Picking a note

1. Type `@` → the candidate menu lists notes of the **current workspace**
   (📝 prefix; the title is the primary row, the file name the secondary line).
2. Select with arrows / click → a note chip appears; keep typing `@` to add more.
3. Keep typing to **filter** the candidates (by title or file name).

### 4.2 Referencing notes from other workspaces

- Type a partial workspace name (e.g. `@dsh-pl`) → a **workspace row** appears
  (`dsh-plugin/`, 🗂️ icon);
- **Pick the workspace row** → it auto-completes to `@dsh-plugin/` and
  **immediately lists that workspace's notes**; keep typing to filter within it;
- An exact workspace name (`@dsh-plugin`) switches directly;
- **Chinese workspace names (no spaces) work**; only names **containing spaces**
  cannot be triggered by text (dsh's trigger token stops at whitespace — a
  platform limit; a menu-based all-workspaces picker is planned).

### 4.3 What happens on send

Two things:

1. **Your message keeps a readable reference line** (standard markdown link
   syntax) — e.g. `Referenced note [title](.dsh-notes/note.md)` (same workspace)
   or `Referenced note [title](../other-dir/.dsh-notes/note.md)` (cross-workspace)
   — it tells the model (and you) which note was referenced;
2. **The host injects the note's content into the model context** — a collapsible
   "context injection" row (source `md-notes`) appears in the chat; expand it to
   see the injected content. The model gets the content directly — it does **not**
   depend on calling its `read` tool itself.

### 4.4 Common questions

- **No need to re-reference for follow-ups**: the injected content stays in the
  session context (until dsh compacts old history), so follow-up questions
  (e.g. "what was X in the note?") work without re-referencing. If a note is
  large and you worry about context usage, start a new session or reference only
  the notes you need.
- **Note deleted / moved**: if the note no longer exists at send time, the send
  is blocked with "«name» could not be found. Remove the reference." — delete
  the stale chip and resend.
- **A typed `@note-title` does nothing**: plain-text `@note-title` is only a
  highlight decoration — it does **not** enter the model context; real
  references go through the menu (chip).
- **No workspace**: sessions without a workspace get no `@` candidates (silent).

## 5. Git sync (optional)

Git sync keeps your notes backed up and synchronized across machines. The
plugin manages a local **clone** of your repository automatically — you only
need to give it a repository **URL**.

> **Notes always live locally in `<workspace>/.dsh-notes`**. Git sync only
> pushes them to / pulls them from a repository; it never changes where notes
> are stored locally.

### 5.1 Two modes (choose one)

In the settings panel (see [§6](#6-the-settings-panel)), pick a mode:

| Mode | What it does | Configure |
|---|---|---|
| **Off** | No Git sync. Notes are just local files. | — |
| **Shared repo** | One repository for all workspaces. Each workspace's notes sync into that repo's branch under a folder named after the workspace. | Repo URL + optional branch (default `main`) |
| **Own repos** | Each workspace has its own repository. | Per workspace: repo URL + branch (default `main`) + in-repo subpath (default repo root) |

> Want a single repository for everything? Use **Shared repo** — every
> workspace gets its own folder automatically. Want different repos per
> project? Use **Own repos**.

### 5.2 Pushing notes

1. Open any note and click **Push** (next to Save) — or click the **push icon**
   on a workspace row in the note list.
2. A small panel asks for a commit message (default "Notes update <time>").
   Confirm to commit & push.
3. First push clones the repository automatically (credentials come from git
   itself — HTTPS credential helper or your SSH key).

**Before pushing**, the plugin checks the remote for notes that differ from
yours or exist only remotely (e.g. a note you deleted locally). If there's a
difference it asks:

> Remote notes differ from or are missing locally: `<names>`. Overwrite/delete
> the remote with your local state?

- **Overwrite remote with local** → push proceeds, including deletions.
- **Cancel** → nothing is pushed.

### 5.3 Updating notes (pulling)

Click **Update** (above the editor, or the **update icon** on a workspace row)
   to pull the remote version of the notes down:

- If the remote has **new notes** you don't have → they're pulled in and the
  list refreshes automatically.
- If a note differs on **both sides** (you edited it locally) → the plugin
  keeps your local version and asks whether to replace it:

  > The remote has N note(s) different from local ones. Replace local with the
  > remote version?

  - **Use remote version** → the remote copy overwrites your local file.
  - **Cancel** → local stays unchanged.

### 5.4 Auto-pull when opening a note

When you open a note, the plugin (if `gitAutoPull` is on) silently pulls the
remote first — **without overwriting** anything you've edited locally. If the
remote has notes that conflict with local ones, it shows a hint next to the
**Update** button: "Remote has updates — update manually." Click **Update** to
resolve.

### 5.5 When a push is rejected

If the remote is ahead or the histories are unrelated, the push is rejected
and you'll see a **"Merge remote & retry"** action. Click it to merge the
remote into the local clone, then push again.

## 6. The settings panel

Open the notes manager and click the **⚙ settings icon** next to the title (or
open dsh's Settings → **MD Notes** section). Everything Git-related is here:

- **Mode**: Off / Shared repo / Own repos.
- **Shared repo**: repository URL + branch (optional, default `main`).
- **Own repos** (per workspace): URL + branch + in-repo subpath.
- **Auto-pull on open** (checkbox, default on).
- **Commit author name / email** (used when the repository has no git identity
  configured; otherwise the repo's own config wins).

## 7. Update notifications

The plugin checks npm for a newer version of `dsh-md-notes` when it loads
(the check is cached for 10 minutes; failures are silent). If a new version
exists, a yellow **"Update available"** tag appears:

- at the **tail of the sidebar notes entry** (hover to see the version number);
- next to the **settings icon** in the notes manager title bar.

Upgrade with `dsh plugin --profile web update dsh-md-notes`, then restart dsh web.

## 8. Tips & notes

- **Files are yours**: notes are ordinary `.md` files; edit them anywhere, keep
  them after uninstalling the plugin.
- **meta.json** is a local cache only — it's never committed, and a fresh clone
  rebuilds it.
- **Deleting a note locally and pushing** removes it from the remote too
  (mirror sync), after confirmation.
- **Only `.md` files sync.** Non-markdown files you place in a remote
  repository are not pulled into your notes.
- **Language**: all UI copy follows dsh's language setting (Chinese / English).
