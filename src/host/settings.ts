/**
 * dsh-md-notes settings namespace (`md-notes`): the durable user-level layer
 * (L3) of the plugin's three-layer configuration model. Registered host-side
 * via `ctx.settings`, written by the settings panel / sync-area UI, and merged
 * over the cordis Config (L2) at read time.
 *
 * Model (v3): notes ALWAYS live at `<workspace>/.dsh-notes` locally; the git
 * repo is an independent sync target chosen by the user. Two mutually
 * exclusive modes:
 *  - `gitMode: 'shared'` — one shared repo (`gitCentral`), all workspaces
 *    sync into its `main` branch under a per-workspace folder.
 *  - `gitMode: 'own'` — no shared repo; each workspace configures its own
 *    repo `{ path, remote, branch, subpath }`.
 * @module dsh-md-notes/settings
 */

import s from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** The plugin's settings namespace id. */
export const MD_NOTES_NS = settingsNamespace('md-notes')

/** Per-repo record: path, branch, in-repo subpath, remote, authorization. */
export interface RepoSettings {
  /** Git repo directory (the sync target, not the notes location). */
  path?: string
  /** Branch to push/pull on (default 'main'). */
  branch?: string
  /** In-repo subpath holding this workspace's notes ('' = repo root). */
  subpath?: string
  /** Remote URL; empty = local commits only. */
  remote?: string
  /** True when the user granted access to a sandbox-external repo (persisted, §2.3). */
  authorized?: boolean
}

/** Shared (central) repo settings — `gitMode: 'shared'`. */
export interface CentralSettings {
  /** Shared repo path. */
  path?: string
  /** Shared repo remote. */
  remote?: string
  /** Authorization flag for the (sandbox-external) shared repo. */
  authorized?: boolean
}

/** The user-level (L3) settings section. */
export interface MdNotesSettings {
  /** 'off' = no git; 'shared' = shared repo for all workspaces; 'own' = per-workspace repos. */
  gitMode?: 'off' | 'on' | 'shared' | 'own'
  gitCentral?: CentralSettings
  gitRepos?: Record<string, RepoSettings>
  /** Legacy default branch (used when a repo record omits `branch`). */
  gitBranch?: string
  gitAutoPull?: boolean
  gitAuthorName?: string
  gitAuthorEmail?: string
}

/** Wire schema; also the envelope the browser scope validates against. */
export const MdNotesSettingsSchema: s<MdNotesSettings> = s.object({
  gitMode: s.union([s.const('off'), s.const('on'), s.const('shared'), s.const('own')]).required(false),
  gitCentral: s.object({
    path: s.string().required(false),
    remote: s.string().required(false),
    authorized: s.boolean().required(false),
  }).required(false),
  gitRepos: s.dict(s.object({
    path: s.string().required(false),
    branch: s.string().required(false),
    subpath: s.string().required(false),
    remote: s.string().required(false),
    authorized: s.boolean().required(false),
  })).required(false),
  gitBranch: s.string().required(false),
  gitAutoPull: s.boolean().required(false),
  gitAuthorName: s.string().required(false),
  gitAuthorEmail: s.string().required(false),
})

/**
 * Merge the L2 cordis Config (deployment defaults) with the L3 user settings
 * into one effective view. Top-level L3 wins; per-workspace repos and the
 * central path merge key-wise. `gitMode: 'on'` (legacy) is normalized:
 * a configured shared repo → 'shared', otherwise → 'own'.
 */
export function mergeSettings(
  config: {
    gitMode?: string
    gitCentralPath?: string
    gitRepos?: Record<string, RepoSettings>
    gitBranch?: string
    gitAutoPull?: boolean
    gitAuthorName?: string
    gitAuthorEmail?: string
  },
  l3: MdNotesSettings | undefined,
): MdNotesSettings {
  const user = l3 ?? {}
  const mode = user.gitMode ?? (config.gitMode === 'on' ? 'on' : 'off')
  const normalized = mode === 'on'
    ? (user.gitCentral?.path ?? config.gitCentralPath) ? 'shared' : 'own'
    : mode
  return {
    gitMode: normalized,
    gitCentral: {
      path: user.gitCentral?.path ?? config.gitCentralPath,
      remote: user.gitCentral?.remote,
      authorized: user.gitCentral?.authorized,
    },
    gitRepos: { ...(config.gitRepos ?? {}), ...(user.gitRepos ?? {}) },
    gitBranch: user.gitBranch ?? config.gitBranch ?? 'main',
    gitAutoPull: user.gitAutoPull ?? config.gitAutoPull ?? true,
    gitAuthorName: user.gitAuthorName ?? config.gitAuthorName ?? '',
    gitAuthorEmail: user.gitAuthorEmail ?? config.gitAuthorEmail ?? '',
  }
}
