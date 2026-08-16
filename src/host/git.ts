/**
 * Git domain logic for dsh-md-notes: `runGit` via the subprocess service,
 * workspace → repo resolution (own repo or central fallback), the
 * sandbox-external authorization gate, and the git operations the API
 * dispatches (status / init / push / pull).
 *
 * The subprocess seam is a raw spawn (no command sandbox), so authorization is
 * enforced **in-plugin**: the persisted per-repo `authorized` flag is the gate
 * for repos outside the session workspace. `meta.json` is gitignored (never
 * committed); the central repo's `.dsh-workspaces.json` mapping rides commits.
 * @module dsh-md-notes/git
 */

import { isAbsolute, join, relative, resolve } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { MdNotesSettings } from './settings.ts'

/** One dsh workspace: stable id, canonical path, display title. */
export interface WorkspaceInfo {
  id: string
  path: string
  title: string
}

/** One collected git run. */
export interface GitRunResult {
  code: number
  stdout: string
  stderr: string
}

/** A workspace's resolved repo (or undefined when git is off / no usable repo). */
export interface ResolvedRepo {
  kind: 'own' | 'central'
  /** Git repository root directory. */
  repoDir: string
  /** Directory holding this workspace's notes. */
  noteDir: string
  /** `git add` argument: `'.'` for an own repo, `<folder>` for the central repo. */
  addScope: string
  remote: string
  /** Repo lives outside the session workspace (needs the authorization gate). */
  external: boolean
  /** Persisted authorization for external repos; internal repos are always allowed. */
  authorized: boolean
}

/** Central-repo folder mapping file (committed, cross-machine consistent). */
export const WS_MAP_FILE = '.dsh-workspaces.json'

const GIT_TIMEOUT_MS = 60_000
const COLLECT_MAX = 512 * 1024

/** Minimal subprocess-service face used here (raw spawn; no sandbox). */
interface SubprocessLike {
  spawn(spec: {
    argv: readonly string[]
    cwd: string
    stdio: { stdin: 'ignore'; stdout: { maxBytes: number }; stderr: { maxBytes: number } }
    graceMs: number
    signal?: AbortSignal
  }): {
    done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>
    collected: {
      stdout?: { readFrom(offset: number): { text: string } }
      stderr?: { readFrom(offset: number): { text: string } }
    }
  }
}

/** Run `git <args>` in `cwd` and collect bounded output. */
export async function runGit(ctx: Context, cwd: string, args: readonly string[]): Promise<GitRunResult> {
  const subprocess = ctx.get('subprocess') as SubprocessLike | undefined
  if (subprocess === undefined) throw new Error('git: subprocess service unavailable')
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), GIT_TIMEOUT_MS)
  try {
    const handle = subprocess.spawn({
      argv: ['git', ...args],
      cwd,
      stdio: { stdin: 'ignore', stdout: { maxBytes: COLLECT_MAX }, stderr: { maxBytes: COLLECT_MAX } },
      graceMs: 5_000,
      signal: ac.signal,
    })
    const outcome = await handle.done
    const read = (r: unknown): string => {
      try {
        return (r as { readFrom(offset: number): { text: string } }).readFrom(0).text
      } catch {
        return ''
      }
    }
    return { code: outcome.exitCode ?? -1, stdout: read(handle.collected?.stdout), stderr: read(handle.collected?.stderr) }
  } finally {
    clearTimeout(timer)
  }
}

