/**
 * Tests for the submit-time ref → workspace resolution (the three-branch
 * logic serialize depends on; see resolve.ts for the branch docs).
 * @module dsh-md-notes/client/ContextSource/resolve.test
 */

import { describe, expect, it } from 'vitest'
import { resolveNoteRef } from './resolve.ts'
import type { WorkspaceNotes } from '../api.ts'

function ws(id: string, name: string, notesDir: string, notes: string[]): WorkspaceNotes {
  return {
    workspaceId: id, name, notesDir,
    notes: notes.map((n) => ({ name: n, title: n, updatedAt: 0 })),
  }
}

/** Sibling workspaces under /base, one nested deeper, one AT /base itself. */
const WORKSPACES = [
  ws('a', 'alpha', '/base/ws-a/.dsh-notes', ['one.md', '我的 笔记.md']),
  ws('b', 'beta', '/base/ws-b/.dsh-notes', ['two.md']),
  ws('deep', 'deep-ws', '/base/lvl1/lvl2/ws-deep/.dsh-notes', ['three.md']),
  ws('root', 'root-ws', '/base/.dsh-notes', ['root-note.md']),
]

describe('resolveNoteRef', () => {
  it('absolute ref: matches by notesDir prefix', () => {
    expect(resolveNoteRef(WORKSPACES, '/base/ws-b/.dsh-notes/two.md'))
      .toEqual({ owner: WORKSPACES[1], name: 'two.md' })
  })

  it('absolute ref under no workspace yields undefined', () => {
    expect(resolveNoteRef(WORKSPACES, '/elsewhere/.dsh-notes/x.md')).toBeUndefined()
  })

  it('dot-relative same-workspace ref resolves', () => {
    expect(resolveNoteRef(WORKSPACES, '.dsh-notes/one.md'))
      .toEqual({ owner: WORKSPACES[0], name: 'one.md' })
  })

  it('dot-relative cross-workspace ref (../ws-b/…) resolves via SOME base root', () => {
    expect(resolveNoteRef(WORKSPACES, '../ws-b/.dsh-notes/two.md'))
      .toEqual({ owner: WORKSPACES[1], name: 'two.md' })
  })

  it('cross-depth ref: the .. count matches the session root, not the target root', () => {
    // From deep-ws's root (3 levels below /base), ../../../ws-b reaches
    // /base/ws-b — resolution must use the SESSION root's depth, and bases
    // whose own root escapes above / are canon-null and safely skipped.
    expect(resolveNoteRef(WORKSPACES, '../../../ws-b/.dsh-notes/two.md'))
      .toEqual({ owner: WORKSPACES[1], name: 'two.md' })
  })

  it('a name no workspace owns yields undefined', () => {
    expect(resolveNoteRef(WORKSPACES, '.dsh-notes/missing.md')).toBeUndefined()
  })

  it('workspace-name fallback (<wsName>/…) matches by name', () => {
    expect(resolveNoteRef(WORKSPACES, 'beta/two.md'))
      .toEqual({ owner: WORKSPACES[1], name: 'two.md' })
  })

  it('non-dot relative under the session workspace (ups=0 form) resolves generically', () => {
    // relFrom yields this form when the SESSION workspace root is an ancestor
    // of the target (here root-ws at /base): /base + ws-b/… = the target.
    expect(resolveNoteRef(WORKSPACES, 'ws-b/.dsh-notes/two.md'))
      .toEqual({ owner: WORKSPACES[1], name: 'two.md' })
  })

  it('CJK+space note names resolve', () => {
    expect(resolveNoteRef(WORKSPACES, '.dsh-notes/我的 笔记.md'))
      .toEqual({ owner: WORKSPACES[0], name: '我的 笔记.md' })
  })
})
