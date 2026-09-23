/**
 * dsh-md-notes backend plugin entry: a bundle plugin that serves the notes +
 * git API over the webServer HTTP route. Notes live as .md files under a
 * workspace-resolved directory; git sync is opt-in via the `md-notes` settings
 * namespace (three-layer config: schema default → cordis Config → user
 * settings). The browser frontend fetches this API; no typert/Remote toolchain.
 *
 * Domain logic: `notes.ts` (notes), `git.ts` (git + workspace/repo resolution),
 * `settings.ts` (L3 namespace). HTTP assembly in `http.ts`.
 * @module dsh-md-notes
 */

import { fileURLToPath } from 'node:url'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ApiResult, SessionRepairReport } from './contract.ts'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import { isVolatile } from '@deepseek-ai/cosmokit'
import s from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
// Declaration-merge triggers so ctx.webServer / ctx.sessions / ctx.settings /
// ctx.workspaceRegistry / ctx.tools / ctx.approval types are visible.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-workspace'
import {
  createFetchDedup, gitInit, gitPull, gitPush, gitStatus, gitSync, normPath,
  resolveNotesDir, resolveSharedRepo, resolveWorkspaceRepo,
  type ResolvedRepo, type WorkspaceInfo,
} from './host/git.ts'
import { iconHandler, notesApiHandler, type GitApi, type NotesApiDeps, type WorkspaceEntry } from './host/http.ts'
import {
  appendNote, createNote, listNotes, noteExists, readNote, sanitizeName, searchNotes, type SearchScope,
} from './host/notes.ts'
import {
  agentRefs, pickAgentNote, recentAgentNotes, searchScopes, shapeAgentSearch, writeScope, type AgentNoteRef,
} from './host/note-tools.ts'
import { createKeyedLock, createKeyedMutex } from './host/keyed-lock.ts'
import {
  configPatchFromSettings, MdNotesSettingsSchema, mergeOverrides, mergeSettings, MD_NOTES_NS,
  overridesFromConfig, type MdNotesSettings,
} from './host/settings.ts'
import { registerNoteContextInjection } from './host/context-inject.ts'
import { dshSessionsRoot, scanAndRepairSessions } from './host/sessions-repair.ts'
import { createUpdateChecker } from './host/update.ts'

/**
 * One Config field as it actually arrives in `apply`: dsh 0.1.7 delivers a
 * `volatile()` field as a LIVE REFERENCE (`.get()` per read) so a profile-patch
 * edit applies without re-running `apply`. The union keeps older loaders that
 * hand over plain values working.
 */
type Live<T> = Volatile<T> | T

/** Plugin row config. */
export interface Config {
  /**
   * Git mode: 'off' | 'shared' | 'own' (legacy 'on' normalizes to shared/own).
   *
   * (No `route` option on purpose: the browser frontend hardcodes the API prefix
   * `/plugins/md-notes`, so a host-side override would silently sever the
   * client↔host link. The route is a fixed constant on both halves.)
   */
  readonly gitMode?: Live<'off' | 'on' | 'shared' | 'own'>
  /** Shared repo remote URL — the deployment default for `gitCentral.remote`. */
  readonly gitCentralRemote?: Live<string>
  /** Shared repo branch — the deployment default for `gitCentral.branch`. */
  readonly gitCentralBranch?: Live<string>
  /** Per-workspace repos (L2 defaults, keyed by workspace id); L3 overrides per key. */
  readonly gitRepos?: Live<Record<string, import('./host/settings.ts').RepoSettings>>
  /** Pull remote before opening a note (default true). */
  readonly gitAutoPull?: Live<boolean>
  /** Commit author name; empty uses git's global config. */
  readonly gitAuthorName?: Live<string>
  /** Commit author email; empty uses git's global config. */
  readonly gitAuthorEmail?: Live<string>
  /**
   * Whether the npm update check may run (default true). When false the host
   * never contacts registry.npmjs.org — for offline / managed deployments.
   */
  readonly checkUpdate?: boolean
  /**
   * Which agent-facing note tools the model may call (docs/memory.md):
   * `'off'` none (**default**), `'read'` `note_search` + `note_read`,
   * `'write'` all three. A deployment switch rather than a user setting, hence
   * NOT volatile.
   *
   * Default `'off'` is deliberate: the plugin's demonstrated value is being a
   * document manager, and the claim that agent-usable notes improve answers was
   * never established (docs/memory-eval.md exists to test exactly that and has
   * not been run). Shipping agent-writable memory on by default would make
   * users the experiment. `'off'` also suppresses the discovery notice, so a
   * session is byte-identical to the pre-memory plugin.
   */
  readonly agentTools?: 'off' | 'read' | 'write'
}

