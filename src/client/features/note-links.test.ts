import { describe, expect, it } from 'vitest'
import { preprocessWikiLinks, resolveNoteLink, titleMatchCount } from './note-links.ts'
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

/** One workspace with two notes sharing a title (same-workspace title collision). */
const dupTitles: WorkspaceNotes[] = [
  {
    workspaceId: 'ws-a',
    name: '工作区A',
    notesDir: '/root/a/.dsh-notes',
    notes: [
      { name: 'foo.md', title: 'Foo', updatedAt: 1 },
      { name: 'foo-2.md', title: 'Foo', updatedAt: 2 },
      { name: 'bar.md', title: 'Bar 笔记', updatedAt: 3 },
    ],
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

  it('resolves a workspace-qualified token to the named workspace on a collision', () => {
    expect(resolveNoteLink('工作区B/foo', workspaces, 'ws-a')).toMatchObject({ workspaceId: 'ws-b', title: 'Foo B' })
  })

  it('resolves a workspace-qualified token by workspace id', () => {
    expect(resolveNoteLink('ws-b/foo', workspaces, 'ws-a')).toMatchObject({ workspaceId: 'ws-b', title: 'Foo B' })
  })

  it('returns undefined when the named workspace has no such note', () => {
    expect(resolveNoteLink('工作区B/bar', workspaces, 'ws-a')).toBeUndefined()
  })

  it('falls through to a plain title match when the prefix is not a workspace', () => {
    expect(resolveNoteLink('Bar 笔记', workspaces, 'ws-a')).toMatchObject({ workspaceId: 'ws-a', name: 'bar.md' })
  })

  it('matches a note whose title contains a slash when the prefix is not a workspace', () => {
    const withSlash: WorkspaceNotes[] = [{
      workspaceId: 'ws-a',
      name: '工作区A',
      notesDir: '/root/a/.dsh-notes',
      notes: [{ name: 'ab.md', title: 'A/B', updatedAt: 1 }],
    }]
    expect(resolveNoteLink('A/B', withSlash, 'ws-a')).toMatchObject({ workspaceId: 'ws-a', name: 'ab.md' })
  })

  it('returns undefined for an unknown name', () => {
    expect(resolveNoteLink('nope', workspaces, 'ws-a')).toBeUndefined()
  })

  it('returns undefined for a blank value', () => {
    expect(resolveNoteLink('   ', workspaces, 'ws-a')).toBeUndefined()
  })
})

describe('titleMatchCount', () => {
  it('counts same-workspace notes sharing a title (case-insensitive)', () => {
    expect(titleMatchCount('foo', dupTitles, 'ws-a')).toBe(2)
    expect(titleMatchCount('Foo', dupTitles, 'ws-a')).toBe(2)
  })

  it('returns 1 for a unique title', () => {
    expect(titleMatchCount('Bar 笔记', dupTitles, 'ws-a')).toBe(1)
  })

  it('returns 0 when the token matches by file name only', () => {
    expect(titleMatchCount('foo-2', dupTitles, 'ws-a')).toBe(0)
  })

  it('strips a workspace qualifier before counting', () => {
    expect(titleMatchCount('工作区A/foo', dupTitles, 'ws-a')).toBe(2)
  })

  it('returns 0 for an unknown workspace or empty value', () => {
    expect(titleMatchCount('foo', dupTitles, 'nope')).toBe(0)
    expect(titleMatchCount('   ', dupTitles, 'ws-a')).toBe(0)
  })
})

describe('preprocessWikiLinks', () => {
  it('rewrites a resolving [[name]] to a backtick token', () => {
    expect(preprocessWikiLinks('see [[foo]] here', workspaces, 'ws-a')).toBe('see `foo` here')
  })

  it('rewrites a workspace-qualified [[ws/name]] to a backtick token', () => {
    expect(preprocessWikiLinks('see [[工作区B/foo]] here', workspaces, 'ws-a')).toBe('see `工作区B/foo` here')
  })

  it('leaves an unresolvable [[name]] literal', () => {
    expect(preprocessWikiLinks('[[nope]]', workspaces, 'ws-a')).toBe('[[nope]]')
  })

  it('does not rewrite inside a code fence', () => {
    const src = '```\n[[foo]]\n```\noutside [[foo]]'
    expect(preprocessWikiLinks(src, workspaces, 'ws-a')).toBe('```\n[[foo]]\n```\noutside `foo`')
  })
})
