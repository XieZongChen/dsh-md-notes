/**
 * HTTP API client for the dsh-md-notes host route (notes + git).
 * @module dsh-md-notes/client/api
 */

export interface NoteSummary {
  name: string
  title: string
  updatedAt: number
}

/** One workspace's note group (the grouped `list` result). */
export interface WorkspaceNotes {
  workspaceId: string
  name: string
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
 * @returns the parsed result, or a failure branch on transport/HTTP errors.
 */
export async function api(method: string, body: Record<string, unknown> = {}): Promise<ApiResult> {
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, ...body }),
    })
    if (!res.ok) return { ok: false, error: `http ${res.status}` }
    return (await res.json()) as ApiResult
  } catch (error) {
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