export const name = 'md-notes'
// 'tools' backs the push_notes agent tool (AI conflict resolution,
// docs/ai-conflict.md); 'approval' powers its two-level native approval gate.
// 'settings' is the dsh 0.1.7 SettingsForms service: the user-editable fields
// live in the profile patch (see `apply`), so it must be present.
export const inject = ['webServer', 'settings', 'tools', 'approval']
// Writable fields are `volatile`: that is how dsh 0.1.7 marks a Config field as
// user-editable through `settings.update` (and how the value keeps updating
// live without re-running `apply` — read it via `plainConfig`/`.get()`, never
// as a plain value). `checkUpdate` stays non-volatile: a deployment switch, not
// user config. No `s<Config>` annotation: volatile fields make the schema's
// inferred config type the Live-typed interface above.
export const Config = s.object({
  gitMode: s.union([s.const('off'), s.const('on'), s.const('shared'), s.const('own')]).default('off').volatile(),
  gitCentralRemote: s.string().default('').volatile(),
  gitCentralBranch: s.string().default('').volatile(),
  gitRepos: s.dict(s.object({
    remote: s.string().required(false),
    branch: s.string().required(false),
    subpath: s.string().required(false),
  })).default({}).volatile(),
  gitAutoPull: s.boolean().default(true).volatile(),
  gitAuthorName: s.string().default('').volatile(),
  gitAuthorEmail: s.string().default('').volatile(),
  checkUpdate: s.boolean().default(true),
  agentTools: s.union([s.const('off'), s.const('read'), s.const('write')]).default('off'),
})

/** Resolve one Live config field to its current plain value. */
function liveValue<T>(value: Live<T> | undefined): T | undefined {
  if (value === undefined) return undefined
  return isVolatile(value) ? (value.get() as T | undefined) : (value as T | undefined)
}

/**
 * Snapshot the volatile Config fields into the plain shape `mergeSettings`
 * expects. Called per read (never cached): that is what makes a profile-patch
 * edit take effect immediately.
 */
function plainConfig(config: Config): {
  gitMode?: 'off' | 'on' | 'shared' | 'own'
  gitCentralRemote?: string
  gitCentralBranch?: string
  gitRepos?: Record<string, import('./host/settings.ts').RepoSettings>
  gitAutoPull?: boolean
  gitAuthorName?: string
  gitAuthorEmail?: string
} {
  return {
    gitMode: liveValue(config.gitMode),
    gitCentralRemote: liveValue(config.gitCentralRemote),
    gitCentralBranch: liveValue(config.gitCentralBranch),
    gitRepos: liveValue(config.gitRepos),
    gitAutoPull: liveValue(config.gitAutoPull),
    gitAuthorName: liveValue(config.gitAuthorName),
    gitAuthorEmail: liveValue(config.gitAuthorEmail),
  }
}

/** Minimal shape of the webServer route registration used here. */
interface WebServerLike {
  register(route: {
    kind: string
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/**
 * Minimal settings-service faces. dsh ≤0.1.6 exposed `settings.register(ns,
 * schema)` → a scoped get/update pair; dsh 0.1.7 replaced that with
 * `SettingsForms` — the editable fields are the plugin's OWN Config schema,
 * user overrides live in the profile patch, and writes go through
 * `settings.update(entryId, patch)` (volatile fields only). Both shapes are
 * detected at load so one build serves either dsh line.
 */
interface SettingsScopeLike {
  get(): MdNotesSettings | undefined
  update(patch: object): Promise<void>
}
interface SettingsFormsLike {
  describe(): Array<{ ns: string; user?: unknown }>
  update(ns: string, patch: object, expectedRevision?: number): Promise<void>
  /** Suppress the auto-generated config page (this plugin ships its own). */
  configure(presentation: { auto?: boolean }, owner?: unknown): () => void
}
interface SettingsServiceLike extends Partial<SettingsFormsLike> {
  register?(ns: unknown, schema: unknown): SettingsScopeLike
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

/**
 * Output-schema fragments for the agent note tools. Spelled out (rather than an
 * open `additionalProperties: true` object) so the inferred tool-result type
 * stays exact and the model gets real field names — see `AgentSearchRow`.
 */
const NOTE_HITS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    line: { type: 'integer', required: true },
    text: { type: 'string', required: true },
  },
} as const

/** One note-search row (mirrors `AgentSearchRow`). */
const NOTE_SEARCH_ROW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    workspaceId: { type: 'string', required: true },
    workspaceName: { type: 'string', required: true },
    name: { type: 'string', required: true },
    title: { type: 'string', required: true },
    updatedAt: { type: 'integer', required: true },
    titleMatch: { type: 'boolean', required: true },
    totalHits: { type: 'integer', required: true },
    hits: { type: 'array', required: true, items: NOTE_HITS_SCHEMA },
  },
} as const

