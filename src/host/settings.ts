/**
 * dsh-md-notes settings namespace (`md-notes`): the durable user-level layer
 * (L3) of the plugin's three-layer configuration model. Registered host-side
 * via `ctx.settings`, written by the settings panel / sync-area UI, and merged
 * over the cordis Config (L2) at read time.
 * @module dsh-md-notes/settings
 */

import s from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** The plugin's settings namespace id. */
export const MD_NOTES_NS = settingsNamespace('md-notes')

/** Per-repo record: path, optional remote, and the sandbox-external authorization flag. */
export interface RepoSettings {
  /** Repo directory (notes root for a workspace's own repo; central repo root for the total repo). */
  path?: string
  /** Remote URL; empty = local commits only. */
  remote?: string
  /** True when the user granted access to a sandbox-external repo (persisted, §2.3). */
  authorized?: boolean
}

/** Total (central) repo settings, keyed under `gitCentral`. */
export interface CentralSettings {
  /** Central repo path (overrides the L2 `gitCentralPath` default). */
  path?: string
  /** Central repo remote. */
  remote?: string
  /** Authorization flag for the (sandbox-external) central repo. */
  authorized?: boolean
}

/** The user-level (L3) settings section. */
export interface MdNotesSettings {
  gitMode?: 'off' | 'on'
  gitCentral?: CentralSettings
  gitRepos?: Record<string, RepoSettings>
  gitBranch?: string
  gitAutoPull?: boolean
  gitAuthorName?: string
  gitAuthorEmail?: string
}

/** Wire schema; also the envelope the browser scope validates against. */
export const MdNotesSettingsSchema: s<MdNotesSettings> = s.object({
  gitMode: s.union([s.const('off'), s.const('on')]).required(false),
  gitCentral: s.object({
    path: s.string().required(false),
    remote: s.string().required(false),
    authorized: s.boolean().required(false),
  }).required(false),
  gitRepos: s.dict(s.object({
    path: s.string().required(false),
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
 * central path merge key-wise (`L3.gitCentral.path ?? L2.gitCentralPath`,
 * `{ ...L2.gitRepos, ...L3.gitRepos }`).
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
  return {
    gitMode: user.gitMode ?? (config.gitMode === 'on' ? 'on' : 'off'),
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
