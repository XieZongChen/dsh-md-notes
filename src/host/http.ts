/**
 * HTTP helpers and the API route handler assembly for the notes + git domain.
 * Notes methods resolve their directory per request (git-aware, backward
 * compatible); git methods dispatch through the bound GitApi after the
 * in-plugin authorization gate.
 * @module dsh-md-notes/http
 */

import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import {
  appendConversation, createNote, deleteNote, listNotes, readNote, writeNote,
} from './notes.ts'
import {
  GitError, isAuthorized, type GitStatusView, type ResolvedRepo,
} from './git.ts'

/** Read a JSON request body (bounded). */
export async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buf.length
    if (size > 2 * 1024 * 1024) throw new Error('body too large')
    chunks.push(buf)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text) as unknown
  } catch {
    return {}
  }
}

/** Write a JSON response. */
export function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** Git operations bound to the plugin context (see `src/index.ts`). */
export interface GitApi {
  status(repo: ResolvedRepo): Promise<GitStatusView>
  init(repo: ResolvedRepo): Promise<void>
  push(repo: ResolvedRepo, notesDir: string, message: string): Promise<{ ok: boolean; error?: string; code?: string }>
  pull(repo: ResolvedRepo, notesDir: string): Promise<{ ok: boolean; error?: string; skipped?: number }>
  sync(repo: ResolvedRepo): Promise<{ ok: boolean; error?: string }>
}

/** One workspace entry surfaced to the grouped note list. */
export interface WorkspaceEntry {
  workspaceId: string
  name: string
  notesDir: string
  repo?: ResolvedRepo | undefined
}

/** Everything the handler needs beyond the notes domain. */
export interface NotesApiDeps {
  /** Notes dir when no workspace routing applies (git off / no workspace). */
  defaultDir: string
  /** Resolve the notes dir for a workspace (git-aware); undefined workspace → defaultDir. */
  resolveDir(workspaceId?: string): string
  /** Resolve the git repo for a workspace, or the central repo when no workspace id. */
  resolveRepo(workspaceId?: string): ResolvedRepo | undefined
  /** The grouped note-list entries (multi-workspace view in central mode). */
  listWorkspaces(): WorkspaceEntry[]
  /** Resolve a session's workspace id (via its cwd); undefined when unresolvable. */
  workspaceIdForSession(sessionId: string | undefined): string | undefined
  /** Persist L3 settings (whitelisted keys only, see `gitConfig`). */
  updateSettings(patch: Record<string, unknown>): Promise<void>
  /** Current user-level (L3) settings for the config form. */
  readSettings(): Record<string, unknown>
  /** Suggested repo paths (per workspace `.dsh-notes`, central under DSH_HOME). */
  suggest(): Record<string, unknown>
  /** Whether the workspace registry has at least one real workspace. */
  hasWorkspaces(): boolean
  /** Open the host directory picker; null = user cancelled. */
  pickDir(): Promise<{ ok: boolean; dir?: string | null; error?: string }>
  /** Bound git operations. */
  git: GitApi
  /** Persist the authorization flag for a workspace repo (or the central repo). */
  setAuthorized(workspaceId: string | undefined, authorized: boolean): Promise<void>
  /** Optional session query service (for appendConversation). */
  sessionQuery?: SessionQueryEngine | undefined
}

