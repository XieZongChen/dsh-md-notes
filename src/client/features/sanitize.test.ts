import { describe, expect, it } from 'vitest'
import { fileNameKey, sanitizeFileName } from './sanitize.ts'

describe('sanitizeFileName (host sanitizeName mirror)', () => {
  it('blocks path traversal (no separators in the result)', () => {
    const name = sanitizeFileName('../../etc/passwd.md')
    expect(name).not.toContain('/')
    expect(name).not.toContain('\\')
  })

  it('is idempotent on a valid .md name', () => {
    expect(sanitizeFileName('foo.md')).toBe('foo.md')
  })

  it('falls back to note.md for a blank name', () => {
    expect(sanitizeFileName('')).toBe('note.md')
    expect(sanitizeFileName('   ')).toBe('note.md')
  })

  it('replaces spaces with dashes', () => {
    expect(sanitizeFileName('my note')).toBe('my-note.md')
  })

  it('replaces special characters with dashes and collapses runs', () => {
    expect(sanitizeFileName('a/b:c?*')).toBe('a-b-c.md')
    expect(sanitizeFileName('a  b')).toBe('a-b.md')
  })

  it('trims leading/trailing dashes', () => {
    expect(sanitizeFileName('--a--')).toBe('a.md')
  })
})

describe('fileNameKey', () => {
  it('strips .md and lowercases', () => {
    expect(fileNameKey('Foo.md')).toBe('foo')
  })

  it('matches names that differ only by case or .md suffix', () => {
    expect(fileNameKey('Foo.md')).toBe(fileNameKey('foo'))
    expect(fileNameKey('my-note.md')).toBe(fileNameKey('My Note'))
  })
})
