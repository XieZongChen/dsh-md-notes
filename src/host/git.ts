/**
 * Git domain logic for dsh-md-notes: `runGit` via the subprocess service,
 * workspace → repo resolution (mutually exclusive shared / own modes), and
 * the git operations the API dispatches (status / init / push / pull / sync).
 *
 * Model (v4): notes ALWAYS live at `<workspace>/.dsh-notes` locally; the git
 * repo is identified by its **URL only** — the plugin keeps a local clone at
 * `$DSH_HOME/md-notes-repos/<url-hash>/`, so the user never supplies a path
 * and no sandbox authorization is needed (the clone lives in plugin-managed
 * storage under DSH_HOME). Pushing copies the workspace's `.md` notes into
 * the clone's target directory (`<subpath>` on `<branch>`), commits, and
 * pushes; pulling refreshes the clone, then copies those notes back (never
 * overwriting a locally-different file). `meta.json` is never committed.
 * @module dsh-md-notes/git
 */

import { join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { mkdir, readdir, readFile, copyFile, stat, rm } from 'node:fs/promises'
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
  /** Git repository root directory (plugin-managed clone under DSH_HOME). */
  repoDir: string
  /** In-repo relative directory holding this workspace's notes ('' = repo root). */
  subdir: string
  /** Branch to push/pull on. */
  branch: string
  /** Remote URL (the repo's identity). */
  remote: string
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

/** Sanitize a workspace title into a filesystem folder name. */
function sanitizeFolder(name: string): string {
  const cleaned = name.replace(/[^\w\u4e00-\u9fff.-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'workspace'
}

/** The plugin-managed clone directory for one remote URL. */
export function cloneDirFor(remote: string): string {
  const home = process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh')
  const hash = createHash('sha1').update(remote).digest('hex').slice(0, 12)
  return join(home, 'md-notes-repos', hash)
}

/**
 * Resolve the repo serving one workspace under the CURRENT mode:
 * - `gitMode: 'shared'` → the shared repo (`gitCentral.remote`, branch from
 *   `gitCentral.branch` / 'main') with a per-workspace folder.
 * - `gitMode: 'own'` → the workspace's own repo (`gitRepos[ws]`:
 *   remote + branch / subpath).
 * - otherwise → undefined (git off / nothing configured).
 */
export function resolveWorkspaceRepo(settings: MdNotesSettings, ws: WorkspaceInfo): ResolvedRepo | undefined {
  if (settings.gitMode === 'shared') {
    const remote = settings.gitCentral?.remote
    if (!remote) return undefined
    return {
      kind: 'shared',
      repoDir: cloneDirFor(remote),
      subdir: sanitizeFolder(ws.title),
      branch: settings.gitCentral?.branch?.trim() ? settings.gitCentral.branch : 'main',
      remote,
    }
  }
  if (settings.gitMode === 'own') {
    const own = settings.gitRepos?.[ws.id]
    if (!own?.remote) return undefined
    return {
      kind: 'own',
      repoDir: cloneDirFor(own.remote),
      subdir: own.subpath ?? '',
      branch: own.branch?.trim() ? own.branch : 'main',
      remote: own.remote,
    }
  }
  return undefined
}

/**
 * The shared repo as a GLOBAL operation target (whole-repo add scope).
 * Returns undefined when gitMode is not 'shared' or the shared repo has no URL.
 */
export function resolveSharedRepo(settings: MdNotesSettings): ResolvedRepo | undefined {
  if (settings.gitMode !== 'shared') return undefined
  const remote = settings.gitCentral?.remote
  if (!remote) return undefined
  return {
    kind: 'shared',
    repoDir: cloneDirFor(remote),
    subdir: '',
    branch: settings.gitCentral?.branch?.trim() ? settings.gitCentral.branch : 'main',
    remote,
  }
}

/**
 * Notes directory for a workspace: ALWAYS `<ws>/.dsh-notes` (v3/v4 — the git
 * repo never determines where notes live; notes are workspace-bound).
 */
export function resolveNotesDir(_settings: MdNotesSettings, ws: WorkspaceInfo): string {
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

/** A convenience error type carrying a machine code + user-facing message. */
export class GitError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'GitError'
    this.code = code
  }
}

/**
 * Ensure the clone exists: `git clone` the remote URL into the
 * plugin-managed directory when absent. Idempotent.
 */
export async function gitInit(ctx: Context, repo: ResolvedRepo, _branch: string): Promise<void> {
  if (existsSync(join(repo.repoDir, '.git'))) return
  mkdirSync(join(repo.repoDir, '..'), { recursive: true })
  const clone = await runGit(ctx, join(repo.repoDir, '..'), ['clone', repo.remote, repo.repoDir])
  if (clone.code !== 0) throw new GitError('clone-failed', `git clone failed: ${clone.stderr || clone.stdout}`)
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
  /** Notes whose local state differs from the repo target (not yet pushed). */
  unpushed?: number
  /** Number of remote commits ahead of the local clone, scoped to this subdir. */
  remoteAhead?: number
  lastCommit?: string
  remote?: string
  error?: string
}

/** Status of one repo: branch, uncommitted file count, unpushed count, last commit, remote presence. */
export async function gitStatus(ctx: Context, repo: ResolvedRepo, branch: string, notesDir: string): Promise<GitStatusView> {
  try {
    await gitInit(ctx, repo, branch)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  // Refresh origin refs so the "remote has updates" check reflects the real
  // remote (a cheap no-op when nothing new; failures are tolerated below).
  await fetchOrigin(ctx, repo)
  const target = repoTargetDir(repo)
  const scope = repo.subdir === '' ? '.' : repo.subdir.replace(/\\/g, '/')
  const [branchRes, porcelain, lastLog, unpushed, aheadRes] = await Promise.all([
    runGit(ctx, repo.repoDir, ['branch', '--show-current']),
    runGit(ctx, repo.repoDir, ['status', '--porcelain', '--', scope]),
    runGit(ctx, repo.repoDir, ['log', '-1', '--format=%cr', '--', scope]),
    unpushedCount(notesDir, target),
    runGit(ctx, repo.repoDir, ['rev-list', '--count', `${repo.branch}..origin/${repo.branch}`, '--', scope]),
  ])
  const currentBranch = branchRes.code === 0 ? branchRes.stdout.trim() : branch
  const uncommitted = porcelain.code === 0
    ? porcelain.stdout.split('\n').filter((line) => line.trim() !== '').length
    : 0
  const lastCommit = lastLog.code === 0 ? lastLog.stdout.trim() : undefined
  const remoteAhead = aheadRes.code === 0 ? Number(aheadRes.stdout.trim()) || 0 : 0
  return {
    ok: true,
    repoDir: repo.repoDir,
    subdir: repo.subdir,
    branch: currentBranch,
    uncommitted,
    unpushed,
    remoteAhead,
    lastCommit: lastCommit || undefined,
    remote: repo.remote,
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
      error: 'Git commit identity not configured: set git config user.name / user.email (local or global) in the repo, or set gitAuthorName / gitAuthorEmail in plugin config',
    }
  }
  return { args }
}

/**
 * Ensure the local clone is on `repo.branch` and up to date with the remote:
 * first `git fetch origin` (so the remote-tracking ref actually moves — the
 * previous code relied on `git pull`, which failed on the freshly-created
 * branch because it had no upstream, and the error was silently swallowed),
 * then check the branch out from `origin/<branch>` (or create it locally).
 * Returns the git run result; callers must check `.code`.
 */
async function ensureBranch(ctx: Context, repo: ResolvedRepo): Promise<GitRunResult> {
  const fetch = await fetchOrigin(ctx, repo)
  if (fetch.code !== 0) return fetch
  return checkoutBranch(ctx, repo)
}

/** Fetch `origin` and return the git run result (callers check `.code`). */
async function fetchOrigin(ctx: Context, repo: ResolvedRepo): Promise<GitRunResult> {
  return runGit(ctx, repo.repoDir, ['fetch', 'origin'])
}

/**
 * Check `repo.branch` out from `origin/<branch>` (assumes origin was already
 * fetched), or create it locally when the remote branch is absent.
 */
async function checkoutBranch(ctx: Context, repo: ResolvedRepo): Promise<GitRunResult> {
  const remoteBranch = `origin/${repo.branch}`
  const hasRemoteBranch = await runGit(ctx, repo.repoDir, ['show-ref', '--verify', `refs/remotes/${remoteBranch}`])
  if (hasRemoteBranch.code === 0) {
    return runGit(ctx, repo.repoDir, ['checkout', '-B', repo.branch, remoteBranch])
  }
  const hasLocal = await runGit(ctx, repo.repoDir, ['show-ref', '--verify', `refs/heads/${repo.branch}`])
  if (hasLocal.code === 0) {
    return runGit(ctx, repo.repoDir, ['checkout', repo.branch])
  }
  return runGit(ctx, repo.repoDir, ['checkout', '-b', repo.branch])
}

/**
 * Compare the remote's notes (clone target dir, already fetched) against the
 * local notes dir: returns names of notes that exist on BOTH sides with
 * different content — pushing would overwrite the remote's newer version.
 */
export async function changedNotes(remoteDir: string, localDir: string): Promise<string[]> {
  let names: string[] = []
  try {
    names = (await readdir(remoteDir)).filter((n) => n.endsWith('.md'))
  } catch {
    return []
  }
  const changed: string[] = []
  for (const name of names) {
    const localPath = join(localDir, name)
    if (!existsSync(localPath)) continue // local lacks it → no overwrite conflict
    try {
      const [a, b] = await Promise.all([readFile(join(remoteDir, name), 'utf8'), readFile(localPath, 'utf8')])
      if (a !== b) changed.push(name)
    } catch {
      // unreadable → ignore
    }
  }
  return changed
}

/**
 * Names of `.md` notes present in `remoteDir` but absent in `localDir` —
 * a push would DELETE them from the remote (mirror semantics). Surfaced so
 * the user can confirm before those files are removed.
 */
export async function remoteOnlyNotes(remoteDir: string, localDir: string): Promise<string[]> {
  let remoteNames: string[] = []
  try {
    remoteNames = (await readdir(remoteDir)).filter((n) => n.endsWith('.md'))
  } catch {
    return []
  }
  const localNames = new Set<string>()
  try {
    for (const n of (await readdir(localDir)).filter((x) => x.endsWith('.md'))) localNames.add(n)
  } catch {
    // local dir unreadable → treat everything as remote-only
  }
  return remoteNames.filter((n) => !localNames.has(n))
}

/**
 * Number of notes whose local state differs from the repo target dir — i.e.
 * the "not yet pushed" changes: locally new notes, locally deleted notes, and
 * notes present on both sides with different content. This is the user-facing
 * "unpushed" metric (unlike `git status --porcelain`, which only sees the
 * clone's own working tree and stays 0 until a push syncs the notes in).
 */
async function unpushedCount(localDir: string, targetDir: string): Promise<number> {
  const [modified, deletedLocally, addedLocally] = await Promise.all([
    changedNotes(targetDir, localDir),
    remoteOnlyNotes(targetDir, localDir),
    remoteOnlyNotes(localDir, targetDir),
  ])
  return modified.length + deletedLocally.length + addedLocally.length
}

/**
 * Delete `.md` notes in `remoteDir` that do not exist in `localDir`
 * (mirror the local deletion to the remote). Returns the removed names.
 */
export async function deleteMissingNotes(remoteDir: string, localDir: string): Promise<string[]> {
  const only = await remoteOnlyNotes(remoteDir, localDir)
  const removed: string[] = []
  for (const name of only) {
    try {
      await rm(join(remoteDir, name))
      removed.push(name)
    } catch {
      // best effort
    }
  }
  return removed
}

/**
 * Read a directory's `.md` notes into a `name → content` map. A missing
 * directory or an unreadable file yields an empty/partial map (absent = absent).
 */
async function readNoteMap(dir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  let names: string[] = []
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.md'))
  } catch {
    return map
  }
  for (const name of names) {
    try {
      map.set(name, await readFile(join(dir, name), 'utf8'))
    } catch {
      // unreadable → omit
    }
  }
  return map
}

/**
 * Push-time conflict names: a note is a conflict when its REMOTE side changed
 * since `base` (modified / added / deleted) AND its local side still differs
 * from the remote — pushing would overwrite or delete that remote change. A
 * note the local side edited while the remote stayed at `base` is NOT a
 * conflict.
 */
function pushConflicts(
  base: Map<string, string>, local: Map<string, string>, remote: Map<string, string>,
): string[] {
  const names = new Set([...base.keys(), ...local.keys(), ...remote.keys()])
  const conflicts: string[] = []
  for (const name of names) {
    const b = base.get(name)
    const l = local.get(name)
    const r = remote.get(name)
    if (b !== r && l !== r) conflicts.push(name)
  }
  return conflicts
}

/**
 * Three-way pull of remote notes into the local dir. `base` is the last-synced
 * state, `local` the workspace notes, `remote` the freshly-checked-out repo
 * notes. A note is overwritten only when the remote changed and the local side
 * did not (or is absent); a local-only edit is preserved silently; a note both
 * sides changed (a true conflict) is preserved and reported.
 */
async function threeWaySync(
  srcDir: string, destDir: string,
  base: Map<string, string>, local: Map<string, string>, remote: Map<string, string>,
): Promise<{ copied: number; conflicts: string[] }> {
  await mkdir(destDir, { recursive: true })
  let copied = 0
  const conflicts: string[] = []
  for (const [name, remoteContent] of remote) {
    const localContent = local.get(name)
    const baseContent = base.get(name)
    if (localContent === remoteContent) continue // already in sync
    const localChanged = localContent !== baseContent
    const remoteChanged = remoteContent !== baseContent
    if (localChanged && remoteChanged) {
      conflicts.push(name) // both diverged → keep local, report conflict
      continue
    }
    if (localChanged) continue // only local changed → keep local silently
    try {
      await copyFile(join(srcDir, name), join(destDir, name))
      copied++
    } catch {
      // unreadable → skip
    }
  }
  return { copied, conflicts }
}

/**
 * Push a workspace's notes into the repo target directory: mirror the local
 * notes dir into `<repo>/<subdir>` — copy local `.md` (overwrite) AND delete
 * `.md` notes present remotely but missing locally, so deletions sync too.
 * Before touching anything, when `overwrite` is false, a note whose REMOTE
 * side changed since the last sync (modified / added / deleted) AND whose
 * local side still differs — a true conflict — blocks the push and returns
 * `code: 'remote-changed'`. A plain local edit with an unchanged remote is NOT
 * a conflict and pushes straight through. The caller (the UI) then asks the
 * user whether to overwrite/delete and retries with `overwrite: true`.
 */
export async function gitPush(
  ctx: Context, repo: ResolvedRepo, notesDir: string, message: string,
  author: { name: string; email: string }, overwrite = false,
): Promise<{ ok: boolean; error?: string; code?: string; changed?: string[] }> {
  await gitInit(ctx, repo, repo.branch)
  // Last-synced baseline — read BEFORE ensureBranch resets the clone to origin.
  const base = await readNoteMap(repoTargetDir(repo))
  const branch = await ensureBranch(ctx, repo)
  if (branch.code !== 0) return { ok: false, code: 'sync-branch', error: `Sync branch failed: ${branch.stderr || branch.stdout}` }
  // Detect true conflicts (remote changed since base AND local still differs).
  const target = repoTargetDir(repo)
  if (!overwrite) {
    const [local, remote] = await Promise.all([
      readNoteMap(notesDir),
      readNoteMap(target),
    ])
    const conflicts = pushConflicts(base, local, remote)
    if (conflicts.length > 0) {
      return {
        ok: false,
        code: 'remote-changed',
        changed: conflicts,
        error: `Remote notes differ from or are missing locally: ${conflicts.join(', ')}. Overwrite/delete the remote with your local state?`,
      }
    }
  }
  // Mirror the local notes dir into the repo target directory.
  try {
    await syncNotes(notesDir, target, true)
    await deleteMissingNotes(target, notesDir)
  } catch (error) {
    return { ok: false, code: 'sync-notes', error: `Sync notes to repo failed: ${error instanceof Error ? error.message : String(error)}` }
  }

  const addScope = repo.subdir === '' ? '.' : repo.subdir.replace(/\\/g, '/')
  // `-A` so deletions staged as well.
  const add = await runGit(ctx, repo.repoDir, ['add', '-A', '--', addScope])
  if (add.code !== 0) return { ok: false, code: 'git-failed', error: `git add failed: ${add.stderr || add.stdout}` }

  const identity = await resolveIdentity(ctx, repo, author)
  if (identity.error !== undefined) return { ok: false, code: 'identity', error: identity.error }

  // Scope both the change check and the commit to this workspace's subdir, so
  // a shared repo never commits another workspace's staged/uncommitted files.
  const porcelain = await runGit(ctx, repo.repoDir, ['status', '--porcelain', '--', addScope])
  const hasChanges = porcelain.code === 0 && porcelain.stdout.trim() !== ''
  if (hasChanges) {
    const commit = await runGit(ctx, repo.repoDir, [...identity.args, 'commit', '-m', message, '--', addScope])
    if (commit.code !== 0) return { ok: false, code: 'git-failed', error: `git commit failed: ${commit.stderr || commit.stdout}` }
  }

  const push = await runGit(ctx, repo.repoDir, [...identity.args, 'push', '-u', 'origin', repo.branch])
  if (push.code !== 0) {
    const out = `${push.stderr || ''} ${push.stdout || ''}`
    if (/non-fast-forward|rejected/.test(out)) {
      return {
        ok: false,
        code: 'non-fast-forward',
        error: 'git push failed: the remote is ahead or histories are unrelated; merge the remote first then push again (use the in-app "merge remote & retry" button)',
      }
    }
    return { ok: false, code: 'git-failed', error: `git push failed: ${push.stderr || push.stdout}` }
  }
  return { ok: true }
}

/**
 * Refresh a workspace's notes from the repo: ensure the branch is up to date
 * with the remote, then copy the repo's `<subdir>` `.md` notes back into the
 * local notes dir.
 *
 * `force` controls overwrite: true = the remote/clone version wins (the user
 * explicitly confirmed overwriting); false = three-way — a note is overwritten
 * only when the remote changed and the local side did not; a local-only edit is
 * preserved silently; a true conflict (both sides changed) is preserved and
 * reported in `skipped`/`changed`.
 *
 * `manual` distinguishes a user-initiated Update from the implicit auto-pull
 * on open: a manual Update ALWAYS syncs the clone into the local dir (the user
 * asked for exactly that), while auto-pull short-circuits when the remote has
 * no new commits (no needless fetch/sync, and no false "remote updated" hint
 * for a mere unpushed local edit). The short-circuit must NOT apply to a
 * manual update: the clone can hold newer content than the local dir even when
 * its git branch already matches origin (e.g. the local file was reverted
 * after a push), and that is exactly what the user wants pulled back.
 */
export async function gitPull(
  ctx: Context, repo: ResolvedRepo, notesDir: string, force: boolean, manual = false,
): Promise<{ ok: boolean; code?: string; error?: string; skipped?: number; changed?: string[] }> {
  await gitInit(ctx, repo, repo.branch)
  // Last-synced baseline — read BEFORE checkout resets the clone to origin.
  const base = await readNoteMap(repoTargetDir(repo))
  const fetch = await fetchOrigin(ctx, repo)
  if (fetch.code !== 0) return { ok: false, code: 'sync-branch', error: `Sync branch failed: ${fetch.stderr || fetch.stdout}` }
  if (!manual) {
    // Auto-pull only: does the remote actually have new commits? Judged by git
    // refs (fetch has moved origin/<branch> to the remote tip), NOT by content
    // diff — a local edit that was never pushed differs from the clone without
    // the remote having any update, and must not be reported as "remote updated".
    //
    // MUST run before checkoutBranch: `checkout -B branch origin/branch` resets
    // the local branch onto the remote tip, which would make this count always
    // zero and silently skip every pull.
    const ahead = await runGit(ctx, repo.repoDir, ['rev-list', '--count', `${repo.branch}..origin/${repo.branch}`])
    const remoteAhead = ahead.code === 0 && Number(ahead.stdout.trim()) > 0
    if (!remoteAhead) {
      return { ok: true, skipped: 0, changed: force ? undefined : [] }
    }
  }
  const branch = await checkoutBranch(ctx, repo)
  if (branch.code !== 0) return { ok: false, code: 'sync-branch', error: `Sync branch failed: ${branch.stderr || branch.stdout}` }
  const target = repoTargetDir(repo)
  if (force) {
    // Manual confirmed overwrite: the remote/clone version wins outright.
    const { skipped } = await syncNotes(target, notesDir, true)
    return { ok: true, skipped, changed: undefined }
  }
  // Conservative three-way: overwrite only "remote changed, local unchanged";
  // preserve local-only edits silently; report true conflicts (both changed).
  const [local, remote] = await Promise.all([
    readNoteMap(notesDir),
    readNoteMap(target),
  ])
  const { conflicts } = await threeWaySync(target, notesDir, base, local, remote)
  return { ok: true, skipped: conflicts.length, changed: conflicts }
}

/**
 * User-initiated conflict resolution after a rejected push: merge the remote
 * branch (`git pull --no-rebase`), falling back to `--allow-unrelated-histories`
 * for a first push against a non-empty remote. Never runs automatically — the
 * caller (the client's "merge remote & retry" button) is the user's decision.
 */
export async function gitSync(ctx: Context, repo: ResolvedRepo): Promise<{ ok: boolean; code?: string; error?: string }> {
  await gitInit(ctx, repo, repo.branch)
  const branch = await ensureBranch(ctx, repo)
  if (branch.code !== 0) return { ok: false, code: 'sync-branch', error: `Sync branch failed: ${branch.stderr || branch.stdout}` }
  const merge = await runGit(ctx, repo.repoDir, ['pull', '--no-rebase', '--no-edit'])
  if (merge.code === 0) return { ok: true }
  const out = `${merge.stderr || ''} ${merge.stdout || ''}`
  if (/unrelated histories/i.test(out)) {
    const merge2 = await runGit(ctx, repo.repoDir, ['pull', '--allow-unrelated-histories', '--no-rebase', '--no-edit'])
    if (merge2.code === 0) return { ok: true }
    return { ok: false, code: 'git-failed', error: merge2.stderr || merge2.stdout || 'git pull failed (unrelated histories)' }
  }
  return { ok: false, code: 'git-failed', error: merge.stderr || merge.stdout || 'git pull failed' }
}