/** True when `child` is inside or equal to `parent`. */
function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Sanitize a workspace title into a filesystem folder name. */
function sanitizeFolder(name: string): string {
  const cleaned = name.replace(/[^\w\u4e00-\u9fff.-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'workspace'
}

/**
 * Read the workspace→folder mapping for the central repo, returning (and
 * creating, when absent) this workspace's folder. Folder names lock at first
 * creation; the mapping file is written best-effort (committed via git later).
 */
function workspaceFolder(central: string, ws: WorkspaceInfo): string {
  const mapPath = join(central, WS_MAP_FILE)
  let map: Record<string, string> = {}
  try {
    map = JSON.parse(readFileSync(mapPath, 'utf8')) as Record<string, string>
  } catch {
    map = {}
  }
  const existing = map[ws.id]
  if (existing !== undefined && existing !== '') return existing
  let folder = sanitizeFolder(ws.title)
  const taken = new Set(Object.values(map))
  if (taken.has(folder)) folder = `${folder}-${ws.id.slice(0, 8)}`
  map[ws.id] = folder
  mkdirSync(join(central, folder), { recursive: true })
  try {
    writeFileSync(mapPath, JSON.stringify(map, null, 2))
  } catch {
    // best effort — the folder still works; the mapping re-creates on next read
  }
  return folder
}

/**
 * Resolve the repo serving one workspace, or `undefined` when git is off or no
 * usable repo exists (own repo unset AND central missing/unauthorized).
 */
export function resolveWorkspaceRepo(settings: MdNotesSettings, ws: WorkspaceInfo): ResolvedRepo | undefined {
  const own = settings.gitRepos?.[ws.id]
  if (own?.path) {
    const repoDir = resolve(own.path)
    const external = !isInside(resolve(ws.path), repoDir)
    return {
      kind: 'own',
      repoDir,
      noteDir: repoDir,
      addScope: '.',
      remote: own.remote ?? '',
      external,
      authorized: external ? own.authorized === true : true,
    }
  }
  const centralPath = settings.gitCentral?.path
  if (centralPath && settings.gitCentral?.authorized === true) {
    const central = resolve(centralPath)
    const folder = workspaceFolder(central, ws)
    return {
      kind: 'central',
      repoDir: central,
      noteDir: join(central, folder),
      addScope: folder,
      remote: settings.gitCentral?.remote ?? '',
      external: true,
      authorized: true,
    }
  }
  return undefined
}

/**
 * The central repo as the GLOBAL operation target (whole-repo add scope).
 * Returns undefined when the central repo is not configured or authorized.
 */
export function resolveCentralRepo(settings: MdNotesSettings): ResolvedRepo | undefined {
  const centralPath = settings.gitCentral?.path
  if (!centralPath || settings.gitCentral?.authorized !== true) return undefined
  const repoDir = resolve(centralPath)
  return {
    kind: 'central',
    repoDir,
    noteDir: repoDir,
    addScope: '.',
    remote: settings.gitCentral?.remote ?? '',
    external: true,
    authorized: true,
  }
}

/**
 * Notes directory for a workspace under the current settings (git-aware).
 * git off → `config.root` (an absolute override applies as-is; a relative
 * root resolves per workspace). git on with a usable repo → the repo's note
 * dir; git on with NO repo → the workspace's OWN `.dsh-notes` (isolated from
 * other workspaces, never the shared absolute root).
 */
export function resolveNotesDir(settings: MdNotesSettings, ws: WorkspaceInfo, fallbackRoot: string): string {
  if (settings.gitMode !== 'on') return resolveInside(ws.path, fallbackRoot)
  const repo = resolveWorkspaceRepo(settings, ws)
  if (repo !== undefined) return repo.noteDir
  return join(resolve(ws.path), '.dsh-notes')
}

/** Resolve a possibly-relative fallback root against the workspace path. */
function resolveInside(wsPath: string, root: string): string {
  return isAbsolute(root) ? root : resolve(wsPath, root)
}

/** A convenience error type carrying a user-facing message. */
export class GitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitError'
  }
}

/** Ensure the repo exists (git init + .gitignore), idempotent. */
export async function gitInit(ctx: Context, repo: ResolvedRepo, branch: string): Promise<void> {
  if (!existsSync(join(repo.repoDir, '.git'))) {
    mkdirSync(repo.repoDir, { recursive: true })
    const init = await runGit(ctx, repo.repoDir, ['init', '-b', branch])
    if (init.code !== 0) throw new GitError(`git init 失败: ${init.stderr || init.stdout}`)
  }
  const ignorePath = join(repo.repoDir, '.gitignore')
  if (!existsSync(ignorePath)) {
    try {
      writeFileSync(ignorePath, 'meta.json\n.DS_Store\n')
    } catch {
      // best effort
    }
  }
}

export interface GitStatusView {
  ok: boolean
  repoDir?: string
  branch?: string
  uncommitted?: number
  lastCommit?: string
  remote?: string
  error?: string
}

