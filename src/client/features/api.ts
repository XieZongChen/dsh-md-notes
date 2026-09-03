/**
 * HTTP API client for the dsh-md-notes host route (notes + git). The
 * request/response shapes come from the shared wire contract
 * (`src/contract.ts`, compiled by both tsc programs) — one entry per method,
 * so every caller gets the method's exact result type instead of a grab-bag
 * optional union.
 * @module dsh-md-notes/client/api
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ApiContract } from '../../contract.ts'

// Wire entities — re-exported for feature modules; the single source is the contract.
export type {
  ApiContract, ApiError, ApiResult,
  NoteSummary, WorkspaceNotes, GitStatusData, GitMode,
  RepoSettings, CentralSettings, MdNotesSettings, GitSettingsData,
  GitSuggestData, UpdateInfo, AppendLabels,
} from '../../contract.ts'

/** Host API route prefix; mirrors the host plugin's default. */
export const API = '/plugins/md-notes'

/** Icon asset URL served by the host GET route (`<prefix>/icon.svg`). */
export const ICON_URL = `${API}/icon.svg`

/** The `list` result (the @ reference pipeline caches this exact shape). */
export type ListResult = ApiContract['list']['res']

/**
 * Parse a response into the method's result. The host sends the structured
 * failure body ({ ok:false, code, error }) on non-2xx too — parse it so
 * error codes reach `gitErrorText` instead of being flattened to `http NNN`;
 * a non-JSON body (proxies, 502 pages) falls back to the bare status.
 */
async function parseResult<M extends keyof ApiContract>(res: Response): Promise<ApiContract[M]['res']> {
  try {
    return (await res.json()) as ApiContract[M]['res']
  } catch {
    return { ok: false, error: `http ${String(res.status)}` } as ApiContract[M]['res']
  }
}

/**
 * Call one host API method.
 * @param method - endpoint name (list/read/write/create/delete/appendConversation/git*).
 * @param body - endpoint arguments.
 * @param signal - optional abort signal (the @ reference pipeline supersedes
 * per-keystroke candidate fetches; a signal lets a stale call stop early).
 * @returns the method's typed result; transport failures become its ApiError branch.
 */
export async function api<M extends keyof ApiContract>(
  method: M,
  body?: ApiContract[M]['req'],
  signal?: AbortSignal,
): Promise<ApiContract[M]['res']> {
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, ...body }),
      signal,
    })
    return await parseResult<M>(res)
  } catch (error) {
    // An aborted request is a superseded candidate fetch — report it as a
    // failure branch; the caller treats it as "no candidates yet".
    return { ok: false, error: error instanceof Error ? error.message : String(error) } as ApiContract[M]['res']
  }
}

/** Git status of a workspace repo (or the central repo when `workspaceId` is omitted). */
export function gitStatusApi(workspaceId?: string): Promise<ApiContract['gitStatus']['res']> {
  return api('gitStatus', workspaceId === undefined ? {} : { workspaceId })
}

/**
 * Stage + commit + push a workspace repo. `overwrite = true` means the user
 * confirmed overwriting the remote's newer version (the first push without it
 * blocks with `code: 'remote-changed'` when remote notes differ).
 */
export function gitPushApi(workspaceId: string | undefined, message: string, overwrite?: boolean): Promise<ApiContract['gitPush']['res']> {
  const body = { message, overwrite: overwrite === true }
  return api('gitPush', workspaceId === undefined ? body : { workspaceId, ...body })
}

/**
 * Pull a workspace repo. `force = true` (manual Update button) replaces
 * locally-different files with the remote version; the auto-pull on open
 * omits it → conservative (never overwrites local changes).
 */
export function gitPullApi(workspaceId: string | undefined, force?: boolean, manual?: boolean): Promise<ApiContract['gitPull']['res']> {
  return api('gitPull', workspaceId === undefined ? { force: force === true, manual: manual === true } : { workspaceId, force: force === true, manual: manual === true })
}

/** User-initiated conflict resolution: merge the remote into the local branch. */
export function gitSyncApi(workspaceId?: string): Promise<ApiContract['gitSync']['res']> {
  return api('gitSync', workspaceId === undefined ? {} : { workspaceId })
}

/** Current user-level (L3) git settings. */
export function gitSettingsApi(): Promise<ApiContract['gitSettings']['res']> {
  return api('gitSettings')
}

/** npm update check: is a newer plugin version available? */
export function checkUpdateApi(): Promise<ApiContract['checkUpdate']['res']> {
  return api('checkUpdate')
}

/** Write git settings (whitelisted keys, see the host `gitConfig`). */
export function gitConfigApi(patch: ApiContract['gitConfig']['req']): Promise<ApiContract['gitConfig']['res']> {
  return api('gitConfig', patch)
}

/** Suggested repo paths from the host (per-workspace `.dsh-notes`). */
export function gitSuggestApi(): Promise<ApiContract['gitSuggest']['res']> {
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
    case 'note-writing': return t('git.errNoteWriting')
    default: return t('git.failed', { error: detail ?? code ?? '' })
  }
}
