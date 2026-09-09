/**
 * Tests for the right-Sidebar address → note mapping (`noteTargetOf`) and the
 * chip-title helper, over the two address scopes and the cross-workspace
 * `../` reference shape (real `parseFileAddress`, plain workspace fixtures).
 * @module dsh-md-notes/client/NoteViewer/address.test
 */

import { describe, expect, it } from 'vitest'
import type { WorkspaceNotes } from '../api.ts'
import { noteFileAddress, noteTargetOf, noteTitleOf, resolvePosix, sessionRootOf } from './address.ts'

const wsA: WorkspaceNotes = {
  workspaceId: 'a',
  name: 'Alpha',
  notesDir: '/base/ws-a/.dsh-notes',
  notes: [],
}
const wsB: WorkspaceNotes = {
  workspaceId: 'b',
  name: 'Beta',
  notesDir: '/base/ws-b/.dsh-notes',
  notes: [],
}
const groups = [wsA, wsB]

const SESSION = 'dsh-resource://file/session/s1/'
const ABSOLUTE = 'dsh-resource://file/absolute/'

describe('resolvePosix', () => {
  it('drops dot segments and consumes .. lexically', () => {
    expect(resolvePosix('/base/ws-a', './x/../.dsh-notes/a.md')).toBe('/base/ws-a/.dsh-notes/a.md')
  })

  it('a .. above base climbs into the sibling tree', () => {
    expect(resolvePosix('/base/ws-a/.dsh-notes', '../../ws-b/.dsh-notes/b.md'))
      .toBe('/base/ws-b/.dsh-notes/b.md')
  })
})

describe('sessionRootOf', () => {
  it('is the parent of the notes dir', () => {
    expect(sessionRootOf(wsA)).toBe('/base/ws-a')
  })

  it('is undefined without a group', () => {
    expect(sessionRootOf(undefined)).toBeUndefined()
  })
})

describe('noteTargetOf', () => {
  it('resolves a session-scoped note in the session workspace', () => {
    expect(noteTargetOf(`${SESSION}.dsh-notes/plan.md`, groups, '/base/ws-a'))
      .toEqual({ workspaceId: 'a', workspaceName: 'Alpha', notesDir: wsA.notesDir, name: 'plan.md' })
  })

  it('resolves a cross-workspace note by its ABSOLUTE address (the ../ shape routes there)', () => {
    // `new URL` collapses `..` segments inside session paths, so dsh's
    // fileAddressFor emits absolute addresses for anything escaping the root.
    expect(noteTargetOf(`${ABSOLUTE}base/ws-b/.dsh-notes/b.md`, groups, '/base/ws-a'))
      .toEqual({ workspaceId: 'b', workspaceName: 'Beta', notesDir: wsB.notesDir, name: 'b.md' })
  })

  it('resolves an absolute address inside a notes dir', () => {
    expect(noteTargetOf(`${ABSOLUTE}base/ws-b/.dsh-notes/我的 笔记.md`, groups, undefined))
      .toEqual({ workspaceId: 'b', workspaceName: 'Beta', notesDir: wsB.notesDir, name: '我的 笔记.md' })
  })

  it('decodes percent-encoded CJK and spaces (round-trip of encodeSegment)', () => {
    const raw = '我的 笔记.md'
    const encoded = encodeURIComponent(raw).replace(/%3A/gi, ':')
    expect(noteTargetOf(`${SESSION}.dsh-notes/${encoded}`, groups, '/base/ws-a')?.name).toBe(raw)
  })

  it('normalizes Windows separators on both sides', () => {
    const windowsGroups: WorkspaceNotes[] = [
      { workspaceId: 'w', name: 'Win', notesDir: 'C:/x/ws/.dsh-notes', notes: [] },
    ]
    expect(noteTargetOf(`${ABSOLUTE}C:/x/ws/.dsh-notes/a.md`, windowsGroups, undefined)?.name).toBe('a.md')
  })

  it('declines the notes dir itself and anything nested deeper', () => {
    expect(noteTargetOf(`${SESSION}.dsh-notes`, groups, '/base/ws-a')).toBeUndefined()
    expect(noteTargetOf(`${SESSION}.dsh-notes/sub/a.md`, groups, '/base/ws-a')).toBeUndefined()
  })

  it('declines a path outside every notes dir', () => {
    expect(noteTargetOf(`${SESSION}src/main.ts`, groups, '/base/ws-a')).toBeUndefined()
    expect(noteTargetOf(`${ABSOLUTE}/elsewhere/.dsh-notes/a.md`, groups, undefined)).toBeUndefined()
  })

  it('declines a session address without a session root, and a non-file address', () => {
    expect(noteTargetOf(`${SESSION}.dsh-notes/a.md`, groups, undefined)).toBeUndefined()
    expect(noteTargetOf('sidebar://guide', groups, '/base/ws-a')).toBeUndefined()
    expect(noteTargetOf('https://example.com/x.md', groups, '/base/ws-a')).toBeUndefined()
  })
})

describe('noteFileAddress', () => {
  it('builds the absolute file address of a known note (round-trips noteTargetOf)', () => {
    const address = noteFileAddress(groups, 'b', '我的 笔记.md')
    expect(address).toBe('dsh-resource://file/absolute/base/ws-b/.dsh-notes/%E6%88%91%E7%9A%84%20%E7%AC%94%E8%AE%B0.md')
    expect(noteTargetOf(address ?? '', groups, undefined)).toEqual({
      workspaceId: 'b', workspaceName: 'Beta', notesDir: wsB.notesDir, name: '我的 笔记.md',
    })
  })

  it('is undefined for an unknown workspace', () => {
    expect(noteFileAddress(groups, 'zzz', 'a.md')).toBeUndefined()
  })
})

describe('noteTitleOf', () => {
  it('is the decoded basename without .md', () => {
    expect(noteTitleOf(`${SESSION}.dsh-notes/${encodeURIComponent('我的 笔记')}.md`)).toBe('我的 笔记')
  })

  it('keeps a name with no .md suffix as-is', () => {
    expect(noteTitleOf(`${ABSOLUTE}/x/.dsh-notes/README`)).toBe('README')
  })

  it('falls back to the address for an empty basename', () => {
    const weird = 'dsh-resource://file/absolute/'
    expect(noteTitleOf(weird)).toBe(weird)
  })
})
