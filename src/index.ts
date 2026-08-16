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
import path, { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
// Declaration-merge triggers so ctx.webServer / ctx.sessions / ctx.settings /
// ctx.workspaceRegistry types are visible.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-workspace'
import { notesDir } from './host/notes.ts'
import {
  gitInit, gitPull, gitPush, gitStatus, gitSync,
  resolveCentralRepo, resolveNotesDir, resolveWorkspaceRepo,
  type ResolvedRepo, type WorkspaceInfo,
} from './host/git.ts'
import { iconHandler, notesApiHandler, type GitApi, type NotesApiDeps, type WorkspaceEntry } from './host/http.ts'
import { MdNotesSettingsSchema, mergeSettings, MD_NOTES_NS, type MdNotesSettings } from './host/settings.ts'

/** Plugin row config. */
export interface Config {
  /** Notes directory; an explicit root wins over the `<cwd>/.dsh-notes` default. */
  readonly root?: string
  /** API route prefix (default /plugins/md-notes). */
  readonly route?: string
  /** Git master switch ('off' | 'on'); user settings may override. */
  readonly gitMode?: 'off' | 'on'
  /** Central (total) repo path — the deployment default for `gitCentral.path`. */
  readonly gitCentralPath?: string
  /** Per-workspace repos (L2 defaults, keyed by workspace id); L3 overrides per key. */
  readonly gitRepos?: Record<string, import('./host/settings.ts').RepoSettings>
  /** Default branch for `git init`. */
  readonly gitBranch?: string
  /** Pull remote before opening a note (default true). */
  readonly gitAutoPull?: boolean
  /** Commit author name; empty uses git's global config. */
  readonly gitAuthorName?: string
  /** Commit author email; empty uses git's global config. */
  readonly gitAuthorEmail?: string
}

export const name = 'md-notes'
export const inject = ['webServer']
export const Config: s<Config> = s.object({
  root: s.string().default('.dsh-notes'),
  route: s.string().default('/plugins/md-notes'),
  gitMode: s.union([s.const('off'), s.const('on')]).default('off'),
  gitCentralPath: s.string().default(''),
  gitRepos: s.dict(s.object({
    path: s.string().required(false),
    remote: s.string().required(false),
    authorized: s.boolean().required(false),
  })).default({}),
  gitBranch: s.string().default('main'),
  gitAutoPull: s.boolean().default(true),
  gitAuthorName: s.string().default(''),
  gitAuthorEmail: s.string().default(''),
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

  const defaultDir = notesDir(config.root)

  const resolveDir = (workspaceId?: string): string => {
    const ws = getWorkspace(workspaceId)
    if (ws === undefined) return defaultDir
    return resolveNotesDir(readSettings(), ws, config.root ?? '.dsh-notes')
  }

  const resolveRepo = (workspaceId?: string): ResolvedRepo | undefined => {
    const settings = readSettings()
    if (settings.gitMode !== 'on') return undefined
    const ws = getWorkspace(workspaceId)
    if (ws !== undefined) return resolveWorkspaceRepo(settings, ws)
    return resolveCentralRepo(settings)
  }

  const listWorkspaces = (): WorkspaceEntry[] => {
    const settings = readSettings()
    const registry = workspaces()
    if (settings.gitMode !== 'on' || registry === undefined || registry.list().length === 0) {
      // git off or no workspace registry: single default group, current behavior.
      return [{ workspaceId: 'default', name: 'default', notesDir: defaultDir }]
    }
    return registry.list().map((ws) => ({
      workspaceId: ws.id,
      name: ws.title,
      notesDir: resolveNotesDir(settings, ws, config.root ?? '.dsh-notes'),
      repo: resolveWorkspaceRepo(settings, ws),
    }))
  }

  const workspaceIdForSession = (sessionId: string | undefined): string | undefined => {
    if (sessionId === undefined) return undefined
    const sessionStore = ctx.get('sessions') as { get(id: string): { header?: { cwd?: string } } | undefined } | undefined
    const cwd = sessionStore?.get(sessionId)?.header?.cwd
    if (typeof cwd !== 'string' || cwd === '') return undefined
    const registry = workspaces()
    const ws = registry?.list().find((candidate) => {
      try {
        return resolve(candidate.path) === resolve(cwd)
      } catch {
        return false
      }
    })
    return ws?.id
  }

  const setAuthorized = async (workspaceId: string | undefined, authorized: boolean): Promise<void> => {
    if (scope === undefined) throw new Error('settings service unavailable')
    const current = scope.get()
    if (workspaceId === undefined) {
      await scope.update({ gitCentral: { ...(current?.gitCentral ?? {}), authorized } })
    } else {
      const repos = { ...(current?.gitRepos ?? {}) }
      repos[workspaceId] = { ...(repos[workspaceId] ?? {}), authorized }
      await scope.update({ gitRepos: repos })
    }
  }

  const updateSettings = async (patch: Record<string, unknown>): Promise<void> => {
    if (scope === undefined) throw new Error('settings service unavailable')
    await scope.update(patch)
  }

  const git: GitApi = {
    status: (repo) => gitStatus(ctx, repo, readSettings().gitBranch ?? 'main'),
    init: (repo) => gitInit(ctx, repo, readSettings().gitBranch ?? 'main'),
    push: (repo, message) => gitPush(ctx, repo, readSettings().gitBranch ?? 'main', message, {
      name: readSettings().gitAuthorName ?? '',
      email: readSettings().gitAuthorEmail ?? '',
    }),
    pull: (repo) => gitPull(ctx, repo),
    sync: (repo) => gitSync(ctx, repo, readSettings().gitBranch ?? 'main'),
  }

  const deps: NotesApiDeps = {
    defaultDir,
    resolveDir,
    resolveRepo,
    listWorkspaces,
    workspaceIdForSession,
    updateSettings,
    git,
    setAuthorized,
    sessionQuery: ctx.get('sessionQuery'),
  }
  const handler = notesApiHandler(deps)
  // lib/../assets/dsh-md-notes.svg — the packaged icon, served as-is.
  const iconPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', 'assets', 'dsh-md-notes.svg',
  )

  const prefix = config.route ?? '/plugins/md-notes'
  ctx.effect(() => web.register({
    kind: 'prefix',
    path: prefix,
    handler,
  }), 'dsh-md-notes: api route')
  ctx.effect(() => web.register({
    kind: 'exact',
    path: `${prefix}/icon.svg`,
    handler: iconHandler(iconPath),
  }), 'dsh-md-notes: icon route')
}
