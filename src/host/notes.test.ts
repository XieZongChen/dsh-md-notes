import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendConversation, appendNote, ASSET_MAX_BYTES, createNote, deleteNote, listNotes, noteExists,
  readNote, sanitizeName, saveAsset, searchNotes, titleOf, writeNote,
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

  it('refuses an empty answer with a coded error (client localizes it)', async () => {
    const base = await tempDir()
    const res = await appendConversation(join(base, '.dsh-notes'), 'log.md', 'q', '', '', undefined)
    if (res.ok) throw new Error('expected the coded failure branch')
    expect(res.code).toBe('empty-answer')
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

describe('saveAsset (pasted images, TODO §3.6)', () => {
  /** Signature-only payloads: `saveAsset` validates the head, not the body. */
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])
  const GIF = Buffer.from('GIF89a....', 'latin1')
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
  const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'latin1')])

  it('stores a png under assets/ and returns the notes-dir-relative reference', async () => {
    const dir = await tempDir()
    const res = await saveAsset(dir, PNG.toString('base64'), 'png')
    if (!res.ok) throw new Error(`expected success, got ${res.code}`)
    expect(res.path).toMatch(/^assets\/img-[a-z0-9]+-[0-9a-f]{6}\.png$/)
    expect([...await readFile(join(dir, res.path))]).toEqual([...PNG])
  })

  it('generates the basename itself — the request cannot influence the path', async () => {
    const dir = await tempDir()
    // A traversal-shaped ext is not in the signature table, so it is refused
    // outright rather than reaching any join().
    const traversal = await saveAsset(dir, PNG.toString('base64'), '../../evil')
    if (traversal.ok) throw new Error('expected refusal')
    expect(traversal.code).toBe('asset-type')
    // The accepted call's name is fully generated; nothing from the request.
    const ok = await saveAsset(dir, PNG.toString('base64'), 'PNG')
    if (!ok.ok) throw new Error('expected success')
    expect(ok.path).not.toContain('..')
  })

  it('accepts the other whitelisted signatures (gif / jpeg / webp)', async () => {
    const dir = await tempDir()
    for (const [ext, bytes] of [['gif', GIF], ['jpg', JPEG], ['jpeg', JPEG], ['webp', WEBP]] as const) {
      const res = await saveAsset(dir, bytes.toString('base64'), ext)
      if (!res.ok) throw new Error(`expected ${ext} to be accepted, got ${res.code}`)
      expect(res.path.endsWith(`.${ext}`)).toBe(true)
    }
  })

  it('tolerates a data-URL prefix from the clipboard', async () => {
    const dir = await tempDir()
    const res = await saveAsset(dir, `data:image/png;base64,${PNG.toString('base64')}`, 'png')
    expect(res.ok).toBe(true)
  })

  it('refuses bytes that do not match the claimed format', async () => {
    const dir = await tempDir()
    const res = await saveAsset(dir, Buffer.from('<script>alert(1)</script>').toString('base64'), 'png')
    if (res.ok) throw new Error('expected refusal')
    expect(res.code).toBe('asset-type')
  })

  it('refuses an empty or non-base64 payload', async () => {
    const dir = await tempDir()
    for (const data of ['', '   ', 'not base64 !!!']) {
      const res = await saveAsset(dir, data, 'png')
      if (res.ok) throw new Error(`expected refusal for ${JSON.stringify(data)}`)
      expect(res.code).toBe('asset-empty')
    }
  })

  it('refuses a payload past the byte ceiling', async () => {
    const dir = await tempDir()
    const huge = Buffer.concat([PNG, Buffer.alloc(ASSET_MAX_BYTES + 1)])
    const res = await saveAsset(dir, huge.toString('base64'), 'png')
    if (res.ok) throw new Error('expected refusal')
    expect(res.code).toBe('asset-too-large')
  })
})

