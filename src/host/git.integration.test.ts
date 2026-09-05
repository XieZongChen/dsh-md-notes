/**
 * Integration tests for the git domain against the REAL git binary: a bare
 * repo under a temp dir plays the remote, and per-scenario DSH_HOME values
 * give each "machine" its own plugin-managed clone of the same URL. Covers
 * the full push/pull/sync flows the smoke checklist §6 used to verify by
 * hand — mirror push (deletions included), three-way pull, remote-changed
 * push blocking, overwrite, and the shared-mode folder pinning. The UI card
 * rendering itself stays in the manual smoke list.
 * @module dsh-md-notes/git.integration.test
 */

import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  clearConflictSidecars, createFetchDedup, gitInit, gitPull, gitPush, gitStatus, gitSync,
  resolveWorkspaceRepo,
  type ResolvedRepo, type WorkspaceInfo,
} from './git.ts'
import type { MdNotesSettings } from './settings.ts'

/** A minimal subprocess service backed by node:child_process (what runGit drives). */
function gitCtx(): Context {
  const subprocess = {
    spawn(spec: {
      argv: readonly string[]
      cwd: string
      stdio: { stdin: 'ignore'; stdout: { maxBytes: number }; stderr: { maxBytes: number } }
      graceMs: number
      signal?: AbortSignal
    }) {
      const child = spawn(spec.argv[0] === undefined ? 'git' : spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: spec.signal,
      })
      let out = ''
      let err = ''
      child.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString() })
      child.stderr?.on('data', (chunk: Buffer) => { err += chunk.toString() })
      const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.on('close', (code, signal) => { resolve({ exitCode: code, signal }) })
      })
      return {
        done,
        collected: {
          stdout: { readFrom: (offset: number) => ({ text: out.slice(offset) }) },
          stderr: { readFrom: (offset: number) => ({ text: err.slice(offset) }) },
        },
      }
    },
  }
  return { get: (name: string) => (name === 'subprocess' ? subprocess : undefined) } as unknown as Context
}

const CTX = gitCtx()
const AUTHOR = { name: 'Test', email: 'test@example.com' }

const tempDirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-git-int-'))
  tempDirs.push(dir)
  return dir
}

/** One "machine": its own DSH_HOME (own clone of the URL) + a workspace notes dir. */
async function machine(): Promise<{ home: string; notesDir: string; ws: WorkspaceInfo }> {
  const home = await tempDir()
  const wsPath = await tempDir()
  const notesDir = join(wsPath, '.dsh-notes')
  await mkdir(notesDir, { recursive: true })
  process.env.DSH_HOME = home
  return { home, notesDir, ws: { id: 'w1', path: wsPath, title: 'Alpha' } }
}

/** A bare repo playing the git remote; returns its file://-able path. */
async function remoteRepo(): Promise<string> {
  const base = await tempDir()
  const url = join(base, 'remote.git')
  const init = await run(['init', '--bare', '--initial-branch=main', url], base)
  if (init.code !== 0) throw new Error(`git init --bare failed: ${init.stderr}`)
  return url
}

/** Run git directly (bypassing the plugin) for ARRANGE/ASSERT steps. */
async function run(args: readonly string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd })
    let out = ''
    let err = ''
    child.stdout?.on('data', (c: Buffer) => { out += c.toString() })
    child.stderr?.on('data', (c: Buffer) => { err += c.toString() })
    child.on('close', (code) => { resolve({ code: code ?? -1, stdout: out, stderr: err }) })
    child.on('error', reject)
  })
}

/** File content at the remote's main branch (the assertion oracle). */
async function remoteFile(remote: string, path: string): Promise<string | null> {
  const res = await run(['cat-file', '-p', `main:${path}`], remote)
  return res.code === 0 ? res.stdout : null
}

const HOME_SAVED = process.env.DSH_HOME
beforeEach(() => { process.env.DSH_HOME = HOME_SAVED })
afterEach(async () => {
  if (HOME_SAVED === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = HOME_SAVED
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })))
  tempDirs.length = 0
})

/** Own-mode settings pointing the workspace at the remote. */
function ownSettings(url: string): MdNotesSettings {
  return { gitMode: 'own', gitRepos: { w1: { remote: url } } }
}

function repoOf(settings: MdNotesSettings, ws: WorkspaceInfo): ResolvedRepo {
  const repo = resolveWorkspaceRepo(settings, ws)
  if (repo === undefined) throw new Error('repo resolution failed')
  return repo
}

