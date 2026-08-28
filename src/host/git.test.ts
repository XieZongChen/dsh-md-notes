import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  changedNotes, deleteMissingNotes, remoteOnlyNotes, repoTargetDir, resolveNotesDir,
  resolveSharedRepo, resolveWorkspaceRepo, syncNotes,
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
