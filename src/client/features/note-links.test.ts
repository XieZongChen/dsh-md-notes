import { describe, expect, it } from 'vitest'
import { preprocessWikiLinks, resolveNoteLink } from './note-links.ts'
import type { WorkspaceNotes } from './api.ts'

/** Two workspaces, `foo.md` present in both (name collision across workspaces). */
const workspaces: WorkspaceNotes[] = [
  {
    workspaceId: 'ws-a',
    name: '工作区A',
    notesDir: '/root/a/.dsh-notes',
    notes: [
      { name: 'foo.md', title: 'Foo', updatedAt: 1 },
      { name: 'bar.md', title: 'Bar 笔记', updatedAt: 2 },
    ],
  },
  {
    workspaceId: 'ws-b',
    name: '工作区B',
    notesDir: '/root/b/.dsh-notes',
    notes: [{ name: 'foo.md', title: 'Foo B', updatedAt: 3 }],
  },
]

describe('resolveNoteLink', () => {
  it('matches by display title', () => {
    expect(resolveNoteLink('Bar 笔记', workspaces, 'ws-a')).toMatchObject({ workspaceId: 'ws-a', name: 'bar.md' })
  })

  it('matches by file basename (without .md)', () => {
    expect(resolveNoteLink('foo', workspaces, 'ws-a')).toMatchObject({ workspaceId: 'ws-a', name: 'foo.md' })
  })

  it('is case-insensitive and strips a .md suffix', () => {
    expect(resolveNoteLink('FOO.md', workspaces, 'ws-b')).toMatchObject({ workspaceId: 'ws-b', name: 'foo.md' })
  })

  it('prefers the current workspace on a cross-workspace name collision', () => {
    expect(resolveNoteLink('foo', workspaces, 'ws-b')).toMatchObject({ workspaceId: 'ws-b', title: 'Foo B' })
    expect(resolveNoteLink('foo', workspaces, 'ws-a')).toMatchObject({ workspaceId: 'ws-a', title: 'Foo' })
  })

  it('falls back to the first workspace without a preferred workspace', () => {
    expect(resolveNoteLink('foo', workspaces, null)).toMatchObject({ workspaceId: 'ws-a' })
  })

  it('returns undefined for an unknown name', () => {
    expect(resolveNoteLink('nope', workspaces, 'ws-a')).toBeUndefined()
  })

  it('returns undefined for a blank value', () => {
    expect(resolveNoteLink('   ', workspaces, 'ws-a')).toBeUndefined()
  })
})

describe('preprocessWikiLinks', () => {
  it('rewrites a resolving [[name]] to a backtick token', () => {
    expect(preprocessWikiLinks('see [[foo]] here', workspaces, 'ws-a')).toBe('see `foo` here')
  })

  it('leaves an unresolvable [[name]] literal', () => {
    expect(preprocessWikiLinks('[[nope]]', workspaces, 'ws-a')).toBe('[[nope]]')
  })

  it('does not rewrite inside a code fence', () => {
    const src = '```\n[[foo]]\n```\noutside [[foo]]'
    expect(preprocessWikiLinks(src, workspaces, 'ws-a')).toBe('```\n[[foo]]\n```\noutside `foo`')
  })
})