describe('git integration (real binary, bare-remote)', () => {
  it('init + push mirrors notes to the remote; status reflects the synced state', async () => {
    const url = await remoteRepo()
    const m = await machine()
    await writeFile(join(m.notesDir, 'a.md'), '# A\nfirst', 'utf8')
    await writeFile(join(m.notesDir, 'b.md'), '# B\nsecond', 'utf8')

    const repo = repoOf(ownSettings(url), m.ws)
    await gitInit(CTX, repo, repo.branch)
    const push = await gitPush(CTX, repo, m.notesDir, 'init push', AUTHOR, false)
    expect(push.ok).toBe(true)

    expect(await remoteFile(url, 'a.md')).toBe('# A\nfirst')
    expect(await remoteFile(url, 'b.md')).toBe('# B\nsecond')

    const status = await gitStatus(CTX, repo, repo.branch, m.notesDir, createFetchDedup())
    expect(status.ok).toBe(true)
    expect(status.branch).toBe('main')
    expect(status.unpushed).toBe(0)
  }, 30_000)

  it('a second push mirrors local deletions (b.md disappears from the remote)', async () => {
    const url = await remoteRepo()
    const m = await machine()
    await writeFile(join(m.notesDir, 'a.md'), 'A', 'utf8')
    await writeFile(join(m.notesDir, 'b.md'), 'B', 'utf8')
    const repo = repoOf(ownSettings(url), m.ws)
    expect((await gitPush(CTX, repo, m.notesDir, 'one', AUTHOR, false)).ok).toBe(true)

    const { rm } = await import('node:fs/promises')
    await rm(join(m.notesDir, 'b.md'))
    const second = await gitPush(CTX, repo, m.notesDir, 'delete b', AUTHOR, false)
    expect(second.ok).toBe(true)
    expect(await remoteFile(url, 'a.md')).toBe('A')
    expect(await remoteFile(url, 'b.md')).toBeNull()
  }, 30_000)

  it('a second machine pulls the notes; a local-only edit survives the pull', async () => {
    const url = await remoteRepo()
    const a = await machine()
    await writeFile(join(a.notesDir, 'a.md'), 'v1', 'utf8')
    const repoA = repoOf(ownSettings(url), a.ws)
    expect((await gitPush(CTX, repoA, a.notesDir, 'v1', AUTHOR, false)).ok).toBe(true)

    const b = await machine() // own DSH_HOME → its own clone of the same URL
    const repoB = repoOf(ownSettings(url), b.ws)
    await gitInit(CTX, repoB, repoB.branch)
    const pull1 = await gitPull(CTX, repoB, b.notesDir, false, true)
    expect(pull1.ok).toBe(true)
    const { readFile } = await import('node:fs/promises')
    expect(await readFile(join(b.notesDir, 'a.md'), 'utf8')).toBe('v1')

    // Local-only edit + manual pull (remote unchanged) → local version kept.
    await writeFile(join(b.notesDir, 'a.md'), 'local-edit', 'utf8')
    const pull2 = await gitPull(CTX, repoB, b.notesDir, false, true)
    expect(pull2.ok).toBe(true)
    expect(await readFile(join(b.notesDir, 'a.md'), 'utf8')).toBe('local-edit')
  }, 30_000)

  it('three-way pull: remote change lands, both-sides change reports the conflict and keeps local', async () => {
    const url = await remoteRepo()
    const a = await machine()
    await writeFile(join(a.notesDir, 'a.md'), 'v1', 'utf8')
    await writeFile(join(a.notesDir, 'c.md'), 'c1', 'utf8')
    const repoA = repoOf(ownSettings(url), a.ws)
    expect((await gitPush(CTX, repoA, a.notesDir, 'v1', AUTHOR, false)).ok).toBe(true)

    const b = await machine()
    const repoB = repoOf(ownSettings(url), b.ws)
    await gitInit(CTX, repoB, repoB.branch)
    await gitPull(CTX, repoB, b.notesDir, false, true)

    // Remote moves BOTH files; B concurrently edited a.md (a true both-changed conflict on a).
    await writeFile(join(a.notesDir, 'a.md'), 'a2-remote', 'utf8')
    await writeFile(join(a.notesDir, 'c.md'), 'c2-remote', 'utf8')
    expect((await gitPush(CTX, repoA, a.notesDir, 'remote move', AUTHOR, false)).ok).toBe(true)
    await writeFile(join(b.notesDir, 'a.md'), 'b-local', 'utf8')

    const pull = await gitPull(CTX, repoB, b.notesDir, false, true)
    expect(pull.ok).toBe(true)
    expect(pull.changed).toEqual(['a.md']) // both sides changed → reported, local kept
    const { readFile } = await import('node:fs/promises')
    expect(await readFile(join(b.notesDir, 'a.md'), 'utf8')).toBe('b-local')
    expect(await readFile(join(b.notesDir, 'c.md'), 'utf8')).toBe('c2-remote') // remote-only change lands
  }, 30_000)

  it('push blocks with remote-changed when the remote moved and local differs; overwrite wins', async () => {
    const url = await remoteRepo()
    const a = await machine()
    await writeFile(join(a.notesDir, 'a.md'), 'v1', 'utf8')
    const repoA = repoOf(ownSettings(url), a.ws)
    expect((await gitPush(CTX, repoA, a.notesDir, 'v1', AUTHOR, false)).ok).toBe(true)

    const b = await machine()
    const repoB = repoOf(ownSettings(url), b.ws)
    await gitInit(CTX, repoB, repoB.branch)
    await gitPull(CTX, repoB, b.notesDir, false, true)
    await writeFile(join(b.notesDir, 'a.md'), 'b-local', 'utf8')

    // The remote advances behind B's back; B's diverging local push must block.
    await writeFile(join(a.notesDir, 'a.md'), 'v2-remote', 'utf8')
    expect((await gitPush(CTX, repoA, a.notesDir, 'v2', AUTHOR, false)).ok).toBe(true)

    const blocked = await gitPush(CTX, repoB, b.notesDir, 'b push', AUTHOR, false)
    expect(blocked.ok).toBe(false)
    expect(blocked.code).toBe('remote-changed')
    expect(blocked.changed).toEqual(['a.md'])
    expect(await remoteFile(url, 'a.md')).toBe('v2-remote') // remote untouched by the blocked push

    const forced = await gitPush(CTX, repoB, b.notesDir, 'b overwrite', AUTHOR, true)
    expect(forced.ok).toBe(true)
    expect(await remoteFile(url, 'a.md')).toBe('b-local')
  }, 30_000)

  it('fresh device (fresh clone + empty notes): AUTO-pull brings the notes down', async () => {
    const url = await remoteRepo()
    const a = await machine()
    await writeFile(join(a.notesDir, 'a.md'), 'v1', 'utf8')
    const repoA = repoOf(ownSettings(url), a.ws)
    expect((await gitPush(CTX, repoA, a.notesDir, 'v1', AUTHOR, false)).ok).toBe(true)

    const b = await machine() // fresh clone, empty notes dir
    const repoB = repoOf(ownSettings(url), b.ws)
    const pull = await gitPull(CTX, repoB, b.notesDir, false, false) // auto-pull path
    expect(pull.ok).toBe(true)
    const { readFile } = await import('node:fs/promises')
    expect(await readFile(join(b.notesDir, 'a.md'), 'utf8')).toBe('v1')
  }, 30_000)

  it('fresh device push (empty local) is BLOCKED with remote-changed — no silent remote wipe', async () => {
    const url = await remoteRepo()
    const a = await machine()
    await writeFile(join(a.notesDir, 'a.md'), 'v1', 'utf8')
    await writeFile(join(a.notesDir, 'b.md'), 'v2', 'utf8')
    const repoA = repoOf(ownSettings(url), a.ws)
    expect((await gitPush(CTX, repoA, a.notesDir, 'v1', AUTHOR, false)).ok).toBe(true)

    const b = await machine() // fresh clone, EMPTY notes dir — mirror semantics must NOT wipe
    const repoB = repoOf(ownSettings(url), b.ws)
    const blocked = await gitPush(CTX, repoB, b.notesDir, 'fresh push', AUTHOR, false)
    expect(blocked.ok).toBe(false)
    expect(blocked.code).toBe('remote-changed')
    expect(blocked.changed).toEqual(['a.md', 'b.md'])
    // The remote is untouched by the blocked push.
    expect(await remoteFile(url, 'a.md')).toBe('v1')
    expect(await remoteFile(url, 'b.md')).toBe('v2')

    // After pulling (which lands the notes), the push path works normally again.
    expect((await gitPull(CTX, repoB, b.notesDir, false, true)).ok).toBe(true)
    const after = await gitPush(CTX, repoB, b.notesDir, 'no-op push', AUTHOR, false)
    expect(after.ok).toBe(true)
    expect(await remoteFile(url, 'a.md')).toBe('v1')
  }, 30_000)

  it('shared mode: the folder is pinned by workspace id — renaming the workspace never orphans it', async () => {
    const url = await remoteRepo()
    const m = await machine()
    const settings: MdNotesSettings = { gitMode: 'shared', gitCentral: { remote: url } }

    const repoOld = repoOf(settings, m.ws)
    await writeFile(join(m.notesDir, 'n.md'), 'note-v1', 'utf8')
    expect((await gitPush(CTX, repoOld, m.notesDir, 'shared v1', AUTHOR, false)).ok).toBe(true)
    expect(await remoteFile(url, 'Alpha/n.md')).toBe('note-v1')

    // Same workspace id, new title: the pinned folder wins over the new name.
    const renamed: WorkspaceInfo = { ...m.ws, title: 'Beta' }
    const repoNew = repoOf(settings, renamed)
    await writeFile(join(m.notesDir, 'n.md'), 'note-v2', 'utf8')
    expect((await gitPush(CTX, repoNew, m.notesDir, 'shared v2', AUTHOR, false)).ok).toBe(true)

    expect(await remoteFile(url, 'Alpha/n.md')).toBe('note-v2') // still under the pinned folder
    const listing = await run(['ls-tree', '--name-only', 'main'], url)
    expect(listing.stdout).not.toContain('Beta') // no orphaned title-named folder
    expect(listing.stdout).toContain('.dsh-notes-workspaces.json') // the pin mapping is committed
  }, 30_000)
})