/** Status of one repo: branch, uncommitted file count, last commit, remote presence. */
export async function gitStatus(ctx: Context, repo: ResolvedRepo, branch: string): Promise<GitStatusView> {
  try {
    await gitInit(ctx, repo, branch)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  const [branchRes, porcelain, lastLog, remoteName] = await Promise.all([
    runGit(ctx, repo.repoDir, ['branch', '--show-current']),
    runGit(ctx, repo.repoDir, ['status', '--porcelain']),
    runGit(ctx, repo.repoDir, ['log', '-1', '--format=%cr']),
    runGit(ctx, repo.repoDir, ['remote']),
  ])
  const currentBranch = branchRes.code === 0 ? branchRes.stdout.trim() : branch
  const uncommitted = porcelain.code === 0
    ? porcelain.stdout.split('\n').filter((line) => line.trim() !== '').length
    : 0
  const lastCommit = lastLog.code === 0 ? lastLog.stdout.trim() : undefined
  const remote = remoteName.code === 0 && remoteName.stdout.trim() !== '' ? remoteName.stdout.trim().split('\n')[0] ?? '' : repo.remote
  return { ok: true, repoDir: repo.repoDir, branch: currentBranch, uncommitted, lastCommit: lastCommit || undefined, remote }
}

/** Stage + commit + push (with author identity), then pull back to stay in sync. */
export async function gitPush(
  ctx: Context, repo: ResolvedRepo, branch: string, message: string, author: { name: string; email: string },
): Promise<{ ok: boolean; error?: string; code?: string }> {
  await gitInit(ctx, repo, branch)
  // Stage the workspace scope; central pushes also carry the workspace mapping.
  const addTargets = repo.kind === 'central' ? [repo.addScope, WS_MAP_FILE] : [repo.addScope]
  const add = await runGit(ctx, repo.repoDir, ['add', '--', ...addTargets])
  if (add.code !== 0) return { ok: false, error: `git add 失败: ${add.stderr || add.stdout}` }

  // Commit identity: the repo's OWN git config (local `.git/config` or global)
  // wins — matching the per-project `[user]` convention. The plugin's configured
  // identity is only a fallback when the repo has none; fail with guidance
  // otherwise instead of letting git emit its cryptic identity error.
  const identity: string[] = []
  const [existingName, existingEmail] = await Promise.all([
    runGit(ctx, repo.repoDir, ['config', 'user.name']),
    runGit(ctx, repo.repoDir, ['config', 'user.email']),
  ])
  const hasIdentity = existingName.code === 0 && existingName.stdout.trim() !== ''
    && existingEmail.code === 0 && existingEmail.stdout.trim() !== ''
  if (!hasIdentity) {
    if (author.name || author.email) {
      if (author.name) identity.push('-c', `user.name=${author.name}`)
      if (author.email) identity.push('-c', `user.email=${author.email}`)
    } else {
      return {
        ok: false,
        error: 'git 提交身份未配置：请在仓库中设置 git config user.name / user.email（本地或全局），或在插件配置中设置 gitAuthorName / gitAuthorEmail',
      }
    }
  }

  const porcelain = await runGit(ctx, repo.repoDir, ['status', '--porcelain'])
  const hasChanges = porcelain.code === 0 && porcelain.stdout.trim() !== ''
  if (hasChanges) {
    const commit = await runGit(ctx, repo.repoDir, [...identity, 'commit', '-m', message])
    if (commit.code !== 0) return { ok: false, error: `git commit 失败: ${commit.stderr || commit.stdout}` }
  }

  if (repo.remote) {
    const remotes = await runGit(ctx, repo.repoDir, ['remote'])
    if (!remotes.stdout.includes('origin')) {
      const addRemote = await runGit(ctx, repo.repoDir, ['remote', 'add', 'origin', repo.remote])
      if (addRemote.code !== 0) return { ok: false, error: `git remote add 失败: ${addRemote.stderr || addRemote.stdout}` }
    }
    const push = await runGit(ctx, repo.repoDir, [...identity, 'push', '-u', 'origin', branch])
    if (push.code !== 0) {
      const out = `${push.stderr || ''} ${push.stdout || ''}`
      if (/non-fast-forward|rejected/.test(out)) {
        return {
          ok: false,
          code: 'non-fast-forward',
          error: 'git push 失败：远端领先或历史不相关，需先合并远端再推送（可在界面点「合并远端并重试」）',
        }
      }
      return { ok: false, error: `git push 失败: ${push.stderr || push.stdout}` }
    }
    // Pull back after a successful push to stay in sync (conflicts surface to the caller).
    await runGit(ctx, repo.repoDir, ['pull', '--no-edit'])
  }
  return { ok: true }
}

/** Pull the repo (whole-repo). Conflicts are surfaced, never auto-resolved. */
export async function gitPull(ctx: Context, repo: ResolvedRepo): Promise<{ ok: boolean; error?: string }> {
  await gitInit(ctx, repo, 'main')
  if (!repo.remote) return { ok: false, error: '未配置远程，无法拉取' }
  const pull = await runGit(ctx, repo.repoDir, ['pull', '--no-edit'])
  if (pull.code !== 0) return { ok: false, error: pull.stderr || pull.stdout || 'git pull 失败' }
  return { ok: true }
}

/**
 * User-initiated conflict resolution after a rejected push: merge the remote
 * branch (`git pull --no-rebase`), falling back to `--allow-unrelated-histories`
 * for a first push against a non-empty remote. Never runs automatically — the
 * caller (the client's "merge remote & retry" button) is the user's decision.
 */
export async function gitSync(ctx: Context, repo: ResolvedRepo, branch: string): Promise<{ ok: boolean; error?: string }> {
  await gitInit(ctx, repo, branch)
  if (!repo.remote) return { ok: false, error: '未配置远程，无法合并' }
  const merge = await runGit(ctx, repo.repoDir, ['pull', '--no-rebase', '--no-edit'])
  if (merge.code === 0) return { ok: true }
  const out = `${merge.stderr || ''} ${merge.stdout || ''}`
  if (/unrelated histories/i.test(out)) {
    const merge2 = await runGit(ctx, repo.repoDir, ['pull', '--allow-unrelated-histories', '--no-rebase', '--no-edit'])
    if (merge2.code === 0) return { ok: true }
    return { ok: false, error: merge2.stderr || merge2.stdout || 'git pull 失败（历史不相关）' }
  }
  return { ok: false, error: merge.stderr || merge.stdout || 'git pull 失败' }
}

/** True when the caller may run git operations on this repo. */
export function isAuthorized(repo: ResolvedRepo): boolean {
  return !repo.external || repo.authorized
}