/** Dispatch one `{ method, ...args }` body. */
async function handleApi(deps: NotesApiDeps, method: string, body: unknown): Promise<unknown> {
  const req = (body ?? {}) as Record<string, unknown>
  const workspaceId = typeof req.workspaceId === 'string'
    ? req.workspaceId
    : deps.workspaceIdForSession(typeof req.sessionId === 'string' ? req.sessionId : undefined)
  const name = String(req.name ?? '')

  switch (method) {
    // ---- notes domain ----
    case 'list': {
      // A session-scoped request (note picker) sees only its own workspace's
      // notes; the manager (no sessionId) sees every workspace. Without this
      // the picker would list all workspaces yet append into only the
      // session's workspace — mismatched notes.
      const sessionWsId = typeof req.sessionId === 'string'
        ? deps.workspaceIdForSession(req.sessionId)
        : undefined
      const entries = sessionWsId !== undefined
        ? deps.listWorkspaces().filter((ws) => ws.workspaceId === sessionWsId)
        : deps.listWorkspaces()
      const workspaces: Array<{ workspaceId: string; name: string; notes: import('./notes.ts').NoteSummary[] }> = []
      for (const ws of entries) {
        const result = await listNotes(ws.notesDir)
        workspaces.push({ workspaceId: ws.workspaceId, name: ws.name, notes: result.ok ? result.notes : [] })
      }
      return { ok: true, workspaces, noWorkspaces: !deps.hasWorkspaces() }
    }
    case 'read':
      return readNote(deps.resolveDir(workspaceId), name)
    case 'write':
      return writeNote(deps.resolveDir(workspaceId), name, String(req.content ?? ''))
    case 'create':
      return createNote(deps.resolveDir(workspaceId), String(req.title ?? ''))
    case 'delete':
      return deleteNote(deps.resolveDir(workspaceId), name)
    case 'appendConversation':
      return appendConversation(
        deps.resolveDir(workspaceId),
        String(req.noteName ?? ''),
        String(req.sessionId ?? ''),
        String(req.messageId ?? ''),
        deps.sessionQuery,
      )

    // ---- git domain ----
    case 'gitStatus': {
      const repo = deps.resolveRepo(workspaceId)
      if (repo === undefined) return { ok: false, error: '未配置 git 仓库' }
      if (!isAuthorized(repo)) return { ok: false, error: '仓库未授权，请先在设置中授权' }
      const view = await deps.git.status(repo)
      return { ok: true, status: view }
    }
    case 'gitInit': {
      const repo = deps.resolveRepo(workspaceId)
      if (repo === undefined) return { ok: false, error: '未配置 git 仓库' }
      if (!isAuthorized(repo)) return { ok: false, error: '仓库未授权，请先在设置中授权' }
      try {
        await deps.git.init(repo)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
    case 'gitPush': {
      const repo = deps.resolveRepo(workspaceId)
      if (repo === undefined) return { ok: false, error: '未配置 git 仓库' }
      if (!isAuthorized(repo)) return { ok: false, error: '仓库未授权，请先在设置中授权' }
      const message = typeof req.message === 'string' && req.message.trim() !== ''
        ? req.message.trim()
        : `笔记更新 ${new Date().toLocaleString()}`
      return deps.git.push(repo, deps.resolveDir(workspaceId), message)
    }
    case 'gitPull': {
      const repo = deps.resolveRepo(workspaceId)
      if (repo === undefined) return { ok: false, error: '未配置 git 仓库' }
      if (!isAuthorized(repo)) return { ok: false, error: '仓库未授权，请先在设置中授权' }
      return deps.git.pull(repo, deps.resolveDir(workspaceId))
    }
    case 'gitSync': {
      // User-initiated conflict resolution after a rejected push.
      const repo = deps.resolveRepo(workspaceId)
      if (repo === undefined) return { ok: false, error: '未配置 git 仓库' }
      if (!isAuthorized(repo)) return { ok: false, error: '仓库未授权，请先在设置中授权' }
      return deps.git.sync(repo)
    }
    case 'gitAuthorize':
      try {
        await deps.setAuthorized(workspaceId, true)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    case 'gitRevoke':
      try {
        await deps.setAuthorized(workspaceId, false)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    case 'gitSettings': {
      return { ok: true, settings: deps.readSettings() }
    }
    case 'gitSuggest': {
      return { ok: true, suggestions: deps.suggest() }
    }
    case 'gitPickDir': {
      return deps.pickDir()
    }
    case 'gitConfig': {
      // Whitelist the settings keys this API may write (L3), dropping anything else.
      const allowed = [
        'gitMode', 'gitCentral', 'gitRepos', 'gitBranch', 'gitAutoPull',
        'gitAuthorName', 'gitAuthorEmail',
      ] as const
      const patch: Record<string, unknown> = {}
      for (const key of allowed) {
        if (req[key] !== undefined) patch[key] = req[key]
      }
      try {
        await deps.updateSettings(patch)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }

    default:
      return { ok: false, error: `unknown method: ${method}` }
  }
}

/**
 * Build the POST handler for the notes + git API route.
 * @param deps - resolved directories, git operations, and workspace resolution.
 * @returns an async request handler.
 */
export function notesApiHandler(deps: NotesApiDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      const body = await readBody(req)
      const raw = body as { method?: string }
      const method = typeof raw.method === 'string' ? raw.method : ''
      const result = await handleApi(deps, method, body)
      sendJson(res, 200, result)
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof GitError ? error.message : (error instanceof Error ? error.message : String(error)) })
    }
  }
}

/**
 * Build the GET handler serving the packaged icon SVG, so the client can use
 * `<img src="/plugins/md-notes/icon.svg">` — a single source of truth: editing
 * `assets/dsh-md-notes.svg` takes effect without regenerating any component.
 * @param svgPath - absolute path to the icon file inside the package.
 * @returns an async request handler.
 */
export function iconHandler(
  svgPath: string,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    try {
      const data = await readFile(svgPath)
      res.writeHead(200, {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'no-cache', // reflect SVG edits without a restart
      })
      res.end(data)
    } catch {
      sendJson(res, 404, { ok: false, error: 'icon not found' })
    }
  }
}
