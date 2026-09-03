/**
 * dsh-md-notes settings namespace (`md-notes`): the durable user-level layer
 * (L3) of the plugin's three-layer configuration model. Registered host-side
 * via `ctx.settings`, written by the settings panel, and merged over the
 * cordis Config (L2) at read time.
 *
 * Model (v4): notes ALWAYS live at `<workspace>/.dsh-notes` locally; the git
 * repo is identified by its **URL only** — the plugin manages a local clone
 * under `$DSH_HOME/md-notes-repos/<url-hash>/`, so the user never supplies a
 * path (and no sandbox authorization is needed). Two mutually exclusive modes:
 *  - `gitMode: 'shared'` — one shared repo (`gitCentral` = URL + optional
 *    branch), all workspaces sync into that branch under a per-workspace folder.
 *  - `gitMode: 'own'` — no shared repo; each workspace configures its own
 *    repo `{ remote, branch?, subpath? }`.
 * @module dsh-md-notes/settings
 */

import s from '@deepseek-ai/schemastery'
import type { CentralSettings, GitMode, MdNotesSettings, RepoSettings } from '../contract.ts'

// Wire entities live once in src/contract.ts; the schema below validates them.
export type { CentralSettings, GitMode, MdNotesSettings, RepoSettings }

/**
 * The plugin's settings namespace id (L3). A plain string literal: since
 * dsh `0.1.2-alpha.2` the `settingsNamespace()` helper was removed from
 * `@deepseek-ai/dsh-settings` — namespaces are now branded-string-typed and
 * validated inside `settings.register()` (`parseSettingsNamespace`, pattern
 * `[a-z][a-z0-9-]*`), which `'md-notes'` satisfies.
 */
export const MD_NOTES_NS = 'md-notes'

/** Wire schema; also the envelope the browser scope validates against. */
export const MdNotesSettingsSchema: s<MdNotesSettings> = s.object({
  gitMode: s.union([s.const('off'), s.const('on'), s.const('shared'), s.const('own')]).required(false),
  gitCentral: s.object({
    remote: s.string().required(false),
    branch: s.string().required(false),
  }).required(false),
  gitRepos: s.dict(s.object({
    remote: s.string().required(false),
    branch: s.string().required(false),
    subpath: s.string().required(false),
  })).required(false),
  gitAutoPull: s.boolean().required(false),
  gitAuthorName: s.string().required(false),
  gitAuthorEmail: s.string().required(false),
})

/**
 * Merge the L2 cordis Config (deployment defaults) with the L3 user settings
 * into one effective view. Top-level L3 wins; per-workspace repos merge
 * key-wise. `gitMode: 'on'` (legacy) is normalized: a configured shared repo
 * → 'shared', otherwise → 'own'.
 */
export function mergeSettings(
  config: {
    gitMode?: 'off' | 'on' | 'shared' | 'own'
    gitCentralRemote?: string
    gitCentralBranch?: string
    gitRepos?: Record<string, RepoSettings>
    gitAutoPull?: boolean
    gitAuthorName?: string
    gitAuthorEmail?: string
  },
  l3: MdNotesSettings | undefined,
): MdNotesSettings {
  const user = l3 ?? {}
  // L2 (config) `shared` / `own` pass through; only legacy `on` normalizes.
  const mode = user.gitMode ?? config.gitMode ?? 'off'
  const normalized = mode === 'on'
    ? (user.gitCentral?.remote ?? config.gitCentralRemote) ? 'shared' : 'own'
    : mode
  return {
    gitMode: normalized,
    gitCentral: {
      remote: user.gitCentral?.remote ?? config.gitCentralRemote,
      branch: user.gitCentral?.branch?.trim() ? user.gitCentral.branch : config.gitCentralBranch,
    },
    gitRepos: { ...(config.gitRepos ?? {}), ...(user.gitRepos ?? {}) },
    gitAutoPull: user.gitAutoPull ?? config.gitAutoPull ?? true,
    gitAuthorName: user.gitAuthorName ?? config.gitAuthorName ?? '',
    gitAuthorEmail: user.gitAuthorEmail ?? config.gitAuthorEmail ?? '',
  }
}
