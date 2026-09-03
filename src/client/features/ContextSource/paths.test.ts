/**
 * Tests for the pure reference-path helpers (browser bundle, no node:path).
 * @module dsh-md-notes/client/ContextSource/paths.test
 */

import { describe, expect, it } from 'vitest'
import { canon, chipLabel, parentDir, refPath, relFrom } from './paths.ts'
import type { NoteSummary, WorkspaceNotes } from '../api.ts'

describe('relFrom', () => {
  it('same-root target yields the down path with no ../', () => {
    expect(relFrom('/base/ws-a', '/base/ws-a/.dsh-notes/x.md')).toBe('.dsh-notes/x.md')
  })

  it('sibling workspace yields ../<dir>/…', () => {
    expect(relFrom('/base/ws-a', '/base/ws-b/.dsh-notes/x.md')).toBe('../ws-b/.dsh-notes/x.md')
  })

  it('deeper targets and different-depth bases compose ups and downs', () => {
    expect(relFrom('/base/ws-a', '/base/ws-a/sub/x.md')).toBe('sub/x.md')
    expect(relFrom('/a/b/c', '/a/d')).toBe('../../d')
  })
})

describe('canon', () => {
  it('collapses dot segments and duplicate slashes', () => {
    expect(canon('a/./b//c')).toBe('/a/b/c')
  })

  it('resolves .. within range', () => {
    expect(canon('/base/x/../y')).toBe('/base/y')
  })

  it('null when .. escapes above the root (never silently dropped)', () => {
    expect(canon('/a/../../x')).toBeNull()
  })

  it('an empty result canonicalizes to the root', () => {
    expect(canon('/')).toBe('/')
    expect(canon('///')).toBe('/')
  })
})

describe('parentDir', () => {
  it('strips the last segment (<ws>/.dsh-notes → <ws>)', () => {
    expect(parentDir('/base/ws/.dsh-notes')).toBe('/base/ws')
  })

  it('consumes trailing separators first', () => {
    expect(parentDir('/base/ws/')).toBe('/base')
  })
})

describe('refPath', () => {
  const note: NoteSummary = { name: 'n.md', title: 'N', updatedAt: 0 }

  it('joins without duplicating the slash', () => {
    const ws: WorkspaceNotes = { workspaceId: 'a', name: 'A', notesDir: '/w/.dsh-notes', notes: [note] }
    expect(refPath(ws, note)).toBe('/w/.dsh-notes/n.md')
  })

  it('keeps a trailing-slash notesDir intact', () => {
    const ws: WorkspaceNotes = { workspaceId: 'a', name: 'A', notesDir: '/w/.dsh-notes/', notes: [note] }
    expect(refPath(ws, note)).toBe('/w/.dsh-notes/n.md')
  })
})

describe('chipLabel', () => {
  it('front-truncates beyond 4 chars (fixed 4em chip cell)', () => {
    expect(chipLabel('_long-title')).toBe('_lon…')
  })

  it('keeps short titles as-is, including CJK', () => {
    expect(chipLabel('ab')).toBe('ab')
    expect(chipLabel('笔记甲乙')).toBe('笔记甲乙')
  })
})
