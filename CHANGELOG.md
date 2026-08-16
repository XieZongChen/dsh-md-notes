# Changelog

> [中文](CHANGELOG.zh.md) · English

This project follows [Semantic Versioning](https://semver.org/).
Only user-visible functional changes are recorded (no documentation, code refactoring, or build/toolchain adjustments).

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
