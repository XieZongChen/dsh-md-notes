/**
 * Tests for the pure reference-path helpers (browser bundle, no node:path).
 * @module dsh-md-notes/client/ContextSource/paths.test
 */

import { describe, expect, it } from 'vitest'
import { noteTargetOf } from '../NoteViewer/address.ts'
import type { NoteSummary, WorkspaceNotes } from '../api.ts'
import { chipLabel, canon, isAbsoluteRef, noteRefAddress, parentDir, qualifiedRefOf, refPath, relFrom } from './paths.ts'
import { resolveNoteRef } from './resolve.ts'

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

describe('noteRefAddress', () => {
  it('a session-relative ref becomes a session-scoped file address', () => {
    expect(noteRefAddress('s1', '.dsh-notes/plan.md'))
      .toBe('dsh-resource://file/session/s1/.dsh-notes/plan.md')
  })

  it('a cross-workspace ../ ref keeps its dot segments (the viewer resolves them)', () => {
    expect(noteRefAddress('s1', '../ws-b/.dsh-notes/b.md'))
      .toBe('dsh-resource://file/session/s1/../ws-b/.dsh-notes/b.md')
  })

  it('the absolute pick-time fallback becomes an absolute address (drive or slash)', () => {
    expect(noteRefAddress('s1', '/base/ws-a/.dsh-notes/a.md'))
      .toBe('dsh-resource://file/absolute/base/ws-a/.dsh-notes/a.md')
    expect(noteRefAddress('s1', 'C:/x/ws/.dsh-notes/a.md'))
      .toBe('dsh-resource://file/absolute/C:/x/ws/.dsh-notes/a.md')
  })

  it('round-trips into the viewer mapping (noteTargetOf resolves either form)', () => {
    const groups = [
      { workspaceId: 'a', name: 'A', notesDir: '/base/ws-a/.dsh-notes', notes: [] },
      { workspaceId: 'b', name: 'B', notesDir: '/base/ws-b/.dsh-notes', notes: [] },
    ]
    expect(noteTargetOf(noteRefAddress('s1', '../ws-b/.dsh-notes/b.md'), groups, '/base/ws-a')?.name).toBe('b.md')
    expect(noteTargetOf(noteRefAddress('s1', '/base/ws-b/.dsh-notes/b.md'), groups, undefined)?.name).toBe('b.md')
  })
})

describe('absolute-ref privacy helpers', () => {
  it('isAbsoluteRef recognizes POSIX and drive forms, rejects relative shapes', () => {
    expect(isAbsoluteRef('/Users/me/ws/.dsh-notes/a.md')).toBe(true)
    expect(isAbsoluteRef('C:/x/.dsh-notes/a.md')).toBe(true)
    expect(isAbsoluteRef('.dsh-notes/a.md')).toBe(false)
    expect(isAbsoluteRef('../ws-b/.dsh-notes/a.md')).toBe(false)
  })

  it('qualifiedRefOf exposes only the workspace name + note, and round-trips resolveNoteRef', () => {
    const ws = { workspaceId: 'b', name: 'Beta', notesDir: '/base/ws-b/.dsh-notes', notes: [{ name: 'b.md', title: 'B', updatedAt: 0 }] }
    const qualified = qualifiedRefOf(ws, 'b.md')
    expect(qualified).toBe('Beta/.dsh-notes/b.md')
    expect(resolveNoteRef([ws], qualified)).toEqual({ owner: ws, name: 'b.md' })
    expect(qualified.includes('/Users/')).toBe(false)
  })
})
