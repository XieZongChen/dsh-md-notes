/**
 * HTTP API client for the dsh-md-notes host route (notes + git).
 * @module dsh-md-notes/client/api
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

export interface NoteSummary {
  name: string
  title: string
  updatedAt: number
}

/** One workspace's note group (the grouped `list` result). */
export interface WorkspaceNotes {
  workspaceId: string
  name: string
  /** Absolute notes directory (`<ws>/.dsh-notes`) — used to build reference paths. */
  notesDir: string
  notes: NoteSummary[]
}

/** One repo's git status view. */
export interface GitStatusData {
  repoDir?: string
  /** In-repo subdir for this workspace ('' = repo root). */
  subdir?: string
  branch?: string
  uncommitted?: number
  lastCommit?: string
  remote?: string
  error?: string
}

/** One repo record as configured (own-repo mode). */
export interface RepoGitSettings {
  remote?: string
  branch?: string
  subpath?: string
}

/** The user-level (L3) git settings surfaced to the config forms. */
export interface GitSettingsData {
  gitMode?: 'off' | 'on' | 'shared' | 'own'
  gitCentral?: { remote?: string; branch?: string }
  gitRepos?: Record<string, RepoGitSettings>
  gitAutoPull?: boolean
  gitAuthorName?: string
  gitAuthorEmail?: string
}

export type ApiResult =
  | {
    ok: true
    workspaces?: WorkspaceNotes[]
    noWorkspaces?: boolean
    content?: string
    name?: string
    dir?: string | null
    status?: GitStatusData
    settings?: GitSettingsData
    suggestions?: GitSuggestData
    /** Number of files skipped during a conservative pull (differed from remote). */
    skipped?: number
    /** Notes that differ on both sides after a conservative pull (conflict hint). */
    changed?: string[]
    /** npm update check result. */
    update?: { current: string; latest: string; hasUpdate: boolean }
  }
  | { ok: false; error: string; code?: string; changed?: string[] }

/** Host API route prefix; mirrors the host plugin's default. */
export const API = '/plugins/md-notes'

/** Icon asset URL served by the host GET route (`<prefix>/icon.svg`). */
export const ICON_URL = `${API}/icon.svg`

/**
 * Call one host API method.
 * @param method - endpoint name (list/read/write/create/delete/appendConversation/git*).
 * @param body - endpoint arguments.
 * @param signal - optional abort signal (the @ reference pipeline supersedes
 * per-keystroke candidate fetches; a signal lets a stale call stop early).
 * @returns the parsed result, or a failure branch on transport/HTTP errors.
 */
export async function api(method: string, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<ApiResult> {
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, ...body }),
      signal,
    })
    if (!res.ok) return { ok: false, error: `http ${res.status}` }
    return (await res.json()) as ApiResult
  } catch (error) {
    // An aborted request is a superseded candidate fetch — report it as a
    // failure branch; the caller treats it as "no candidates yet".
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Git status of a workspace repo (or the central repo when `workspaceId` is omitted). */
export function gitStatusApi(workspaceId?: string): Promise<ApiResult> {
  return api('gitStatus', workspaceId === undefined ? {} : { workspaceId })
}

/**
 * Stage + commit + push a workspace repo. `overwrite = true` means the user
 * confirmed overwriting the remote's newer version (the first push without it
 * blocks with `code: 'remote-changed'` when remote notes differ).
 */
export function gitPushApi(workspaceId: string | undefined, message: string, overwrite?: boolean): Promise<ApiResult> {
  const body = { message, overwrite: overwrite === true }
  return api('gitPush', workspaceId === undefined ? body : { workspaceId, ...body })
}

/**
 * Pull a workspace repo. `force = true` (manual Update button) replaces
 * locally-different files with the remote version; the auto-pull on open
 * omits it → conservative (never overwrites local changes).
 */
export function gitPullApi(workspaceId: string | undefined, force?: boolean): Promise<ApiResult> {
  return api('gitPull', workspaceId === undefined ? { force: force === true } : { workspaceId, force: force === true })
}

/** User-initiated conflict resolution: merge the remote into the local branch. */
export function gitSyncApi(workspaceId?: string): Promise<ApiResult> {
  return api('gitSync', workspaceId === undefined ? {} : { workspaceId })
}

/** Current user-level (L3) git settings. */
export function gitSettingsApi(): Promise<ApiResult> {
  return api('gitSettings')
}

/** npm update check: is a newer plugin version available? */
export function checkUpdateApi(): Promise<ApiResult> {
  return api('checkUpdate')
}

/** Write git settings (whitelisted keys, see the host `gitConfig`). */
export function gitConfigApi(patch: Record<string, unknown>): Promise<ApiResult> {
  return api('gitConfig', patch)
}

/** Suggested repo paths from the host (per-workspace `.dsh-notes`). */
export interface GitSuggestData {
  workspaces?: Array<{ workspaceId: string; path: string }>
}

export function gitSuggestApi(): Promise<ApiResult> {
  return api('gitSuggest')
}

/**
 * Map a host git error to localized UI text. The host returns a machine
 * `code` plus a raw `detail`; the client renders the right copy per locale.
 * Unknown codes fall back to a generic failure with the raw detail.
 */
export function gitErrorText(t: TranslateNS<'md-notes'>, code: string | undefined, detail: string | undefined): string {
  switch (code) {
    case 'no-repo': return t('git.errNoRepo')
    case 'no-workspace': return t('git.errNoWorkspace')
    case 'sync-branch': return t('git.errSyncBranch', { detail: detail ?? '' })
    case 'sync-notes': return t('git.errSyncNotes', { detail: detail ?? '' })
    case 'git-failed': return t('git.errGitFailed', { detail: detail ?? '' })
    case 'push-failed': return t('git.errPushFailed', { detail: detail ?? '' })
    case 'clone-failed': return t('git.errCloneFailed', { detail: detail ?? '' })
    case 'identity': return t('git.errIdentity')
    case 'remote-changed': return t('git.errRemoteChanged', { names: detail ?? '' })
    case 'non-fast-forward': return t('git.errNonFastForward')
    case 'merge-unrelated': return t('git.errMergeUnrelated', { detail: detail ?? '' })
    default: return t('git.failed', { error: detail ?? code ?? '' })
  }
}