/** One ambiguous-reference candidate (mirrors the `note_read` return). */
const NOTE_CANDIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    workspace: { type: 'string', required: true },
    name: { type: 'string', required: true },
    title: { type: 'string', required: true },
  },
} as const

/** Plugin body. */
export function apply(ctx: Context, config: Config): void {
  const web = ctx.get('webServer') as WebServerLike | undefined
  if (web === undefined) return

  // --- settings: L2 Config + user overrides ---
  // dsh 0.1.7 (SettingsForms) removed `settings.register(ns, schema)`: the
  // editable fields are this plugin's OWN Config schema (the `volatile` ones),
  // user overrides live in the profile patch, and writes go through
  // `settings.update(entryId, patch, revision?)`. `MD_NOTES_NS` is both our
  // namespace and our Loader entry id, so the section is addressed the same way.
  const settings = ctx.get('settings') as SettingsServiceLike | undefined
  /** Cached user-override view; refreshed on write (see `mergeOverrides`). */
  let overridesCache: MdNotesSettings | undefined

  /**
   * This plugin's user overrides — the profile patch, projected through the
   * Config schema (`describe()[].user`). Read lazily and cached: `describe()`
   * only lists entries whose fiber is already ACTIVE, which our own fiber may
   * not be while `apply` still runs.
   */
  const userOverrides = (): MdNotesSettings => {
    if (overridesCache !== undefined) return overridesCache
    let raw: unknown
    try {
      raw = settings?.describe?.().find((descriptor) => descriptor.ns === MD_NOTES_NS)?.user
    } catch {
      return {}
    }
    const parsed = overridesFromConfig(raw)
    if (parsed !== undefined) overridesCache = parsed
    return parsed ?? {}
  }
  // Read through the volatile references every time — that is what makes a
  // profile-patch edit visible without a reload.
  const readSettings = (): MdNotesSettings => mergeSettings(plainConfig(config), userOverrides())

  // dsh 0.1.7 would otherwise auto-generate a config page from the volatile
  // fields; this plugin ships its own settings section. Guarded: `configure`
  // throws if the fiber already has a policy, and throwing here would fail the
  // whole plugin load.
  const configureSettings = settings?.configure
  if (typeof configureSettings === 'function' && settings !== undefined) {
    const owner = settings
    ctx.effect(() => {
      try {
        const dispose = configureSettings.call(owner, { auto: false }, ctx.fiber)
        return () => { dispose() }
      } catch (error: unknown) {
        console.warn('[dsh-md-notes] settings presentation not configured:', error)
        return () => {}
      }
    }, 'dsh-md-notes: settings presentation')
  }

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

  /**
   * Persist user settings into the profile patch (`settings.update`, 0.1.7).
   * Only volatile Config paths are accepted — the whole writable set is marked
   * volatile above. The cached override view is updated in place so a read in
   * the same request cycle already sees the write (the patch reload that
   * re-applies this plugin lands asynchronously).
   */
  const updateSettings = async (patch: Record<string, unknown>): Promise<void> => {
    if (typeof settings?.update !== 'function') throw new Error('settings service unavailable')
    // Validate BEFORE writing: the profile patch is re-validated on every boot,
    // so a malformed value would not merely fail this save — it would break the
    // plugin load on the next start. A partial patch is fine (every field is
    // optional), and validation also strips anything the wire schema disowns.
    let validated: MdNotesSettings
    try {
      validated = MdNotesSettingsSchema(patch)
    } catch (error: unknown) {
      throw new Error(`invalid settings: ${error instanceof Error ? error.message : String(error)}`)
    }
    await settings.update(MD_NOTES_NS, configPatchFromSettings(validated as Record<string, unknown>))
    overridesCache = mergeOverrides(userOverrides(), validated as Record<string, unknown>)
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
  // Lifecycle-scoped fetch deduper shared by every gitStatus call (dies with
  // this apply — no module-level cache accumulating across HMR reloads).
  const fetchDedup = createFetchDedup()
  const git: GitApi = {
    status: (repo, notesDir) => gitMutex.runExclusive(`repo/${repo.repoDir}`, () => gitStatus(ctx, repo, repo.branch, notesDir, fetchDedup)),
    init: (repo) => gitMutex.runExclusive(`repo/${repo.repoDir}`, () => gitInit(ctx, repo, repo.branch)),
    push: (repo, notesDir, message, overwrite) => gitMutex.runExclusive(`repo/${repo.repoDir}`, () => gitPush(ctx, repo, notesDir, message, {
      name: readSettings().gitAuthorName ?? '',
      email: readSettings().gitAuthorEmail ?? '',
    }, overwrite)),
    pull: (repo, notesDir, force, manual) => gitMutex.runExclusive(`repo/${repo.repoDir}`, () => gitPull(ctx, repo, notesDir, force, manual)),
    sync: (repo) => gitMutex.runExclusive(`repo/${repo.repoDir}`, () => gitSync(ctx, repo)),
  }

  // --- push_notes agent tool (AI conflict resolution, docs/ai-conflict.md) ---
  // Registered for every agent session; the description scopes its use to the
  // AI-conflict flow and EVERY call goes through dsh's native approval panel
  // (ctx.approval) — pushing is a remote mutation the user must confirm. When
  // the first push is rejected with remote-changed (normal after an AI merge:
  // base is unchanged), a SECOND approval asks to overwrite the remote.
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'push_notes',
    description: 'Push the notes of one dsh-md-notes workspace to its configured git remote. '
      + 'Use this after resolving note conflicts (or after editing notes) when the user asks to sync. '
      + 'The user must approve each push in the approval panel.',
    parameters: {
      workspaceId: { type: 'string', description: 'The workspace whose notes to push.', required: true },
      message: { type: 'string', description: 'Optional commit message. Defaults to a timestamped message.' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', required: true },
          code: { type: 'string' },
          error: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? 'Notes pushed to the remote successfully.'
          : `Push failed${value.code ? ` (${value.code})` : ''}: ${value.error ?? 'unknown error'}`,
      }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('push_notes requires an agent session')
      const approval = ctx.get('approval')
      // inject guarantees the service; this guard is for hand-built contexts.
      if (approval === undefined) throw new Error('push_notes requires the approval service')
      const notesDir = resolveDir(args.workspaceId)
      const repo = resolveRepo(args.workspaceId)
      if (notesDir === undefined || repo === undefined) {
        return { ok: false, code: 'no-repo', error: 'No git repo is configured for this workspace.' }
      }
      const requestApproval = (reason: string): Promise<boolean> =>
        approval.request({
          agent: exec.agent!,
          toolName: 'push_notes',
          callId: exec.callId,
          reason,
          signal: exec.signal,
        }).then((outcome) => outcome === 'allowed-once')
      if (!await requestApproval('推送笔记到远端仓库 / Push notes to the remote repository')) {
        throw new Error('push_notes was rejected by the user — report this and stop; do not retry the push.')
      }
      const commitMessage = args.message !== undefined && args.message.trim() !== ''
        ? args.message.trim()
        : `Notes update ${new Date().toLocaleString()}`
      let result = await git.push(repo, notesDir, commitMessage, false)
      if (result.ok !== true && result.code === 'remote-changed') {
        // Normal after an AI merge (base unchanged): the remote still differs
        // from what this device last synced. Ask to overwrite explicitly.
        const approved = await requestApproval('远端笔记与本地不同，确认用本地版本覆盖远端？ / The remote notes differ — overwrite the remote with your local (merged) version?')
        if (!approved) {
          throw new Error('push_notes overwrite was rejected by the user — keep the local merge and stop; do not retry the push.')
        }
        result = await git.push(repo, notesDir, commitMessage, true)
      }
      // Sidecar cleanup rides the successful gitPush itself (single choke
      // point shared with the manager UI's push and merge-remote-retry).
      return result.ok === true
        ? { ok: true }
        : { ok: false, code: result.code, error: result.error }
    },
    presentCall: (args) => ({ card: 'generic', title: `Push notes (${args.workspaceId})`, kind: 'other' as const, rawInput: args }),
  })), 'dsh-md-notes: push_notes tool')

  // --- agent-facing note tools (docs/memory.md) ---
  // The pivot from "a human attaches a note with `@`" to "the model decides to
  // look". A model cannot browse the manager UI, so these tools are the only
  // way notes can improve an answer on their own initiative. Gated by
  // `agentTools` (a deployment switch): `off` for a pure document manager,
  // `read` for consult-but-do-not-write, `write` (default) for memory.
  //
  // The TOOL DESCRIPTION is the policy (step 2 of docs/memory.md): it is the
  // one channel that reaches the model every step for free, so the "when to
  // consult" guidance lives there rather than in a per-step injected message.
  const agentTools = config.agentTools ?? 'off'

  /** Workspaces one call may touch: an explicit id/name, else every REGISTERED workspace. */
  const registeredAgentScopes = (workspaceRef: string | undefined): SearchScope[] => {
    const all = listWorkspaces()
    const needle = (workspaceRef ?? '').trim().toLowerCase()
    const selected = needle === ''
      ? all
      : all.filter((ws) => ws.workspaceId.toLowerCase() === needle || ws.name.trim().toLowerCase() === needle)
    return selected.map((ws) => ({ workspaceId: ws.workspaceId, workspaceName: ws.name, dir: ws.notesDir }))
  }

  /** The session's working directory — the notes dir is always `<cwd>/.dsh-notes`. */
  const cwdOf = (exec: unknown): string | undefined => {
    const cwd = (exec as { agent?: { session?: { header?: { cwd?: unknown } } } })
      .agent?.session?.header?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  }

  /**
   * The session cwd's OWN notes scope, when that directory is not a registered
   * workspace. Headless/SDK runs and ad-hoc directories land here; without it
   * those sessions would silently read or write somebody else's notes. An
   * already-registered directory returns `undefined` so the registered scope
   * (with its real workspace title) stays the one that answers. The existence
   * check means a read path never creates a `.dsh-notes` dir.
   */
  const localAgentScope = async (cwd: string | undefined): Promise<SearchScope | undefined> => {
    if (cwd === undefined) return undefined
    const dir = path.join(cwd, '.dsh-notes')
    if (registeredAgentScopes(undefined).some((scope) => path.resolve(scope.dir) === path.resolve(dir))) {
      return undefined
    }
    try {
      await stat(dir)
    } catch {
      return undefined
    }
    return { workspaceId: `cwd:${cwd}`, workspaceName: path.basename(cwd) || cwd, dir }
  }

  /** Every addressable note across the given scopes (one `listNotes` pass each). */
  const collectAgentRefs = async (scopes: readonly SearchScope[]): Promise<AgentNoteRef[]> => {
    const refs: AgentNoteRef[] = []
    for (const scope of scopes) {
      const listed = await listNotes(scope.dir)
      if (listed.ok) refs.push(...agentRefs({ workspaceId: scope.workspaceId, workspaceName: scope.workspaceName }, listed.notes))
    }
    return refs
  }

  /** The session's own session id (undefined outside an agent turn). */
  const sessionIdOf = (exec: { agent?: { id: unknown } }): string | undefined =>
    exec.agent === undefined ? undefined : String(exec.agent.id)

  if (agentTools !== 'off') {
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'note_search',
      description: 'Search the user\'s dsh notes — a durable, human-curated knowledge base kept per workspace under `.dsh-notes`. '
        + 'Consult it BEFORE answering when the task depends on project background, conventions, past decisions, environment facts, or stated user preferences that the repository does not spell out. '
        + 'Omit `query` to list the most recently updated notes when you do not yet know what the library holds. '
        + 'Follow up with note_read for full text — never claim a note lacks something you have not read.',
      parameters: {
        query: { type: 'string', description: 'Whitespace-separated keywords (all must match). Omit to list recent notes.' },
        workspace: { type: 'string', description: 'Workspace id or name. Defaults to every workspace.' },
        limit: { type: 'number', description: 'Maximum notes to return (default 8, max 25).' },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', required: true },
            listed: { type: 'boolean' },
            truncated: { type: 'boolean' },
            results: { type: 'array', items: NOTE_SEARCH_ROW_SCHEMA },
            code: { type: 'string' },
            error: { type: 'string' },
          },
          additionalProperties: false,
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.ok
            ? `${value.listed ? 'Notes (most recent)' : 'Note search'}: ${String((value.results ?? []).length)} result(s)${value.truncated ? ' (truncated)' : ''}.`
            : `Note search failed${value.code ? ` (${value.code})` : ''}: ${value.error ?? 'unknown error'}`,
        }],
      },
      async execute(args, exec) {
        const local = (args.workspace ?? '').trim() === '' ? await localAgentScope(cwdOf(exec)) : undefined
        const scopes = searchScopes(registeredAgentScopes(args.workspace), local)
        if (scopes.length === 0) {
          return { ok: false, code: 'no-workspace', error: `No workspace matches "${args.workspace ?? ''}".` }
        }
        const limit = Math.min(Math.max(1, Math.trunc(args.limit ?? 8)), 25)
        const query = (args.query ?? '').trim()
        if (query === '') {
          const refs = await collectAgentRefs(scopes)
          const recent = recentAgentNotes(refs, limit)
          return {
            ok: true,
            listed: true,
            truncated: refs.length > recent.length,
            results: recent.map((ref) => ({ ...ref, titleMatch: false, totalHits: 0, hits: [] })),
          }
        }
        const found = await searchNotes(scopes, query)
        const shaped = shapeAgentSearch(found.results, limit)
        return { ok: true, listed: false, truncated: shaped.truncated || found.truncated, results: shaped.results }
      },
      presentCall: (args) => ({
        card: 'generic', title: `Search notes: ${args.query ?? '(recent)'}`, kind: 'other' as const, rawInput: args,
      }),
    })), 'dsh-md-notes: note_search tool')

    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'note_read',
      description: 'Read one dsh note in full, by file name (with or without `.md`) or by its exact display title. '
        + 'Use it after note_search returns a candidate, or when the user names a note directly. '
        + 'A reference that matches notes in several workspaces comes back as candidates — pass `workspace` to disambiguate rather than guessing.',
      parameters: {
        name: { type: 'string', description: 'Note file name (e.g. a.md) or its exact display title.', required: true },
        workspace: { type: 'string', description: 'Workspace id or name, to disambiguate.' },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', required: true },
            workspace: { type: 'string' },
            name: { type: 'string' },
            title: { type: 'string' },
            content: { type: 'string' },
            candidates: { type: 'array', items: NOTE_CANDIDATE_SCHEMA },
            code: { type: 'string' },
            error: { type: 'string' },
          },
          additionalProperties: false,
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.ok
            ? `Note ${value.workspace ?? ''}/${value.name ?? ''} (${String((value.content ?? '').length)} chars).`
            : `Note read failed${value.code ? ` (${value.code})` : ''}: ${value.error ?? 'unknown error'}`,
        }],
      },
      async execute(args, exec) {
        const sessionId = sessionIdOf(exec)
        const local = (args.workspace ?? '').trim() === '' ? await localAgentScope(cwdOf(exec)) : undefined
        const scopes = searchScopes(registeredAgentScopes(args.workspace), local)
        if (scopes.length === 0) {
          return { ok: false, code: 'no-workspace', error: `No workspace matches "${args.workspace ?? ''}".` }
        }
        const preferred = workspaceIdForSession(sessionId) ?? local?.workspaceId
        const picked = pickAgentNote(await collectAgentRefs(scopes), args.name, preferred)
        if (!picked.ok) {
          return picked.candidates.length === 0
            ? { ok: false, code: 'not-found', error: `No note matches "${args.name}".` }
            : {
                ok: false,
                code: 'ambiguous',
                error: `Several notes match "${args.name}" — pass workspace to choose one.`,
                candidates: picked.candidates.map((ref) => ({ workspace: ref.workspaceName, name: ref.name, title: ref.title })),
              }
        }
        const scope = scopes.find((candidate) => candidate.workspaceId === picked.note.workspaceId)
        if (scope === undefined) return { ok: false, code: 'not-found', error: `No note matches "${args.name}".` }
        const read = await readNote(scope.dir, picked.note.name)
        return {
          ok: true,
          workspace: picked.note.workspaceName,
          name: read.name,
          title: picked.note.title,
          content: read.content,
        }
      },
      presentCall: (args) => ({ card: 'generic', title: `Read note ${args.name}`, kind: 'other' as const, rawInput: args }),
    })), 'dsh-md-notes: note_read tool')
  }

  if (agentTools === 'write') {
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'note_write',
      description: 'Record a durable fact in the user\'s dsh notes so a FUTURE session can find it. '
        + 'Use it when the user states a lasting preference, convention, environment fact, or decision — not for transient task state, and not for anything the repository already states. '
        + 'APPEND-ONLY: an existing note is extended, never overwritten (`mode: "create"` refuses to touch an existing file). '
        + 'Keep one entry short, self-contained, and attributable in prose; prefer extending a topic note found via note_search over creating a near-duplicate.',
      parameters: {
        name: { type: 'string', description: 'Note file name (.md optional) or the title of a new note.', required: true },
        content: { type: 'string', description: 'The markdown block to record (one short entry).', required: true },
        title: { type: 'string', description: 'Title for a newly created note. Defaults to the file name.' },
        mode: { type: 'string', enum: ['append', 'create'], description: 'append (default) extends or creates; create refuses an existing note.' },
        workspace: { type: 'string', description: 'Workspace id or name. Defaults to the calling session\'s workspace.' },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', required: true },
            workspace: { type: 'string' },
            name: { type: 'string' },
            created: { type: 'boolean' },
            code: { type: 'string' },
            error: { type: 'string' },
          },
          additionalProperties: false,
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.ok
            ? `Note ${value.workspace ?? ''}/${value.name ?? ''} ${value.created === true ? 'created' : 'extended'}.`
            : `Note write failed${value.code ? ` (${value.code})` : ''}: ${value.error ?? 'unknown error'}`,
        }],
      },
      async execute(args, exec) {
        const explicit = (args.workspace ?? '').trim() !== ''
        const registered = registeredAgentScopes(args.workspace)
        if (explicit && registered.length === 0) {
          return { ok: false, code: 'no-workspace', error: `No workspace matches "${args.workspace ?? ''}".` }
        }
        const local = explicit ? undefined : await localAgentScope(cwdOf(exec))
        const scope = writeScope(registered, workspaceIdForSession(sessionIdOf(exec)), local)
        if (scope === undefined) {
          // No silent fallback to "some other workspace": appending a durable
          // fact into the wrong project's notes is worse than asking.
          return { ok: false, code: 'no-workspace', error: 'No workspace resolved for this session — pass `workspace`.' }
        }
        const name = sanitizeName(args.name)
        const mode = args.mode ?? 'append'
        if (mode === 'create' && await noteExists(scope.dir, name)) {
          return { ok: false, code: 'note-exists', error: `Note ${name} already exists — append instead of overwriting it.` }
        }
        const lock = await deps.lock.with(`${scope.workspaceId}/${name}`, async () => {
          // Both branches report one shape so the tool result stays uniform.
          if (mode === 'create') {
            const made = await createNote(
              scope.dir,
              args.title !== undefined && args.title.trim() !== '' ? args.title : name,
              name,
              args.content,
            )
            return { name: made.name, created: true }
          }
          const appended = await appendNote(scope.dir, name, args.title ?? '', args.content)
          return { name: appended.name, created: appended.created }
        })
        if (!lock.acquired) {
          return { ok: false, code: 'note-writing', error: 'The note is being written, try again later.' }
        }
        return { ok: true, workspace: scope.workspaceName, name: lock.value.name, created: lock.value.created }
      },
      presentCall: (args) => ({ card: 'generic', title: `Write note ${args.name}`, kind: 'other' as const, rawInput: args }),
    })), 'dsh-md-notes: note_write tool')
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

  const repairSessionsDeps = async (): Promise<ApiResult<SessionRepairReport>> => {
    try {
      return { ok: true, ...(await scanAndRepairSessions(dshSessionsRoot())) }
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  const deps: NotesApiDeps = {
    resolveDir,
    resolveRepo,
    listWorkspaces,
    workspaceIdForSession,
    updateSettings,
    readSettings: () => userOverrides() as Record<string, unknown>,
    hasWorkspaces: () => {
      const registry = workspaces()
      return registry !== undefined && registry.list().length > 0
    },
    checkUpdate,
    repairSessions: repairSessionsDeps,
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

  // Fixed API prefix — must equal the frontend's hardcoded API constant
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
  ctx.effect(() => registerNoteContextInjection(ctx, { tools: agentTools }), 'dsh-md-notes: context injection')
}