describe('noteExists / appendNote (agent write path, docs/memory.md)', () => {
  it('noteExists is false for a missing note and true after a write', async () => {
    const dir = await tempDir()
    expect(await noteExists(dir, 'deploy.md')).toBe(false)
    await writeNote(dir, 'deploy.md', '# Deploy')
    expect(await noteExists(dir, 'deploy.md')).toBe(true)
    expect(await noteExists(dir, 'deploy')).toBe(true) // suffix optional, like every note API
  })

  it('creates a missing note under its title heading', async () => {
    const dir = await tempDir()
    const res = await appendNote(dir, 'deploy.md', 'Deploy', 'Token rotation: every Monday.')
    expect(res).toEqual({ ok: true, name: 'deploy.md', created: true })
    expect((await readNote(dir, 'deploy.md')).content).toBe('# Deploy\n\nToken rotation: every Monday.\n')
  })

  it('appends to an existing note without truncating it', async () => {
    const dir = await tempDir()
    await writeNote(dir, 'deploy.md', '# Deploy\n\nfirst fact')
    const res = await appendNote(dir, 'deploy.md', 'ignored', 'second fact')
    expect(res.created).toBe(false)
    const content = (await readNote(dir, 'deploy.md')).content
    expect(content).toBe('# Deploy\n\nfirst fact\n\nsecond fact\n')
  })

  it('sanitizes the name (path traversal stays inside the notes dir)', async () => {
    const dir = await tempDir()
    const res = await appendNote(dir, '../../escape.md', 'Escape', 'x')
    expect(res.name).not.toContain('/')
    expect((await listNotes(dir)).notes.some((n) => n.name === res.name)).toBe(true)
  })

  it('refreshes the meta title from the appended content', async () => {
    const dir = await tempDir()
    await appendNote(dir, 'x.md', 'First Title', 'body')
    const listed = await listNotes(dir)
    expect(listed.notes.find((n) => n.name === 'x.md')?.title).toBe('First Title')
  })
})

describe('listNotes meta rebuild (fresh clone, no meta.json)', () => {
  it('rebuilds titles from H1 headings and updatedAt from mtimes, then persists meta.json', async () => {
    const dir = await tempDir()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'a.md'), '# 标题甲\n\n正文', 'utf8')
    await writeFile(join(dir, 'b.md'), '没有一级标题的笔记', 'utf8')

    const first = await listNotes(dir)
    expect(first.ok).toBe(true)
    const titles = Object.fromEntries(first.notes.map((n) => [n.name, n.title]))
    expect(titles['a.md']).toBe('标题甲') // heading wins
    expect(titles['b.md']).toBe('b') // filename fallback
    expect(first.notes.every((n) => n.updatedAt > 0)).toBe(true) // mtime backfill

    // The rebuilt cache is persisted so the second list does not re-read files.
    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as Record<string, { title: string }>
    expect(meta['a.md']).toEqual({ title: '标题甲', updatedAt: expect.any(Number) })

    const second = await listNotes(dir)
    expect(second.notes).toEqual(first.notes)
  })
})


