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
import { createKeyedLock } from './host/keyed-lock.ts'
import { MdNotesSettingsSchema, mergeSettings, MD_NOTES_NS, type MdNotesSettings } from './host/settings.ts'
import { registerNoteContextInjection } from './host/context-inject.ts'

/** Plugin row config. */
export interface Config {
  /** API route prefix (default /plugins/md-notes). */
  readonly route?: string
  /** Git mode: 'off' | 'shared' | 'own' (legacy 'on' normalizes to shared/own). */
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
}

export const name = 'md-notes'
export const inject = ['webServer', 'settings']
export const Config: s<Config> = s.object({
  route: s.string().default('/plugins/md-notes'),
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

  const git: GitApi = {
    status: (repo, notesDir) => gitStatus(ctx, repo, repo.branch, notesDir),
    init: (repo) => gitInit(ctx, repo, repo.branch),
    push: (repo, notesDir, message, overwrite) => gitPush(ctx, repo, notesDir, message, {
      name: readSettings().gitAuthorName ?? '',
      email: readSettings().gitAuthorEmail ?? '',
    }, overwrite),
    pull: (repo, notesDir, force, manual) => gitPull(ctx, repo, notesDir, force, manual),
    sync: (repo) => gitSync(ctx, repo),
  }

  const suggest = (): Record<string, unknown> => {
    const registry = workspaces()
    const wsEntries = registry === undefined ? [] : registry.list()
    return {
      workspaces: wsEntries.map((ws) => ({ workspaceId: ws.id, path: join(ws.path, '.dsh-notes') })),
    }
  }

  // --- update check: latest npm version vs the installed one (cached 10 min) ---
  let updateCache: { at: number; latest: string; hasUpdate: boolean } | null = null
  const checkUpdate = async (): Promise<{ ok: true; current: string; latest: string; hasUpdate: boolean } | { ok: false }> => {
    // Current version: read the package.json next to the built lib dir.
    let current = ''
    try {
      const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
      const pkg = JSON.parse(await import('node:fs/promises').then((m) => m.readFile(pkgPath, 'utf8'))) as { version?: string }
      current = pkg.version ?? ''
    } catch {
      current = ''
    }
    if (current === '') return { ok: false }
    if (updateCache !== null && Date.now() - updateCache.at < 10 * 60 * 1000) {
      return { ok: true, current, latest: updateCache.latest, hasUpdate: updateCache.hasUpdate }
    }
    try {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 10_000)
      const res = await fetch('https://registry.npmjs.org/dsh-md-notes/latest', { signal: ac.signal })
      clearTimeout(timer)
      if (!res.ok) return { ok: false }
      const data = await res.json() as { version?: string }
      const latest = data.version ?? ''
      if (latest === '') return { ok: false }
      const cmp = compareVersions(latest, current)
      updateCache = { at: Date.now(), latest, hasUpdate: cmp > 0 }
      return { ok: true, current, latest, hasUpdate: cmp > 0 }
    } catch {
      return { ok: false }
    }
  }

  /** Compare two semver-ish version strings; returns >0 when a is newer. */
  const compareVersions = (a: string, b: string): number => {
    const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
    const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0)
      if (d !== 0) return d
    }
    return 0
  }

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
  // Note-content injection: fold referenced notes into the model request at
  // every agent pre-step (reliable references without relying on `read`).
  ctx.effect(() => registerNoteContextInjection(ctx), 'dsh-md-notes: context injection')
}
