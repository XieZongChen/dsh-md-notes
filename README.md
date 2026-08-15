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
  <a href="docs/features.md">Features</a> · <a href="docs/architecture.md">Architecture</a> · <a href="CHANGELOG.md">Changelog</a>
</p>

---

## Features

- **Sidebar notes entry** → notes manager (list + edit/preview)
- **Assistant-message action** (next to the copy button) → append that conversation to a note
- Notes are stored as plain `.md` files, editable directly on the filesystem

## Installation

Prerequisites: `dsh` CLI installed, target profile is `web`.

Install from npm (recommended):

```sh
dsh plugin --profile web add dsh-md-notes
```

Then **restart dsh web** (bundle layer and client package metadata are cached in the process; a restart is required for changes to take effect).

## Upgrade

```sh
dsh plugin --profile web update dsh-md-notes
```

A restart of dsh web is required for it to take effect.

## Uninstall

```sh
dsh plugin --profile web remove dsh-md-notes
```

> For development/debugging from source: run `dsh plugin --profile web add ./dsh-md-notes`
> from the parent directory of the plugin project.

## Usage

1. **Open the notes manager**: click the notes entry at the bottom of the sidebar (above Settings).
   - Left: note list (title + updated time); enter a title at the top and click "New" (an empty title auto-falls back to "Untitled note <date>");
   - Right: with a note selected, switch between the **Edit / Preview** tabs and click "Save" to write; 🗑 deletes a list item.
2. **Add to note**: click the notes icon in the action row below an answer, pick the target note in the popup (or create one on the spot), and click "Write to note" — the answer and its user question are appended to the end of the note (with a timestamped section).

Note files live in the configured local directory (currently `dsh-work/.dsh-notes/`); you can open and edit them directly with any editor.

## Maintenance

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

Configuration (notes directory, API route) and implementation details: [docs/architecture.md](docs/architecture.md).
