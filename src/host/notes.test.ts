import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendConversation, createNote, deleteNote, listNotes, readNote, sanitizeName, titleOf, writeNote,
} from './notes.ts'

const tempDirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-notes-'))
  tempDirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })))
  tempDirs.length = 0
})

describe('sanitizeName', () => {
  it('blocks path traversal (no separators in the result)', () => {
    const name = sanitizeName('../../etc/passwd.md')
    expect(name).not.toContain('/')
    expect(name).not.toContain('\\')
  })

  it('is idempotent on a valid .md name', () => {
    expect(sanitizeName('foo.md')).toBe('foo.md')
  })

  it('falls back to note.md for a blank name', () => {
    expect(sanitizeName('')).toBe('note.md')
    expect(sanitizeName('   ')).toBe('note.md')
  })

  it('replaces spaces with dashes', () => {
    expect(sanitizeName('my note')).toBe('my-note.md')
  })

  it('replaces special characters with dashes and collapses runs', () => {
    expect(sanitizeName('a/b:c?*')).toBe('a-b-c.md')
    expect(sanitizeName('a  b')).toBe('a-b.md')
    expect(sanitizeName('  x  ')).toBe('x.md')
  })

  it('trims leading/trailing dashes', () => {
    expect(sanitizeName('--a--')).toBe('a.md')
  })
})

describe('titleOf', () => {
  it('extracts the first H1 heading', () => {
    expect(titleOf('# Hello', 'fallback')).toBe('Hello')
  })

  it('falls back when there is no heading', () => {
    expect(titleOf('no heading here', 'fallback')).toBe('fallback')
    expect(titleOf('', 'fallback')).toBe('fallback')
  })
})

describe('notes file ops', () => {
  it('create / list / read / write / delete round-trip', async () => {
    const dir = await tempDir()
    const created = await createNote(dir, 'My Note')
    expect(created.ok).toBe(true)
    const name = created.name
    expect(name.endsWith('.md')).toBe(true)

    const listed = await listNotes(dir)
    expect(listed.notes.some((n) => n.name === name)).toBe(true)

    const read = await readNote(dir, name)
    expect(read.content).toContain('# My Note')

    const written = await writeNote(dir, name, '# Updated')
    expect(written.ok).toBe(true)
    expect((await readNote(dir, name)).content).toBe('# Updated')

    const removed = await deleteNote(dir, name)
    expect(removed.ok).toBe(true)
    expect((await listNotes(dir)).notes.some((n) => n.name === name)).toBe(false)
  })

  it('createNote honors an explicit file name independent of the title', async () => {
    const dir = await tempDir()
    const created = await createNote(dir, 'My Title', 'chosen-name')
    expect(created.name).toBe('chosen-name.md')
    // The `# heading` (display title) is the title, not the file basename.
    expect((await readNote(dir, created.name)).content).toContain('# My Title')
  })

  it('createNote derives the file name from the title when no name is given', async () => {
    const dir = await tempDir()
    const created = await createNote(dir, 'My Title')
    expect(created.name).toBe('My-Title.md')
  })

  it('createNote dedups a colliding name by appending -2, -3, …', async () => {
    const dir = await tempDir()
    const a = await createNote(dir, 'My Note')
    const b = await createNote(dir, 'My Note')
    const c = await createNote(dir, 'My Note')
    expect(a.name).toBe('My-Note.md')
    expect(b.name).toBe('My-Note-2.md')
    expect(c.name).toBe('My-Note-3.md')
  })

  it('createNote dedups an explicit colliding file name too', async () => {
    const dir = await tempDir()
    const a = await createNote(dir, 'First', 'shared-name')
    const b = await createNote(dir, 'Second', 'shared-name')
    expect(a.name).toBe('shared-name.md')
    expect(b.name).toBe('shared-name-2.md')
  })

  it('appendConversation appends a dated section', async () => {
    const dir = await tempDir()
    const created = await createNote(dir, 'Note')
    const res = await appendConversation(dir, created.name, 'Q?', 'A!', 'Sess', {
      user: 'U', assistant: 'A', empty: 'E',
    })
    expect(res.ok).toBe(true)
    const content = await readFile(join(dir, created.name), 'utf8')
    expect(content).toContain('## Sess --')
    expect(content).toContain('Q?')
    expect(content).toContain('A!')
  })

  it('appendConversation sanitizes the note name (path-traversal regression)', async () => {
    const dir = await tempDir()
    const res = await appendConversation(dir, '../../escape.md', 'Q?', 'A!')
    expect(res.ok).toBe(true)
    // The file is written inside `dir` under a sanitized basename, not escaped.
    const listed = await listNotes(dir)
    expect(listed.notes.some((n) => n.name === '..-..-escape.md')).toBe(true)
  })
})
