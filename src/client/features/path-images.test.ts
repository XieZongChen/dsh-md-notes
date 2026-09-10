/**
 * Tests for the note preview's local-image rewriting (`createNotePathImages`):
 * destination → same-origin `/api/file` URL over the note's own directory,
 * with the chat vocabulary's guards (protocol, protocol-relative, schemes).
 * @module dsh-md-notes/client/path-images.test
 */

import { describe, expect, it } from 'vitest'
import { createNotePathImages } from './path-images.ts'

const DIR = '/base/ws-a/.dsh-notes'
const resolve = createNotePathImages('https:', 'https://dsh.example', DIR).resolve

describe('createNotePathImages', () => {
  it('resolves a bare file name against the note directory', () => {
    expect(resolve('shot.png')).toBe('https://dsh.example/api/file?path=' + encodeURIComponent('/base/ws-a/.dsh-notes/shot.png'))
  })

  it('climbs .. into the workspace and normalizes dot segments', () => {
    expect(resolve('../assets/logo v2.png'))
      .toBe('https://dsh.example/api/file?path=' + encodeURIComponent('/base/ws-a/assets/logo v2.png'))
    expect(resolve('./sub/../a.png'))
      .toBe('https://dsh.example/api/file?path=' + encodeURIComponent('/base/ws-a/.dsh-notes/a.png'))
  })

  it('uses an authored absolute path as written', () => {
    expect(resolve('/tmp/pic.png')).toBe('https://dsh.example/api/file?path=' + encodeURIComponent('/tmp/pic.png'))
  })

  it('normalizes Windows separators on the notes dir (drive prefix kept)', () => {
    const windows = createNotePathImages('https:', 'https://x', 'C:\\ws\\.dsh-notes').resolve
    expect(windows('a.png')).toBe('https://x/api/file?path=' + encodeURIComponent('C:/ws/.dsh-notes/a.png'))
  })

  it('keeps CJK and spaces through percent-encoding', () => {
    expect(resolve('图 片.png')).toBe('https://dsh.example/api/file?path=' + encodeURIComponent('/base/ws-a/.dsh-notes/图 片.png'))
  })

  it('declines protocol-relative, scheme-carrying, and empty destinations', () => {
    expect(resolve('//cdn.example/a.png')).toBeUndefined()
    expect(resolve('data:image/png;base64,xxxx')).toBeUndefined()
    expect(resolve('C:/x/y.png')).toBeUndefined()
    expect(resolve('')).toBeUndefined()
  })

  it('declines everything on non-HTTP transports (Electron file://)', () => {
    expect(createNotePathImages('file:', 'file://x', DIR).resolve('a.png')).toBeUndefined()
  })
})
