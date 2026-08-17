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
  icon, a collapse arrow, and a **+** button (on the active workspace) to
  create a note.
- **Right — editor**, with **Edit / Preview** tabs and a **Save** button.

### Creating a note

Click **+** on a workspace row. A note is created with an auto title
("Untitled note <date>") and opens in the editor immediately.

### Editing & previewing

- **Edit** tab: write markdown source.
- **Preview** tab: see the rendered result.
- **Save**: writes to the local `.md` file and refreshes the list.

### Deleting a note

Hover a note in the list and click the 🗑 icon. A confirmation dialog asks for
confirmation (deleting cannot be undone).

## 3. Capturing a conversation into a note

Below any assistant answer, click the **notes icon** (next to the copy button).
A picker opens:

1. Choose an existing note (only notes of the current workspace's folder are
   listed), or create a new one on the spot.
2. Click **Write to note**. The user question + the answer are appended to the
   note as a timestamped section:

   ```markdown
   ---

   ## <timestamp> · <session title>

   **<user label>**:
   <question>

   **<assistant label>**:
   <answer>
   ```

## 4. Referencing notes in a conversation (@)

Type **`@`** in the chat input to pick a note: the pick inserts a **note chip**,
and on send each chip enters the model context as a **path reference** — the
model uses its `read` tool to load the note and can cite it in the answer.

1. Type `@` → the candidate menu lists notes of the **current workspace**
   (📝 prefix; the title is the primary row, the file name the secondary line).
2. Select with arrows / click → a note chip appears; keep typing `@` to add more.
3. **Cross-workspace**: type `@workspace-name/` (e.g. `@dsh-plugin/`, **ASCII
   names only**) → candidates switch to that workspace's notes (secondary line
   shows `workspace-name · file-name`).
4. Send → each chip serializes to `<note ref="<absolute note path>">title</note>`;
   the model reads the referenced note and answers with it. A plain-text
   `@note-title` you type by hand is only highlighted decoration — it does
   **not** enter the context; real references go through the menu (chip).
5. If a referenced note was deleted or moved, the send is blocked with
   "«name» could not be found. Remove the reference." — delete the stale chip
   and resend.

> Sessions without a workspace get no `@` candidates (silent).

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

1. Open any note and click **Push** (next to Save).
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

Click **Update** to pull the remote version of the notes down:

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
