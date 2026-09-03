import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  changedNotes, cloneDirFor, deleteMissingNotes, pushConflicts, remoteOnlyNotes, repoTargetDir,
  resolveNotesDir, resolveSharedFolder, resolveSharedRepo, resolveWorkspaceRepo, syncNotes,
  threeWaySync,
  type ResolvedRepo, type WorkspaceInfo,
} from './git.ts'
import type { MdNotesSettings } from './settings.ts'

const ws: WorkspaceInfo = { id: 'ws-1', path: '/tmp/ws', title: 'My 工作区' }

const tempDirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-git-'))
  tempDirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })))
  tempDirs.length = 0
})

describe('resolveWorkspaceRepo', () => {
  it('resolves a shared repo with a title-derived subdir and default branch', () => {
    const s: MdNotesSettings = { gitMode: 'shared', gitCentral: { remote: 'https://x' } }
    expect(resolveWorkspaceRepo(s, ws)).toMatchObject({
      kind: 'shared', subdir: 'My-工作区', branch: 'main', remote: 'https://x', workspaceId: 'ws-1',
    })
  })

  it('resolves an own repo from gitRepos[ws.id]', () => {
    const s: MdNotesSettings = { gitMode: 'own', gitRepos: { 'ws-1': { remote: 'https://own', branch: 'dev', subpath: 'notes' } } }
    expect(resolveWorkspaceRepo(s, ws)).toMatchObject({
      kind: 'own', subdir: 'notes', branch: 'dev', remote: 'https://own',
    })
  })

  it('returns undefined for off or a missing remote', () => {
    expect(resolveWorkspaceRepo({ gitMode: 'off' }, ws)).toBeUndefined()
    expect(resolveWorkspaceRepo({ gitMode: 'shared', gitCentral: {} }, ws)).toBeUndefined()
  })

  it('returns undefined in own mode when this workspace has no own repo', () => {
    expect(resolveWorkspaceRepo({ gitMode: 'own', gitRepos: {} }, ws)).toBeUndefined()
    expect(resolveWorkspaceRepo({ gitMode: 'own', gitRepos: { 'other-ws': { remote: 'https://x' } } }, ws)).toBeUndefined()
    expect(resolveWorkspaceRepo({ gitMode: 'own', gitRepos: { 'ws-1': {} } }, ws)).toBeUndefined()
  })
})

describe('resolveSharedRepo / resolveNotesDir / repoTargetDir', () => {
  it('resolveSharedRepo returns the whole-repo target in shared mode only', () => {
    const s: MdNotesSettings = { gitMode: 'shared', gitCentral: { remote: 'https://x', branch: 'main' } }
    expect(resolveSharedRepo(s)).toMatchObject({ kind: 'shared', subdir: '', branch: 'main', remote: 'https://x' })
    expect(resolveSharedRepo({ gitMode: 'own' })).toBeUndefined()
  })

  it('resolveNotesDir is always <ws>/.dsh-notes', () => {
    expect(resolveNotesDir({}, ws)).toBe('/tmp/ws/.dsh-notes')
  })

  it('repoTargetDir joins subdir segments (empty = repo root)', () => {
    const repo: ResolvedRepo = { kind: 'own', repoDir: '/r', subdir: 'a/b', branch: 'main', remote: 'x' }
    expect(repoTargetDir(repo)).toBe('/r/a/b')
    expect(repoTargetDir({ ...repo, subdir: '' })).toBe('/r')
  })
})

