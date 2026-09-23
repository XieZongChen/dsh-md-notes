/**
 * Pure-logic tests for the pasted-image helpers (TODO §3.6). The DOM-facing
 * wiring lives in NotesManager / useNotesEditor; everything here runs in the
 * Node environment (no jsdom) because the module takes structural inputs.
 * @module dsh-md-notes/client/assets.test
 */

import { describe, expect, it } from 'vitest'
import {
  assetErrorKey, bytesToBase64, extForMime, imageFilesFrom, insertImageRefs, readImageBase64,
  type ImageEntry,
} from './assets.ts'

/** A fake clipboard entry over an in-memory Blob. */
function entry(type: string, kind = 'file'): ImageEntry {
  const file = new File([new Uint8Array([1, 2, 3])], 'x', { type })
  return { kind, type, getAsFile: () => file }
}

describe('extForMime', () => {
  it('maps the whitelisted image types', () => {
    expect(extForMime('image/png')).toBe('png')
    expect(extForMime('IMAGE/JPEG')).toBe('jpg')
    expect(extForMime(' image/gif ')).toBe('gif')
    expect(extForMime('image/webp')).toBe('webp')
    expect(extForMime('image/bmp')).toBe('bmp')
    expect(extForMime('image/avif')).toBe('avif')
  })

  it('declines non-image and unsupported image types (svg is host-refused too)', () => {
    expect(extForMime('text/plain')).toBeUndefined()
    expect(extForMime('image/svg+xml')).toBeUndefined()
    expect(extForMime('')).toBeUndefined()
  })
})

describe('imageFilesFrom', () => {
  it('keeps supported image files in payload order', () => {
    const files = imageFilesFrom([entry('image/png'), entry('image/jpeg')])
    expect(files).toHaveLength(2)
  })

  it('drops text entries and unsupported types', () => {
    expect(imageFilesFrom([entry('text/plain', 'string'), entry('image/svg+xml')])).toHaveLength(0)
  })

  it('drops an item whose file cannot be materialized', () => {
    expect(imageFilesFrom([{ type: 'image/png', getAsFile: () => null }])).toHaveLength(0)
  })
})

describe('bytesToBase64', () => {
  it('encodes the standard alphabet (round-trips through atob)', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(bytesToBase64(bytes)).toBe('iVBORw0KGgo=')
    expect(atob(bytesToBase64(bytes))).toBe(String.fromCharCode(...bytes))
  })

  it('handles a payload larger than the fromCharCode argument limit', () => {
    const bytes = new Uint8Array(200_000).fill(7)
    const encoded = bytesToBase64(bytes)
    expect(encoded.length).toBe(Math.ceil(bytes.length / 3) * 4)
    expect(encoded).not.toContain('undefined')
  })
})

describe('readImageBase64', () => {
  it('reads a Blob through arrayBuffer', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])])
    expect(await readImageBase64(blob)).toBe(bytesToBase64(new Uint8Array([1, 2, 3])))
  })
})

describe('insertImageRefs', () => {
  it('inserts at the caret in an empty note', () => {
    expect(insertImageRefs('', 0, 0, ['assets/a.png'])).toEqual({ text: '![](assets/a.png)', caret: 17 })
  })

  it('adds a blank line before the block when the caret is mid-line', () => {
    const res = insertImageRefs('hello', 5, 5, ['assets/a.png'])
    expect(res.text).toBe('hello\n\n![](assets/a.png)')
  })

  it('does not double the newline when the caret already starts a line', () => {
    const res = insertImageRefs('hello\n', 6, 6, ['assets/a.png'])
    expect(res.text).toBe('hello\n![](assets/a.png)')
  })

  it('replaces the selected text', () => {
    const res = insertImageRefs('aXXXb', 1, 4, ['assets/a.png'])
    expect(res.text).toBe('a\n\n![](assets/a.png)\nb')
  })

  it('keeps the following text on its own line', () => {
    const res = insertImageRefs('ab', 0, 0, ['assets/a.png'])
    expect(res.text).toBe('![](assets/a.png)\nab')
  })

  it('stacks several references on consecutive lines and lands the caret after them', () => {
    const res = insertImageRefs('', 0, 0, ['assets/a.png', 'assets/b.jpg'])
    expect(res.text).toBe('![](assets/a.png)\n![](assets/b.jpg)')
    expect(res.caret).toBe(res.text.length)
  })

  it('is a no-op for an empty path list', () => {
    expect(insertImageRefs('abc', 1, 1, [])).toEqual({ text: 'abc', caret: 1 })
  })
})

describe('assetErrorKey', () => {
  it('maps refusals to their localized message', () => {
    expect(assetErrorKey('asset-too-large')).toBe('manager.imageTooLarge')
    expect(assetErrorKey('asset-type')).toBe('manager.imageType')
    expect(assetErrorKey('asset-empty')).toBe('manager.imageType')
    expect(assetErrorKey('asset-write')).toBe('manager.imageFailed')
    expect(assetErrorKey('no-workspace')).toBe('manager.imageFailed')
  })
})
