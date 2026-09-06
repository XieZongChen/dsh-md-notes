/**
 * Unit tests for the pure search client helpers: highlight segmentation and
 * the edit-mode locate math (docs/search.md §5–§6).
 * @module dsh-md-notes/client/NotesManager/search.test
 */

import { describe, expect, it } from 'vitest'
import { highlightSegments, locateOffsets, locateScrollTop } from './search.ts'

describe('highlightSegments', () => {
  it('splits a line into plain and marked slices by the ranges', () => {
    expect(highlightSegments('run git push', [{ start: 8, end: 12 }])).toEqual([
      { text: 'run git ', mark: false },
      { text: 'push', mark: true },
    ])
  })

  it('renders multiple marks and the tail', () => {
    expect(highlightSegments('foo foo xfoo', [
      { start: 0, end: 3 }, { start: 4, end: 7 }, { start: 9, end: 12 },
    ])).toEqual([
      { text: 'foo', mark: true },
      { text: ' ', mark: false },
      { text: 'foo', mark: true },
      { text: ' x', mark: false },
      { text: 'foo', mark: true },
    ])
  })

  it('clamps out-of-range and malformed ranges instead of slicing outside the text', () => {
    expect(highlightSegments('abc', [{ start: 2, end: 99 }])).toEqual([
      { text: 'ab', mark: false },
      { text: 'c', mark: true },
    ])
    expect(highlightSegments('abc', [{ start: 0, end: 0 }])).toEqual([
      { text: 'abc', mark: false },
    ])
  })

  it('an empty range list is one plain segment', () => {
    expect(highlightSegments('plain line', [])).toEqual([{ text: 'plain line', mark: false }])
  })
})

describe('locateOffsets', () => {
  const content = '# Title\n\nfirst line\nsecond needle line\n'

  it('maps a line + line-relative range to absolute offsets', () => {
    // Line 3 starts at 9 ('# Title' 7 + \n + empty + \n); line 4 at 9 + 10 + 1 = 20.
    expect(locateOffsets(content, { line: 4, start: 7, end: 13 })).toEqual({ start: 27, end: 33 })
  })

  it('a line without a range collapses to a caret at the line start', () => {
    expect(locateOffsets(content, { line: 3 })).toEqual({ start: 9, end: 9 })
  })

  it('normalizes CRLF before splitting so offsets match the DOM value', () => {
    expect(locateOffsets('# T\r\n\r\nneedle here\r\n', { line: 3, start: 0, end: 6 })).toEqual({ start: 5, end: 11 })
  })

  it('clamps an out-of-range line (note shrank) to the last line', () => {
    // Last real line is 5 (the trailing ''). A line-99 target clamps there.
    expect(locateOffsets(content, { line: 99 })).toEqual({ start: 39, end: 39 })
  })

  it('clamps a selection range into its line', () => {
    expect(locateOffsets(content, { line: 1, start: -5, end: 999 })).toEqual({ start: 0, end: 7 })
  })

  it('empty content locates to offset 0', () => {
    expect(locateOffsets('', { line: 1, start: 3, end: 5 })).toEqual({ start: 0, end: 0 })
  })

  it('an inverted range (end < start) normalizes to start', () => {
    expect(locateOffsets(content, { line: 3, start: 4, end: 2 })).toEqual({ start: 13, end: 13 })
  })
})

describe('locateScrollTop', () => {
  it('centers the hit line in the viewport', () => {
    // lineHeight 20.8, viewport 400, padding 14: line 10 → (9 × 20.8) + 14 − 200 + 10.4 = 11.6… round freely.
    const top = locateScrollTop(10, 20.8, 400, 14)
    expect(top).toBeGreaterThan(0)
    // Without padding and with the line height filling the viewport, line 1 stays at 0.
    expect(locateScrollTop(1, 20, 100, 0)).toBe(0)
  })

  it('never scrolls above the top', () => {
    expect(locateScrollTop(1, 20.8, 400, 14)).toBe(0)
  })
})