describe('syncNotes / changedNotes / remoteOnlyNotes / deleteMissingNotes', () => {
  it('syncNotes copies .md files and ignores others', async () => {
    const src = await tempDir()
    const dest = await tempDir()
    await writeFile(join(src, 'a.md'), 'A')
    await writeFile(join(src, 'b.txt'), 'B')
    expect(await syncNotes(src, dest, true)).toEqual({ copied: 1, skipped: 0 })
    expect(await readFile(join(dest, 'a.md'), 'utf8')).toBe('A')
    expect(existsSync(join(dest, 'b.txt'))).toBe(false)
  })

  it('syncNotes preserves a differing file when overwrite is false', async () => {
    const src = await tempDir()
    const dest = await tempDir()
    await writeFile(join(src, 'a.md'), 'new')
    await writeFile(join(dest, 'a.md'), 'old')
    expect(await syncNotes(src, dest, false)).toEqual({ copied: 0, skipped: 1 })
    expect(await readFile(join(dest, 'a.md'), 'utf8')).toBe('old')
  })

  it('changedNotes returns names differing on both sides', async () => {
    const remote = await tempDir()
    const local = await tempDir()
    await writeFile(join(remote, 'a.md'), 'r')
    await writeFile(join(local, 'a.md'), 'l')
    await writeFile(join(remote, 'b.md'), 'same')
    await writeFile(join(local, 'b.md'), 'same')
    await writeFile(join(remote, 'c.md'), 'r') // remote-only → not "changed"
    expect(await changedNotes(remote, local)).toEqual(['a.md'])
  })

  it('remoteOnlyNotes returns remote-only names', async () => {
    const remote = await tempDir()
    const local = await tempDir()
    await writeFile(join(remote, 'a.md'), 'x')
    await writeFile(join(remote, 'b.md'), 'x')
    await writeFile(join(local, 'b.md'), 'x')
    expect(await remoteOnlyNotes(remote, local)).toEqual(['a.md'])
  })

  it('deleteMissingNotes removes remote-only notes', async () => {
    const remote = await tempDir()
    const local = await tempDir()
    await writeFile(join(remote, 'a.md'), 'x')
    await writeFile(join(remote, 'b.md'), 'x')
    await writeFile(join(local, 'b.md'), 'x')
    expect(await deleteMissingNotes(remote, local)).toEqual(['a.md'])
    expect(existsSync(join(remote, 'a.md'))).toBe(false)
    expect(existsSync(join(remote, 'b.md'))).toBe(true)
  })
})

describe('pushConflicts', () => {
  const map = (obj: Record<string, string>): Map<string, string> => new Map(Object.entries(obj))

  it('flags a note the remote changed since base while local still differs', () => {
    const conflicts = pushConflicts(map({ a: 'b0' }), map({ a: 'local' }), map({ a: 'remote' }))
    expect(conflicts).toEqual(['a'])
  })

  it('a plain local edit (remote at base) is NOT a conflict', () => {
    const conflicts = pushConflicts(map({ a: 'x' }), map({ a: 'local' }), map({ a: 'x' }))
    expect(conflicts).toEqual([])
  })

  it('local already matching the remote is not a conflict', () => {
    const conflicts = pushConflicts(map({ a: 'b0' }), map({ a: 'r1' }), map({ a: 'r1' }))
    expect(conflicts).toEqual([])
  })

  it('added on both sides with different content is a conflict', () => {
    const conflicts = pushConflicts(map({}), map({ a: 'l' }), map({ a: 'r' }))
    expect(conflicts).toEqual(['a'])
  })

  it('added locally only is not a conflict; deleted remotely while kept locally is', () => {
    const conflicts = pushConflicts(map({ gone: 'x', fresh: undefined as unknown as string }), map({ fresh: 'l', gone: 'x' }), map({ fresh: undefined as unknown as string }))
    expect(conflicts).toEqual(['gone'])
  })
})

describe('threeWaySync', () => {
  const map = (obj: Record<string, string>): Map<string, string> => new Map(Object.entries(obj))

  it('overwrites only remote-changed notes; keeps local edits; reports true conflicts', async () => {
    const src = await tempDir() // the repo target (remote side)
    const dest = await tempDir() // the workspace notes dir (local side)
    // a: remote changed, local at base → copied. b: both changed → conflict, keep local.
    // c: only local changed → untouched. d: already in sync → untouched.
    await writeFile(join(src, 'a.md'), 'remote-a', 'utf8')
    await writeFile(join(src, 'b.md'), 'remote-b', 'utf8')
    await writeFile(join(src, 'd.md'), 'same', 'utf8')
    await writeFile(join(dest, 'a.md'), 'base-a', 'utf8')
    await writeFile(join(dest, 'b.md'), 'local-b', 'utf8')
    await writeFile(join(dest, 'c.md'), 'local-c', 'utf8')
    await writeFile(join(dest, 'd.md'), 'same', 'utf8')

    const base = map({ 'a.md': 'base-a', 'b.md': 'base-b', 'd.md': 'same' })
    const local = map({ 'a.md': 'base-a', 'b.md': 'local-b', 'c.md': 'local-c', 'd.md': 'same' })
    const remote = map({ 'a.md': 'remote-a', 'b.md': 'remote-b', 'd.md': 'same' })

    const { copied, conflicts } = await threeWaySync(src, dest, base, local, remote)
    expect(copied).toBe(1)
    expect(conflicts).toEqual(['b.md'])
    expect(await readFile(join(dest, 'a.md'), 'utf8')).toBe('remote-a') // remote won
    expect(await readFile(join(dest, 'b.md'), 'utf8')).toBe('local-b') // conflict kept local
    expect(await readFile(join(dest, 'c.md'), 'utf8')).toBe('local-c') // local-only untouched
    expect(await readFile(join(dest, 'd.md'), 'utf8')).toBe('same')
  })

  it('a remote-new note is copied into an empty local side', async () => {
    const src = await tempDir()
    const dest = await tempDir()
    await writeFile(join(src, 'new.md'), 'fresh', 'utf8')
    const { copied, conflicts } = await threeWaySync(src, dest, map({}), map({}), map({ 'new.md': 'fresh' }))
    expect(copied).toBe(1)
    expect(conflicts).toEqual([])
    expect(await readFile(join(dest, 'new.md'), 'utf8')).toBe('fresh')
  })
})

