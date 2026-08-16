/**
 * Git domain logic for dsh-md-notes: `runGit` via the subprocess service,
 * workspace → repo resolution (mutually exclusive shared / own modes), the
 * sandbox-external authorization gate, and the git operations the API
 * dispatches (status / init / push / pull / sync).
 *
 * Model (v3): notes ALWAYS live at `<workspace>/.dsh-notes` locally — the git
 * repo is an independent sync target. Pushing copies the workspace's `.md`
 * notes into the repo's target directory (`<subpath>` on `<branch>`), commits,
 * and pushes; pulling refreshes the repo, then copies those notes back (never
 * overwriting a locally-different file).
 *
 * The subprocess seam is a raw spawn (no command sandbox), so authorization is
 * enforced **in-plugin**: the persisted per-repo `authorized` flag is the gate
 * for repos outside the session workspace. `meta.json` is gitignored (never
 * committed).
 * @module dsh-md-notes/git
 */

import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { mkdirSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { mkdir, readdir, readFile, copyFile, stat } from 'node:fs/promises'
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
  kind: 'shared' | 'own'
  /** Git repository root directory. */
  repoDir: string
  /** In-repo relative directory holding this workspace's notes ('' = repo root). */
  subdir: string
  /** Branch to push/pull on. */
  branch: string
  remote: string
  /** Repo lives outside the session workspace (needs the authorization gate). */
  external: boolean
  /** Persisted authorization for external repos; internal repos are always allowed. */
  authorized: boolean
}

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