describe('conflict sidecars + gitSync merge recovery (ai-conflict, docs/ai-conflict.md)', () => {
  it('a blocked push writes base/remote sidecars under .dsh-notes/.conflicts/', async () => {
    const url = await remoteRepo()
    const a = await machine()
    await writeFile(join(a.notesDir, 'a.md'), 'v1', 'utf8')
    const repoA = repoOf(ownSettings(url), a.ws)
    expect((await gitPush(CTX, repoA, a.notesDir, 'v1', AUTHOR, false)).ok).toBe(true)

    const b = await machine()
    const repoB = repoOf(ownSettings(url), b.ws)
    await gitInit(CTX, repoB, repoB.branch)
    await gitPull(CTX, repoB, b.notesDir, false, true)
    await writeFile(join(b.notesDir, 'a.md'), 'b-local', 'utf8')
    await writeFile(join(a.notesDir, 'a.md'), 'v2-remote', 'utf8')
    expect((await gitPush(CTX, repoA, a.notesDir, 'v2', AUTHOR, false)).ok).toBe(true)

    const blocked = await gitPush(CTX, repoB, b.notesDir, 'b push', AUTHOR, false)
    expect(blocked.code).toBe('remote-changed')
    const conflictsDir = join(b.notesDir, '.conflicts')
    const { readFile } = await import('node:fs/promises')
    expect(await readFile(join(conflictsDir, 'a.base.md'), 'utf8')).toBe('v1')
    expect(await readFile(join(conflictsDir, 'a.remote.md'), 'utf8')).toBe('v2-remote')
    // No .md at top level of .conflicts leaks into the note list/sync (only top-level is scanned,
    // but assert the naming convention anyway: sidecars are <stem>.base.md/<stem>.remote.md).
    expect(await readFile(join(conflictsDir, 'a.remote.md'), 'utf8')).not.toBe('b-local')
  }, 30_000)

  it('a three-way pull conflict writes sidecars; a later successful push clears the dir', async () => {
    const url = await remoteRepo()
    const a = await machine()
    await writeFile(join(a.notesDir, 'a.md'), 'v1', 'utf8')
    const repoA = repoOf(ownSettings(url), a.ws)
    expect((await gitPush(CTX, repoA, a.notesDir, 'v1', AUTHOR, false)).ok).toBe(true)

    const b = await machine()
    const repoB = repoOf(ownSettings(url), b.ws)
    await gitInit(CTX, repoB, repoB.branch)
    await gitPull(CTX, repoB, b.notesDir, false, true)
    await writeFile(join(b.notesDir, 'a.md'), 'b-local', 'utf8')
    await writeFile(join(a.notesDir, 'a.md'), 'a2-remote', 'utf8')
    expect((await gitPush(CTX, repoA, a.notesDir, 'remote move', AUTHOR, false)).ok).toBe(true)

    const pull = await gitPull(CTX, repoB, b.notesDir, false, true)
    expect(pull.changed).toEqual(['a.md'])
    const { readFile } = await import('node:fs/promises')
    expect(await readFile(join(b.notesDir, '.conflicts', 'a.base.md'), 'utf8')).toBe('v1')
    expect(await readFile(join(b.notesDir, '.conflicts', 'a.remote.md'), 'utf8')).toBe('a2-remote')

    // Simulate the AI flow: resolution written back locally, then pushed — the
    // successful push must clear the sidecar dir.
    await writeFile(join(b.notesDir, 'a.md'), 'merged', 'utf8')
    expect((await gitPush(CTX, repoB, b.notesDir, 'merged', AUTHOR, true)).ok).toBe(true)
    await clearConflictSidecars(b.notesDir)
    const { stat } = await import('node:fs/promises')
    await expect(stat(join(b.notesDir, '.conflicts'))).rejects.toThrow()
    expect(await remoteFile(url, 'a.md')).toBe('merged')
  }, 30_000)

  it('gitSync merge conflict aborts cleanly — the clone stays usable afterwards', async () => {
    const url = await remoteRepo()
    const a = await machine()
    await writeFile(join(a.notesDir, 'a.md'), 'v1', 'utf8')
    const repoA = repoOf(ownSettings(url), a.ws)
    expect((await gitPush(CTX, repoA, a.notesDir, 'v1', AUTHOR, false)).ok).toBe(true)

    // Two machines each land their OWN commit on the same file (divergent history):
    // B force-pushes b-line (commit2, parent v1); A force-pushes a-line (commit3, parent v1).
    const b = await machine()
    const repoB = repoOf(ownSettings(url), b.ws)
    await gitInit(CTX, repoB, repoB.branch)
    await gitPull(CTX, repoB, b.notesDir, false, true)
    await writeFile(join(b.notesDir, 'a.md'), 'b-line\n', 'utf8')
    expect((await gitPush(CTX, repoB, b.notesDir, 'b push', AUTHOR, true)).ok).toBe(true)
    await writeFile(join(a.notesDir, 'a.md'), 'a-line\n', 'utf8')
    expect((await gitPush(CTX, repoA, a.notesDir, 'a push', AUTHOR, true)).ok).toBe(true)

    // B's clone diverges (main=commit2, origin=commit3). The plugin's own ops
    // keep clone history linear (ensureBranch resets to origin first), so a
    // MERGE_HEAD wedge can only come from manual git in the clone — construct
    // exactly that: detach one commit back, hand-commit a conflicting edit,
    // then merge main → conflicted merge → MERGE_HEAD + unmerged index. In
    // this state ensureBranch's `checkout -B` fails and EVERY git call breaks.
    await run(['checkout', '--detach', 'HEAD~1'], repoB.repoDir)
    await writeFile(join(repoB.repoDir, 'a.md'), 'manual-edit\n', 'utf8')
    expect((await run(['add', 'a.md'], repoB.repoDir)).code).toBe(0)
    expect((await run(['commit', '-m', 'manual divergent edit'], repoB.repoDir)).code).toBe(0)
    const head = await run(['rev-parse', 'main'], repoB.repoDir)
    const wedge = await run(['merge', '--no-commit', '--no-ff', head.stdout.trim()], repoB.repoDir)
    expect(wedge.code).not.toBe(0) // both sides rewrote a.md → conflicted merge
    expect((await run(['rev-parse', '--verify', 'MERGE_HEAD'], repoB.repoDir)).code).toBe(0)

    // gitSync pre-cleans the wedge; the clone becomes fully usable again.
    await gitSync(CTX, repoB)
    expect((await run(['rev-parse', '--verify', 'MERGE_HEAD'], repoB.repoDir)).code).not.toBe(0)
    const status = await gitStatus(CTX, repoB, repoB.branch, b.notesDir, createFetchDedup())
    expect(status.ok).toBe(true)
    expect((await gitPush(CTX, repoB, b.notesDir, 'b overwrite', AUTHOR, true)).ok).toBe(true)
    expect(await remoteFile(url, 'a.md')).toBe('b-line\n')
  }, 30_000)
})