describe('searchNotes', () => {
  const ws = (id: string, dir: string) => ({ workspaceId: id, workspaceName: `ws-${id}`, dir })
  /** Unwrap the single element tests assert exists (noUncheckedIndexedAccess). */
  const one = <T,>(arr: readonly T[]): T => {
    const first = arr[0]
    if (first === undefined) throw new Error('expected exactly one element')
    return first
  }

  it('returns nothing for empty / whitespace-only queries (no tokens)', async () => {
    const dir = await tempDir()
    await createNote(dir, 'Alpha')
    for (const query of ['', '   ', '\t\n']) {
      const res = await searchNotes([ws('w1', dir)], query)
      expect(res.ok).toBe(true)
      expect(res.results).toEqual([])
      expect(res.truncated).toBe(false)
    }
  })

  it('matches title and body case-insensitively, with line numbers and ranges', async () => {
    const dir = await tempDir()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'deploy.md'), '# Deploy Guide\n\nrun git push\nthen PUSH again\n', 'utf8')
    const res = await searchNotes([ws('w1', dir)], 'push')
    expect(res.results).toHaveLength(1)
    const note = one(res.results)
    expect(note.name).toBe('deploy.md')
    expect(note.title).toBe('Deploy Guide')
    expect(note.titleMatch).toBe(false) // body-only hit
    expect(note.totalHits).toBe(2)
    expect(note.hits.map((h) => h.line)).toEqual([3, 4])
    expect(one(note.hits).text).toBe('run git push')
    expect(one(one(note.hits).ranges)).toEqual({ start: 8, end: 12 })
    expect(one(one(note.hits.slice(1)).ranges)).toEqual({ start: 5, end: 9 }) // case-insensitive
  })

  it('AND semantics: every token must appear in title+body', async () => {
    const dir = await tempDir()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'a.md'), '# Git Flow\ngit push git pull\n', 'utf8')
    const hit = await searchNotes([ws('w1', dir)], 'git push')
    expect(hit.results).toHaveLength(1)
    const miss = await searchNotes([ws('w1', dir)], 'git rebase')
    expect(miss.results).toHaveLength(0)
  })

  it('a title-only match flags titleMatch and locates the heading line', async () => {
    const dir = await tempDir()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'note.md'), '# Kubernetes 运维\n完全无关的正文\n', 'utf8')
    const res = await searchNotes([ws('w1', dir)], 'kubernetes')
    const note = one(res.results)
    expect(note.titleMatch).toBe(true)
    // The H1 heading is content line 1 — the one locatable line for a
    // title-only hit (clicking it lands at the top of the note).
    expect(note.hits).toEqual([
      { line: 1, text: '# Kubernetes 运维', ranges: [{ start: 2, end: 12 }] },
    ])
  })

  it('normalizes CRLF so line numbers match the client-side re-split', async () => {
    const dir = await tempDir()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'crlf.md'), '# T\r\n\r\nneedle here\r\n', 'utf8')
    const res = await searchNotes([ws('w1', dir)], 'needle')
    const hit = one(one(res.results).hits)
    expect(hit.line).toBe(3)
    expect(hit.text).toBe('needle here')
  })

  it('collects every occurrence on one line, sorted and non-overlapping', async () => {
    const dir = await tempDir()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'multi.md'), '# m\nfoo foo xfoo\n', 'utf8')
    const res = await searchNotes([ws('w1', dir)], 'foo')
    expect(one(one(res.results).hits).ranges).toEqual([
      { start: 0, end: 3 }, { start: 4, end: 7 }, { start: 9, end: 12 },
    ])
  })

  it('caps hits per note at 5 but keeps the uncapped totalHits', async () => {
    const dir = await tempDir()
    const { writeFile } = await import('node:fs/promises')
    const lines = ['# cap', ...Array.from({ length: 9 }, (_, i) => `hit number ${i}`), '']
    await writeFile(join(dir, 'cap.md'), lines.join('\n'), 'utf8')
    const res = await searchNotes([ws('w1', dir)], 'hit')
    const note = one(res.results)
    expect(note.hits).toHaveLength(5)
    expect(note.totalHits).toBe(9)
  })

  it('prefix-truncates long lines and drops ranges past the cut', async () => {
    const dir = await tempDir()
    const { writeFile } = await import('node:fs/promises')
    const long = `${'a'.repeat(200)}needle${'b'.repeat(50)}`
    await writeFile(join(dir, 'long.md'), `# l\n${long}\n`, 'utf8')
    const res = await searchNotes([ws('w1', dir)], 'needle')
    const hit = one(one(res.results).hits)
    expect(hit.text.length).toBeLessThanOrEqual(161) // 160 + ellipsis
    expect(hit.text.endsWith('…')).toBe(true)
    expect(hit.ranges).toEqual([]) // occurrence is past the visible cut
  })

  it('caps the response at 50 notes and flags truncated', async () => {
    const dir = await tempDir()
    const { writeFile } = await import('node:fs/promises')
    for (let i = 0; i < 52; i++) {
      await writeFile(join(dir, `n${i}.md`), `# note ${i}\nneedle\n`, 'utf8')
    }
    const res = await searchNotes([ws('w1', dir)], 'needle')
    expect(res.results).toHaveLength(50)
    expect(res.truncated).toBe(true)
    const exact = await searchNotes([ws('w1', dir)], 'note 51')
    expect(exact.truncated).toBe(false) // 52 notes scanned, 1 matches
  })

  it('scopes stay independent and a missing dir is skipped, not fatal', async () => {
    const a = await tempDir()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(a, 'one.md'), '# one\nneedle\n', 'utf8')
    const res = await searchNotes(
      [ws('a', a), ws('missing', join(a, 'nope'))],
      'needle',
    )
    expect(res.results).toHaveLength(1)
    expect(one(res.results).workspaceId).toBe('a')
    expect(one(res.results).workspaceName).toBe('ws-a')
  })

  it('ignores non-markdown files (meta.json never matches)', async () => {
    const dir = await tempDir()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'meta.json'), '{"x.md":{"title":"needle"}}', 'utf8')
    const res = await searchNotes([ws('w1', dir)], 'needle')
    expect(res.results).toHaveLength(0)
  })

  it('dedupes repeated tokens in the query', async () => {
    const dir = await tempDir()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'dup.md'), '# d\nneedle needle\n', 'utf8')
    const res = await searchNotes([ws('w1', dir)], 'needle needle')
    expect(one(one(res.results).hits).ranges).toHaveLength(2) // one pass, no double counting
  })
})

