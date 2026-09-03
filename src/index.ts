/**
 * dsh-md-notes host half plugin entry: a bundle plugin that serves the notes +
 * git API over the webServer HTTP route. Notes live as .md files under a
 * workspace-resolved directory; git sync is opt-in via the `md-notes` settings
 * namespace (three-layer config: schema default → cordis Config → user
 * settings). The browser half fetches this API; no typert/Remote toolchain.
 *
 * Domain logic: `notes.ts` (notes), `git.ts` (git + workspace/repo resolution),
 * `settings.ts` (L3 namespace). HTTP assembly in `http.ts`.
 * @module dsh-md-notes
 */

import { fileURLToPath } from 'node:url'
import path, { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
// Declaration-merge triggers so ctx.webServer / ctx.sessions / ctx.settings /
// ctx.workspaceRegistry types are visible.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-workspace'
import {
  gitInit, gitPull, gitPush, gitStatus, gitSync, normPath, resolveNotesDir, resolveSharedRepo,
  resolveWorkspaceRepo,
  type ResolvedRepo, type WorkspaceInfo,
} from './host/git.ts'
import { iconHandler, notesApiHandler, type GitApi, type NotesApiDeps, type WorkspaceEntry } from './host/http.ts'
import { createKeyedLock, createKeyedMutex } from './host/keyed-lock.ts'
import { MdNotesSettingsSchema, mergeSettings, MD_NOTES_NS, type MdNotesSettings } from './host/settings.ts'
import { registerNoteContextInjection } from './host/context-inject.ts'
import { createUpdateChecker } from './host/update.ts'

/** Plugin row config. */
export interface Config {
  /**
   * Git mode: 'off' | 'shared' | 'own' (legacy 'on' normalizes to shared/own).
   *
   * (No `route` option on purpose: the browser half hardcodes the API prefix
   * `/plugins/md-notes`, so a host-side override would silently sever the
   * client↔host link. The route is a fixed constant on both halves.)
   */
  readonly gitMode?: 'off' | 'on' | 'shared' | 'own'
  /** Shared repo remote URL — the deployment default for `gitCentral.remote`. */
  readonly gitCentralRemote?: string
  /** Shared repo branch — the deployment default for `gitCentral.branch`. */
  readonly gitCentralBranch?: string
  /** Per-workspace repos (L2 defaults, keyed by workspace id); L3 overrides per key. */
  readonly gitRepos?: Record<string, import('./host/settings.ts').RepoSettings>
  /** Pull remote before opening a note (default true). */
  readonly gitAutoPull?: boolean
  /** Commit author name; empty uses git's global config. */
  readonly gitAuthorName?: string
  /** Commit author email; empty uses git's global config. */
  readonly gitAuthorEmail?: string
  /**
   * Whether the npm update check may run (default true). When false the host
   * never contacts registry.npmjs.org — for offline / managed deployments.
   */
  readonly checkUpdate?: boolean
}

export const name = 'md-notes'
export const inject = ['webServer', 'settings']
export const Config: s<Config> = s.object({
  gitMode: s.union([s.const('off'), s.const('on'), s.const('shared'), s.const('own')]).default('off'),
  gitCentralRemote: s.string().default(''),
  gitCentralBranch: s.string().default(''),
  gitRepos: s.dict(s.object({
    remote: s.string().required(false),
    branch: s.string().required(false),
    subpath: s.string().required(false),
  })).default({}),
  gitAutoPull: s.boolean().default(true),
  gitAuthorName: s.string().default(''),
  gitAuthorEmail: s.string().default(''),
  checkUpdate: s.boolean().default(true),
})

/** Minimal shape of the webServer route registration used here. */
interface WebServerLike {
  register(route: {
    kind: string
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** Minimal settings-service face (register → scope with get/update). */
interface SettingsScopeLike {
  get(): MdNotesSettings | undefined
  update(patch: object): Promise<void>
}
interface SettingsServiceLike {
  register(ns: unknown, schema: unknown): SettingsScopeLike
}

/** Minimal workspace-registry face. */
interface WorkspaceRegistryLike {
  list(): WorkspaceInfo[]
  get(id: string): WorkspaceInfo | undefined
}

/**
 * Minimal connection-service face: the Host/Origin + browser-auth trust fence
 * the official /api channel applies to its own routes
 * (`HostConnectionHandle.requestRejection`, packages/client/connection in
 * deepseek-harness — its doc comment explicitly invites applying it to other
 * web routes). Structural on purpose: no type import from the connection
 * package, matching the other `*Like` faces here.
 */
interface ConnectionLike {
  requestRejection(request: { headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/** Plugin body. */
export function apply(ctx: Context, config: Config): void {
  const web = ctx.get('webServer') as WebServerLike | undefined
  if (web === undefined) return

  // --- settings namespace (L3) ---
  const settingsService = ctx.get('settings') as SettingsServiceLike | undefined
  const scope = settingsService?.register(MD_NOTES_NS, MdNotesSettingsSchema)
  const readSettings = (): MdNotesSettings => mergeSettings(config, scope?.get())

  // --- workspace resolution ---
  const workspaces = (): WorkspaceRegistryLike | undefined => ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined
  const getWorkspace = (workspaceId?: string): WorkspaceInfo | undefined => {
    if (workspaceId === undefined) return undefined
    return workspaces()?.get(workspaceId)
  }

  const resolveDir = (workspaceId?: string): string | undefined => {
    const ws = getWorkspace(workspaceId)
    if (ws === undefined) return undefined
    return resolveNotesDir(readSettings(), ws)
  }

  const resolveRepo = (workspaceId?: string): ResolvedRepo | undefined => {
    const settings = readSettings()
    const ws = getWorkspace(workspaceId)
    if (ws !== undefined) return resolveWorkspaceRepo(settings, ws)
    // No workspace id → the shared repo as a global target (shared mode only).
    return resolveSharedRepo(settings)
  }

  const listWorkspaces = (): WorkspaceEntry[] => {
    const settings = readSettings()
    const registry = workspaces()
    if (registry === undefined || registry.list().length === 0) {
      // No workspaces yet — no default group (notes are workspace-bound).
      return []
    }
    return registry.list().map((ws) => ({
      workspaceId: ws.id,
      name: ws.title,
      notesDir: resolveNotesDir(settings, ws),
      repo: resolveWorkspaceRepo(settings, ws),
    }))
  }

  const workspaceIdForSession = (sessionId: string | undefined): string | undefined => {
    if (sessionId === undefined) return undefined
    const sessionStore = ctx.get('sessions') as { get(id: string): { header?: { cwd?: string } } | undefined } | undefined
    const cwd = sessionStore?.get(sessionId)?.header?.cwd
    if (typeof cwd !== 'string' || cwd === '') return undefined
    const registry = workspaces()
    if (registry === undefined) return undefined
    const ws = registry.list().find((candidate) => {
      try {
        return normPath(candidate.path) === normPath(cwd)
      } catch {
        return false
      }
    })
    return ws?.id
  }

  const updateSettings = async (patch: Record<string, unknown>): Promise<void> => {
    if (scope === undefined) throw new Error('settings service unavailable')
    await scope.update(patch)
  }

  // Serialize all git operations per clone directory. git.ts runs
  // checkout/add/commit/push/fetch against the same `repoDir`, and in shared
  // mode several workspaces share one clone — a concurrent push/pull would
  // interleave and corrupt the clone. The mutex QUEUES (never rejects) and
  // must wrap at this GitApi boundary, NOT inside git.ts: those functions call
  // each other (gitStatus → gitInit, gitPush → ensureBranch → fetchOrigin), so
  // a per-function lock would self-deadlock. Wrapping here locks each top-level
  // API call exactly once.
  const gitMutex = createKeyedMutex()
  const git: GitApi = {
    status: (repo, notesDir) => gitMutex.runExclusive(`repo/${repo.repoDir}`, () => gitStatus(ctx, repo, repo.branch, notesDir)),
    init: (repo) => gitMutex.runExclusive(`repo/${repo.repoDir}`, () => gitInit(ctx, repo, repo.branch)),
    push: (repo, notesDir, message, overwrite) => gitMutex.runExclusive(`repo/${repo.repoDir}`, () => gitPush(ctx, repo, notesDir, message, {
      name: readSettings().gitAuthorName ?? '',
      email: readSettings().gitAuthorEmail ?? '',
    }, overwrite)),
    pull: (repo, notesDir, force, manual) => gitMutex.runExclusive(`repo/${repo.repoDir}`, () => gitPull(ctx, repo, notesDir, force, manual)),
    sync: (repo) => gitMutex.runExclusive(`repo/${repo.repoDir}`, () => gitSync(ctx, repo)),
  }

  const suggest = (): Record<string, unknown> => {
    const registry = workspaces()
    const wsEntries = registry === undefined ? [] : registry.list()
    return {
      workspaces: wsEntries.map((ws) => ({ workspaceId: ws.id, path: join(ws.path, '.dsh-notes') })),
    }
  }

  // --- update check: latest npm version vs the installed one (cached 10 min;
  // checkUpdate:false keeps it fully offline — host/update.ts owns the logic) ---
  const checkUpdate = createUpdateChecker(config.checkUpdate !== false)

  // Trust fence for both routes: when the connection service is present (the
  // web profile), requestRejection is exactly the gate the official /api route
  // runs — 401 (no browser session) / 403 (untrusted Host/Origin) before any
  // dispatch. Resolved PER REQUEST so a connection service that activates
  // after this plugin is still picked up; profiles without the service
  // (e.g. Electron file:// + IPC) degrade to the unfenced route they always
  // were, since their carrier is not a shared HTTP socket.
  const authorize = (req: IncomingMessage): 401 | 403 | undefined =>
    (ctx.get('connection') as ConnectionLike | undefined)?.requestRejection({ headers: req.headers })

  const deps: NotesApiDeps = {
    resolveDir,
    resolveRepo,
    listWorkspaces,
    workspaceIdForSession,
    updateSettings,
    readSettings: () => (scope?.get() ?? {}) as Record<string, unknown>,
    suggest,
    hasWorkspaces: () => {
      const registry = workspaces()
      return registry !== undefined && registry.list().length > 0
    },
    checkUpdate,
    git,
    lock: createKeyedLock(),
    authorize,
  }
  const handler = notesApiHandler(deps)
  // lib/../assets/dsh-md-notes.svg — the packaged icon, served as-is.
  const iconPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', 'assets', 'dsh-md-notes.svg',
  )

  // Fixed API prefix — must equal the client half's hardcoded API constant
  // (features/api.ts); see the Config doc comment for why it is not an option.
  const prefix = '/plugins/md-notes'
  ctx.effect(() => web.register({
    kind: 'prefix',
    path: prefix,
    handler,
  }), 'dsh-md-notes: api route')
  ctx.effect(() => web.register({
    kind: 'exact',
    path: `${prefix}/icon.svg`,
    handler: iconHandler(iconPath, authorize),
  }), 'dsh-md-notes: icon route')
  // Note-content injection: fold referenced notes into the model request at
  // every agent pre-step (reliable references without relying on `read`).
  ctx.effect(() => registerNoteContextInjection(ctx), 'dsh-md-notes: context injection')
}
