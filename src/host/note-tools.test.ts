/**
 * Tests for the agent-facing note-access shaping (docs/memory.md): reference
 * resolution and the search/listing rows a model sees.
 * @module dsh-md-notes/host/note-tools.test
 */

import { describe, expect, it } from 'vitest'
import type { NoteHits } from '../contract.ts'
import {
  agentRefs, pickAgentNote, recentAgentNotes, searchScopes, shapeAgentSearch, writeScope,
  type AgentNoteRef,
} from './note-tools.ts'
import type { SearchScope } from './notes.ts'

const WS_A = { workspaceId: 'w-a', workspaceName: 'Alpha' }

function ref(overrides: Partial<AgentNoteRef>): AgentNoteRef {
  return { workspaceId: 'w-a', workspaceName: 'Alpha', name: 'x.md', title: 'X', updatedAt: 0, ...overrides }
}

describe('agentRefs', () => {
  it('stamps the owning workspace onto every note', () => {
    const refs = agentRefs(WS_A, [{ name: 'a.md', title: 'A', updatedAt: 5 }])
    expect(refs).toEqual([{ workspaceId: 'w-a', workspaceName: 'Alpha', name: 'a.md', title: 'A', updatedAt: 5 }])
  })
})

describe('pickAgentNote', () => {
  const refs = [
    ref({ workspaceId: 'w-a', workspaceName: 'Alpha', name: 'deploy.md', title: 'Deploy runbook' }),
    ref({ workspaceId: 'w-b', workspaceName: 'Beta', name: 'deploy.md', title: 'Deploy (Beta)' }),
    ref({ workspaceId: 'w-a', workspaceName: 'Alpha', name: 'notes.md', title: 'Deploy runbook' }),
  ]

  it('resolves a file name with or without the .md suffix, case-insensitively', () => {
    const hit = pickAgentNote([refs[0]!], 'Deploy')
    expect(hit).toEqual({ ok: true, note: refs[0] })
    expect(pickAgentNote([refs[0]!], 'deploy.md')).toEqual({ ok: true, note: refs[0] })
  })

  it('prefers an exact file name over a title match', () => {
    const hit = pickAgentNote(refs, 'notes')
    expect(hit).toEqual({ ok: true, note: refs[2] })
  })

  it('uses the calling session workspace to break a cross-workspace tie', () => {
    const hit = pickAgentNote(refs.slice(0, 2), 'deploy', 'w-b')
    expect(hit).toEqual({ ok: true, note: refs[1] })
  })

  it('returns the candidates instead of guessing when the tie cannot be broken', () => {
    const hit = pickAgentNote(refs.slice(0, 2), 'deploy')
    expect(hit.ok).toBe(false)
    if (hit.ok) throw new Error('expected ambiguity')
    expect(hit.candidates.map((c) => c.workspaceName)).toEqual(['Alpha', 'Beta'])
  })

  it('reports an empty candidate list when nothing matches', () => {
    const hit = pickAgentNote(refs, 'nope')
    expect(hit).toEqual({ ok: false, candidates: [] })
    expect(pickAgentNote(refs, '   ').ok).toBe(false)
  })
})

describe('shapeAgentSearch', () => {
  const hits: NoteHits[] = [{
    workspaceId: 'w-a',
    workspaceName: 'Alpha',
    name: 'deploy.md',
    title: 'Deploy',
    titleMatch: false,
    totalHits: 3,
    hits: [{ line: 4, text: 'rotate the token', ranges: [{ start: 0, end: 6 }] }],
  }]

  it('drops the renderer-only highlight ranges and caps the rows', () => {
    const shaped = shapeAgentSearch(hits, 8)
    expect(shaped.truncated).toBe(false)
    expect(shaped.results[0]).toMatchObject({ name: 'deploy.md', workspaceName: 'Alpha', totalHits: 3 })
    expect(shaped.results[0]!.hits).toEqual([{ line: 4, text: 'rotate the token' }])
  })

  it('flags truncation when the cap drops notes', () => {
    const shaped = shapeAgentSearch(hits, 0)
    expect(shaped.results).toEqual([])
    expect(shaped.truncated).toBe(true)
  })
})

describe('recentAgentNotes', () => {
  it('lists newest-first and caps the slice', () => {
    const refs = [
      ref({ name: 'old.md', updatedAt: 1 }),
      ref({ name: 'new.md', updatedAt: 9 }),
      ref({ name: 'mid.md', updatedAt: 5 }),
    ]
    expect(recentAgentNotes(refs, 2).map((r) => r.name)).toEqual(['new.md', 'mid.md'])
  })

  it('does not mutate the input order', () => {
    const refs = [ref({ name: 'a.md', updatedAt: 1 }), ref({ name: 'b.md', updatedAt: 2 })]
    recentAgentNotes(refs, 2)
    expect(refs.map((r) => r.name)).toEqual(['a.md', 'b.md'])
  })
})

describe('searchScopes / writeScope (sessions outside the workspace registry)', () => {
  const alpha: SearchScope = { workspaceId: 'w-a', workspaceName: 'Alpha', dir: '/ws/a/.dsh-notes' }
  const beta: SearchScope = { workspaceId: 'w-b', workspaceName: 'Beta', dir: '/ws/b/.dsh-notes' }
  const local: SearchScope = { workspaceId: 'cwd:/tmp/fixture', workspaceName: 'fixture', dir: '/tmp/fixture/.dsh-notes' }

  it('search puts the session directory first, then the registered workspaces', () => {
    expect(searchScopes([alpha, beta], local).map((s) => s.workspaceName)).toEqual(['fixture', 'Alpha', 'Beta'])
  })

  it('search without a local dir is just the registered workspaces', () => {
    expect(searchScopes([alpha, beta], undefined)).toEqual([alpha, beta])
    expect(searchScopes([], undefined)).toEqual([])
  })

  it('search does not duplicate a local dir that is also registered', () => {
    expect(searchScopes([alpha], { ...local, dir: alpha.dir })).toEqual([{ ...local, dir: alpha.dir }])
  })

  it('write prefers the session workspace, then its own cwd — never another workspace', () => {
    expect(writeScope([alpha, beta], 'w-b', local)).toEqual(beta)
    expect(writeScope([alpha, beta], undefined, local)).toEqual(local)
  })

  it('write refuses rather than falling back to the only registered workspace', () => {
    // The regression this guards: an SDK/automation session in /tmp/fixture must
    // NOT append into the user's real (and only) registered workspace.
    expect(writeScope([alpha], undefined, undefined)).toBeUndefined()
    expect(writeScope([alpha], 'unknown-workspace', undefined)).toBeUndefined()
  })
})
