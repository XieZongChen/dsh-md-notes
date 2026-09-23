/**
 * dsh-md-notes settings: the plugin's configuration model and the adapter
 * between the client's wire shape and the host's stored shape.
 *
 * dsh 0.1.7 (SettingsForms) removed `settings.register(ns, schema)`. The
 * editable fields are now the plugin's OWN `Config` schema — the `volatile`
 * ones — the user overrides live in the profile patch, and writes go through
 * `settings.update(entryId, patch)`. This module owns the two directions of that
 * translation: {@link overridesFromConfig} (stored Config keys → the client's
 * `MdNotesSettings`) and {@link configPatchFromSettings} (a client `gitConfig`
 * patch → Config keys). {@link MdNotesSettingsSchema} validates a patch before
 * it is written, so a malformed value can never reach the patch — a poisoned
 * patch would not merely fail one save, it would fail the plugin LOAD on the
 * next start. {@link mergeSettings} still folds the deployment Config under the
 * user layer for read time.
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
 * The plugin's settings section id. Since dsh 0.1.7 this is the **Loader entry
 * id** (the profile's `id: md-notes` row) — `settings.update` writes the entry
 * whose `options.id` matches, and the plugin's `name` export supplies it.
 */
export const MD_NOTES_NS = 'md-notes'

/** The accepted `gitMode` values (shared with the schema's union). */
const GIT_MODES: readonly string[] = ['off', 'on', 'shared', 'own']

/** Wire schema; validates a `gitConfig` patch before the host persists it. */
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

// ---- dsh 0.1.7 user-override adapter (SettingsForms) ----
//
// dsh 0.1.7 removed `settings.register(ns, schema)`: the editable fields are now
// the plugin's OWN Config schema and user overrides live in the profile patch,
// projected through that schema as `gitCentralRemote` / `gitCentralBranch`. The
// client contract still speaks `MdNotesSettings` (`gitCentral.remote`), so the
// two shapes meet here — one translation point, exercised by unit tests.

/**
 * Read the user-override layer out of a dsh 0.1.7 `SettingsForms` descriptor
 * (`describe()[].user`, already projected through the Config schema) and map it
 * into the client-facing {@link MdNotesSettings} shape. Returns `undefined` for
 * a non-object input (no overrides stored yet).
 */
export function overridesFromConfig(raw: unknown): MdNotesSettings | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const cfg = raw as Record<string, unknown>
  const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
  const remote = str(cfg.gitCentralRemote)
  const branch = str(cfg.gitCentralBranch)
  return {
    gitMode: typeof cfg.gitMode === 'string' && GIT_MODES.includes(cfg.gitMode) ? cfg.gitMode as GitMode : undefined,
    gitCentral: remote === undefined && branch === undefined ? undefined : { remote, branch },
    gitRepos: cfg.gitRepos !== null && typeof cfg.gitRepos === 'object' && !Array.isArray(cfg.gitRepos)
      ? cfg.gitRepos as Record<string, RepoSettings>
      : undefined,
    gitAutoPull: typeof cfg.gitAutoPull === 'boolean' ? cfg.gitAutoPull : undefined,
    gitAuthorName: str(cfg.gitAuthorName),
    gitAuthorEmail: str(cfg.gitAuthorEmail),
  }
}

/**
 * Translate a client `gitConfig` patch into the plugin Config keys the profile
 * patch stores (the reverse of {@link overridesFromConfig}). Only whitelisted
 * keys survive, so a write can never introduce a field the Config schema — and
 * therefore dsh's `volatile` validation — does not know.
 */
export function configPatchFromSettings(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'gitCentral') {
      const central = value as { remote?: unknown; branch?: unknown } | null | undefined
      if (central !== null && typeof central === 'object') {
        if (typeof central.remote === 'string') out.gitCentralRemote = central.remote
        if (typeof central.branch === 'string') out.gitCentralBranch = central.branch
      }
      continue
    }
    if (key === 'gitMode' || key === 'gitRepos' || key === 'gitAutoPull'
      || key === 'gitAuthorName' || key === 'gitAuthorEmail') {
      out[key] = value
    }
  }
  return out
}

/**
 * Merge a just-written patch into the cached override view, so reads in the
 * SAME apply instance see the new values immediately. The profile patch reload
 * (which re-applies this plugin with fresh config) lands asynchronously, and a
 * client that reads right after a write must not observe stale settings.
 */
export function mergeOverrides(current: MdNotesSettings | undefined, patch: Record<string, unknown>): MdNotesSettings {
  const next: MdNotesSettings = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (key === 'gitCentral') {
      next.gitCentral = { ...current?.gitCentral, ...(value as CentralSettings) }
      continue
    }
    if (key === 'gitRepos') {
      next.gitRepos = { ...current?.gitRepos, ...(value as Record<string, RepoSettings>) }
      continue
    }
    if (key === 'gitMode' || key === 'gitAutoPull' || key === 'gitAuthorName' || key === 'gitAuthorEmail') {
      (next as Record<string, unknown>)[key] = value
    }
  }
  return next
}