/** Realpath-normalize a path for comparison (symlinks, case-insensitive FS). */
export function normPath(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

/** True when `child` is inside or equal to `parent`. */
function isInside(parent: string, child: string): boolean {
  const rel = relative(normPath(parent), normPath(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Sanitize a workspace title into a filesystem folder name. */
function sanitizeFolder(name: string): string {
  const cleaned = name.replace(/[^\w\u4e00-\u9fff.-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'workspace'
}

/**
 * The in-repo subdir for a workspace under the shared repo: the workspace
 * name (sanitized); a collision appends the id's first 8 chars.
 */
export function sharedSubdir(ws: WorkspaceInfo): string {
  return sanitizeFolder(ws.title)
}

/**
 * Resolve the repo serving one workspace under the CURRENT mode:
 * - `gitMode: 'shared'` → the shared repo (`main` branch, per-workspace
 *   folder) when configured and authorized.
 * - `gitMode: 'own'` → the workspace's own repo (branch defaults to
 *   `main`, subpath defaults to the repo root).
 * - otherwise → undefined (git off / nothing configured).
 */
export function resolveWorkspaceRepo(settings: MdNotesSettings, ws: WorkspaceInfo): ResolvedRepo | undefined {
  if (settings.gitMode === 'shared') {
    const centralPath = settings.gitCentral?.path
    if (!centralPath || settings.gitCentral?.authorized !== true) return undefined
    const repoDir = resolve(centralPath)
    return {
      kind: 'shared',
      repoDir,
      subdir: sharedSubdir(ws),
      branch: 'main',
      remote: settings.gitCentral?.remote ?? '',
      external: true,
      authorized: true,
    }
  }
  if (settings.gitMode === 'own') {
    const own = settings.gitRepos?.[ws.id]
    if (!own?.path) return undefined
    const repoDir = resolve(own.path)
    const external = !isInside(resolve(ws.path), repoDir)
    return {
      kind: 'own',
      repoDir,
      subdir: own.subpath ?? '',
      branch: own.branch ?? 'main',
      remote: own.remote ?? '',
      external,
      authorized: external ? own.authorized === true : true,
    }
  }
  return undefined
}

/**
 * The shared repo as a GLOBAL operation target (whole-repo add scope).
 * Returns undefined when gitMode is not 'shared' or the shared repo is not
 * configured/authorized.
 */
export function resolveSharedRepo(settings: MdNotesSettings): ResolvedRepo | undefined {
  if (settings.gitMode !== 'shared') return undefined
  const centralPath = settings.gitCentral?.path
  if (!centralPath || settings.gitCentral?.authorized !== true) return undefined
  const repoDir = resolve(centralPath)
  return {
    kind: 'shared',
    repoDir,
    subdir: '',
    branch: 'main',
    remote: settings.gitCentral?.remote ?? '',
    external: true,
    authorized: true,
  }
}

/**
 * Notes directory for a workspace: ALWAYS `<ws>/.dsh-notes` (v3 — the git
 * repo never determines where notes live). The fallback root only applies to
 * sessions with no workspace.
 */
export function resolveNotesDir(_settings: MdNotesSettings, ws: WorkspaceInfo, _fallbackRoot: string): string {
  return join(resolve(ws.path), '.dsh-notes')
}

/** The absolute in-repo directory where this workspace's notes sync to. */
export function repoTargetDir(repo: ResolvedRepo): string {
  return repo.subdir === '' ? repo.repoDir : join(repo.repoDir, ...repo.subdir.split(sep).filter(Boolean))
}

/**
 * Copy `*.md` files from `srcDir` to `destDir`. `overwrite` controls whether
 * an existing file with different content is replaced (push) or preserved
 * (pull refresh). Returns counts for reporting.
 */
export async function syncNotes(
  srcDir: string,
  destDir: string,
  overwrite: boolean,
): Promise<{ copied: number; skipped: number }> {
  let names: string[] = []
  try {
    names = (await readdir(srcDir)).filter((n) => n.endsWith('.md'))
  } catch {
    return { copied: 0, skipped: 0 }
  }
  await mkdir(destDir, { recursive: true })
  let copied = 0
  let skipped = 0
  for (const name of names) {
    const from = join(srcDir, name)
    const to = join(destDir, name)
    try {
      const st = await stat(to).catch(() => undefined)
      if (st !== undefined && !overwrite) {
        const [a, b] = await Promise.all([readFile(from, 'utf8'), readFile(to, 'utf8')])
        if (a === b) { copied += 1; continue }
        skipped += 1
        continue
      }
      await copyFile(from, to)
      copied += 1
    } catch {
      skipped += 1
    }
  }
  return { copied, skipped }
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
  /** In-repo subdir for this workspace ('' = repo root). */
  subdir?: string
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
  return {
    ok: true,
    repoDir: repo.repoDir,
    subdir: repo.subdir,
    branch: currentBranch,
    uncommitted,
    lastCommit: lastCommit || undefined,
    remote,
  }
}

/** Resolve commit identity: repo-local config wins, plugin config falls back. */
async function resolveIdentity(
  ctx: Context, repo: ResolvedRepo, author: { name: string; email: string },
): Promise<{ args: string[]; error?: string }> {
  const [existingName, existingEmail] = await Promise.all([
    runGit(ctx, repo.repoDir, ['config', 'user.name']),
    runGit(ctx, repo.repoDir, ['config', 'user.email']),
  ])
  const hasIdentity = existingName.code === 0 && existingName.stdout.trim() !== ''
    && existingEmail.code === 0 && existingEmail.stdout.trim() !== ''
  if (hasIdentity) return { args: [] }
  const args: string[] = []
  if (author.name) args.push('-c', `user.name=${author.name}`)
  if (author.email) args.push('-c', `user.email=${author.email}`)
  if (args.length === 0) {
    return {
      args,
      error: 'git 提交身份未配置：请在仓库中设置 git config user.name / user.email（本地或全局），或在插件配置中设置 gitAuthorName / gitAuthorEmail',
    }
  }
  return { args }
}

/**
 * Push a workspace's notes into the repo target directory: copy the local
 * `.md` notes into `<repo>/<subdir>` (overwrite), stage that subdir, commit,
 * and push `branch`. Conflicts surface to the caller; the push-back pull is
 * best-effort.
 */
export async function gitPush(
  ctx: Context, repo: ResolvedRepo, notesDir: string, message: string, author: { name: string; email: string },
): Promise<{ ok: boolean; error?: string; code?: string }> {
  await gitInit(ctx, repo, repo.branch)
  // Copy the workspace's notes into the repo target directory.
  const target = repoTargetDir(repo)
  try {
    await syncNotes(notesDir, target, true)
  } catch (error) {
    return { ok: false, error: `同步笔记到仓库失败: ${error instanceof Error ? error.message : String(error)}` }
  }

  const addScope = repo.subdir === '' ? '.' : repo.subdir.replace(/\\/g, '/')
  const add = await runGit(ctx, repo.repoDir, ['add', '--', addScope])
  if (add.code !== 0) return { ok: false, error: `git add 失败: ${add.stderr || add.stdout}` }

  const identity = await resolveIdentity(ctx, repo, author)
  if (identity.error !== undefined) return { ok: false, error: identity.error }

  const porcelain = await runGit(ctx, repo.repoDir, ['status', '--porcelain'])
  const hasChanges = porcelain.code === 0 && porcelain.stdout.trim() !== ''
  if (hasChanges) {
    const commit = await runGit(ctx, repo.repoDir, [...identity.args, 'commit', '-m', message])
    if (commit.code !== 0) return { ok: false, error: `git commit 失败: ${commit.stderr || commit.stdout}` }
  }

  if (repo.remote) {
    const remotes = await runGit(ctx, repo.repoDir, ['remote'])
    if (!remotes.stdout.includes('origin')) {
      const addRemote = await runGit(ctx, repo.repoDir, ['remote', 'add', 'origin', repo.remote])
      if (addRemote.code !== 0) return { ok: false, error: `git remote add 失败: ${addRemote.stderr || addRemote.stdout}` }
    }
    const push = await runGit(ctx, repo.repoDir, [...identity.args, 'push', '-u', 'origin', repo.branch])
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

/**
 * Refresh a workspace's notes from the repo: pull the repo (when a remote
 * exists), then copy the repo's `<subdir>` `.md` notes back into the local
 * notes dir — without overwriting a locally-different file (conservative).
 */
export async function gitPull(
  ctx: Context, repo: ResolvedRepo, notesDir: string,
): Promise<{ ok: boolean; error?: string; skipped?: number }> {
  await gitInit(ctx, repo, repo.branch)
  if (repo.remote) {
    const pull = await runGit(ctx, repo.repoDir, ['pull', '--no-edit'])
    if (pull.code !== 0) return { ok: false, error: pull.stderr || pull.stdout || 'git pull 失败' }
  }
  const target = repoTargetDir(repo)
  const { skipped } = await syncNotes(target, notesDir, false)
  return { ok: true, skipped }
}

/**
 * User-initiated conflict resolution after a rejected push: merge the remote
 * branch (`git pull --no-rebase`), falling back to `--allow-unrelated-histories`
 * for a first push against a non-empty remote. Never runs automatically — the
 * caller (the client's "merge remote & retry" button) is the user's decision.
 */
export async function gitSync(ctx: Context, repo: ResolvedRepo): Promise<{ ok: boolean; error?: string }> {
  await gitInit(ctx, repo, repo.branch)
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