describe('resolveSharedFolder', () => {
  const sharedRepo = (repoDir: string, workspaceId: string, subdir: string): ResolvedRepo => ({
    kind: 'shared', repoDir, subdir, branch: 'main', remote: 'https://central', workspaceId,
  })

  it('returns the pinned folder from the committed mapping (no write)', async () => {
    const repoDir = await tempDir()
    await writeFile(join(repoDir, '.dsh-notes-workspaces.json'), JSON.stringify({ 'ws-1': { folder: 'pinned' } }), 'utf8')
    const folder = await resolveSharedFolder(sharedRepo(repoDir, 'ws-1', 'title-dir'), false)
    expect(folder).toBe('pinned')
    // read-only: the mapping is unchanged (still exactly one entry)
    expect(JSON.parse(await readFile(join(repoDir, '.dsh-notes-workspaces.json'), 'utf8'))).toEqual({ 'ws-1': { folder: 'pinned' } })
  })

  it('falls back to the title subdir without writing when create=false', async () => {
    const repoDir = await tempDir()
    const folder = await resolveSharedFolder(sharedRepo(repoDir, 'ws-1', 'title-dir'), false)
    expect(folder).toBe('title-dir')
    expect(existsSync(join(repoDir, '.dsh-notes-workspaces.json'))).toBe(false)
  })

  it('pins the title subdir on first write when create=true', async () => {
    const repoDir = await tempDir()
    const folder = await resolveSharedFolder(sharedRepo(repoDir, 'ws-1', 'title-dir'), true)
    expect(folder).toBe('title-dir')
    expect(JSON.parse(await readFile(join(repoDir, '.dsh-notes-workspaces.json'), 'utf8')))
      .toEqual({ 'ws-1': { folder: 'title-dir' } })
  })

  it('own-mode repos return their configured subdir as-is', async () => {
    const repoDir = await tempDir()
    const own: ResolvedRepo = { kind: 'own', repoDir, subdir: 'my/sub', branch: 'main', remote: 'https://own' }
    expect(await resolveSharedFolder(own, true)).toBe('my/sub')
    expect(existsSync(join(repoDir, '.dsh-notes-workspaces.json'))).toBe(false)
  })
})

describe('cloneDirFor', () => {
  const originalHome = process.env.DSH_HOME
  afterEach(() => {
    if (originalHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = originalHome
  })

  it('lives under $DSH_HOME/md-notes-repos keyed by a stable 12-hex URL hash', async () => {
    const home = await tempDir()
    process.env.DSH_HOME = home
    const a = cloneDirFor('https://github.com/o/r.git')
    expect(a.startsWith(join(home, 'md-notes-repos'))).toBe(true)
    expect(a.split('/').pop()).toMatch(/^[0-9a-f]{12}$/u)
    // Same URL → same clone dir; different URL → a different one.
    expect(cloneDirFor('https://github.com/o/r.git')).toBe(a)
    expect(cloneDirFor('https://github.com/o/other.git')).not.toBe(a)
  })

  it('falls back to ~/.dsh when DSH_HOME is unset', () => {
    delete process.env.DSH_HOME
    expect(cloneDirFor('https://x/y.git')).toContain('md-notes-repos')
  })
})
