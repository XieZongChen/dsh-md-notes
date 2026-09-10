/**
 * Integration tests for the `@` notes source factory (`createNotesSource`)
 * with the host API mocked: candidate filtering (bare / fuzzy workspace /
 * `@工作区/` cross-workspace / no-match), pick-time path shapes (relative
 * always; the unsettled-session guard refuses rather than persist an
 * absolute path), submit-time serialization (revalidation, the privacy
 * rewrite of legacy absolute refs, localized refusals), and the chip-click
 * `openReference` address choice. The pure helpers (paths/resolve) have
 * their own files.
 * @module dsh-md-notes/client/ContextSource/ContextSource.test
 */

import { describe, expect, it, vi } from 'vitest'
import type { InputTriggerCandidate, InputTriggerPick, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceNotes } from '../api.ts'

vi.mock('../api.ts', () => ({
  api: vi.fn(),
  ICON_URL: '/plugins/md-notes/icon.svg',
  gitStatusApi: vi.fn(),
  gitErrorText: vi.fn(),
}))

const { api } = await import('../api.ts')
const { createNotesSource } = await import('./ContextSource.ts')

/** Locale stub: `key` or `key:{json params}` — deterministic for assertions. */
const t = ((key: string, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as unknown as TranslateNS<'md-notes'>

const wsA: WorkspaceNotes = {
  workspaceId: 'a', name: 'Alpha', notesDir: '/base/ws-a/.dsh-notes',
  notes: [
    { name: 'plan.md', title: 'Plan', updatedAt: 1 },
    { name: '我的 笔记.md', title: '我的 笔记', updatedAt: 2 },
  ],
}
const wsB: WorkspaceNotes = {
  workspaceId: 'b', name: 'Beta', notesDir: '/base/ws-b/.dsh-notes',
  notes: [{ name: 'b.md', title: 'B note', updatedAt: 3 }],
}

/** Route the api mock: `list` with sessionId → [wsA]; without → both. */
function mockList(sessionWorkspaces: readonly WorkspaceNotes[] = [wsA]): void {
  vi.mocked(api).mockImplementation(async (method: unknown, body?: unknown) => {
    const m = method as string
    const b = body as { sessionId?: string } | undefined
    if (m !== 'list') throw new Error(`unexpected api call: ${m}`)
    return { ok: true, workspaces: b?.sessionId !== undefined ? [...sessionWorkspaces] : [wsA, wsB] }
  })
}

const SESSION = { sessionId: 's1' } as { sessionId: string }
const SIGNAL = new AbortController().signal

async function candidatesOf(source: InputTriggerSource, query: string): Promise<readonly InputTriggerCandidate[]> {
  return source.candidates({ sessionId: 's1' } as never, { query, signal: SIGNAL } as never)
}

describe('candidates', () => {
  it('bare @ lists the session workspace notes (logo icon, file-name descriptions)', async () => {
    mockList()
    const { source, dispose } = createNotesSource(t)
    try {
      const rows = await candidatesOf(source, '')
      expect(rows.map(r => r.name)).toEqual(['Plan', '我的 笔记'])
      expect(rows[0]?.description).toBe('plan')
      expect(typeof rows[0]?.icon).toBe('function') // NoteLogoIcon component
    } finally { dispose() }
  })

  it('a partial bare name adds fuzzy workspace rows alongside filtered notes', async () => {
    mockList()
    const { source, dispose } = createNotesSource(t)
    try {
      const rows = await candidatesOf(source, 'bet')
      // 'bet' matches workspace Beta but no Alpha note → only the Beta/ row.
      expect(rows.map(r => r.name)).toEqual(['Beta/'])
      expect(rows[0]?.icon).toBe('folder')
      expect(rows[0]?.description).toBe('context.workspaceRow')
    } finally { dispose() }
  })

  it('`@Beta/` switches to Beta notes with cross-workspace descriptions', async () => {
    mockList()
    const { source, dispose } = createNotesSource(t)
    try {
      const rows = await candidatesOf(source, 'Beta/')
      expect(rows.map(r => r.name)).toEqual(['B note'])
      expect(rows[0]?.description).toBe('Beta · b')
    } finally { dispose() }
  })

  it('a `@未知/` prefix matching no workspace yields nothing', async () => {
    mockList()
    const { source, dispose } = createNotesSource(t)
    try {
      expect(await candidatesOf(source, 'zzz/')).toEqual([])
    } finally { dispose() }
  })
})

describe('onPick', () => {
  it('inserts a session-relative ref for the same workspace', async () => {
    mockList()
    const { source, dispose } = createNotesSource(t)
    try {
      const rows = await candidatesOf(source, '')
      const pick = { candidate: rows[0] as InputTriggerCandidate, session: SESSION, span: { start: 0 } } as unknown as InputTriggerPick
      const outcome = source.onPick(pick)
      if (outcome === undefined || typeof outcome === 'string' || !('insert' in outcome)) {
        throw new Error('expected an insert outcome')
      }
      expect(outcome.insert.ref).toBe('.dsh-notes/plan.md')
      expect(outcome.insert.source).toBe('notes')
    } finally { dispose() }
  })

  it('REFUSES the pick (no absolute path) when the session workspace is unknown', async () => {
    mockList([]) // session list settles empty → no session root
    const { source, dispose } = createNotesSource(t)
    try {
      const rows = await candidatesOf(source, 'Beta/')
      const pick = { candidate: rows[0] as InputTriggerCandidate, session: SESSION, span: { start: 0 } } as unknown as InputTriggerPick
      expect(source.onPick(pick)).toBeUndefined()
    } finally { dispose() }
  })
})

describe('codec.serialize', () => {
  it('emits the localized reference line with the ref unchanged (relative stays relative)', async () => {
    mockList()
    const { source, dispose } = createNotesSource(t)
    try {
      const out = await source.codec?.serialize('.dsh-notes/plan.md', SIGNAL)
      expect(out).toBe('context.reference:{"title":"Plan","path":".dsh-notes/plan.md"}')
    } finally { dispose() }
  })

  it('rewrites a legacy ABSOLUTE ref to the workspace-qualified form (privacy)', async () => {
    mockList()
    const { source, dispose } = createNotesSource(t)
    try {
      const out = await source.codec?.serialize('/base/ws-b/.dsh-notes/b.md', SIGNAL)
      expect(out).toBe('context.reference:{"title":"B note","path":"Beta/.dsh-notes/b.md"}')
    } finally { dispose() }
  })

  it('blocks the send with a localized notice when the note is gone', async () => {
    mockList()
    const { source, dispose } = createNotesSource(t)
    try {
      await expect(source.codec?.serialize('.dsh-notes/gone.md', SIGNAL))
        .rejects.toThrow('context.noteMissing:{"name":"gone"}')
    } finally { dispose() }
  })

  it('refuses on a stale host (no notesDir) instead of guessing', async () => {
    vi.mocked(api).mockImplementation(async () => ({
      ok: true,
      workspaces: [{ ...wsA, notesDir: '' }],
    }))
    const { source, dispose } = createNotesSource(t)
    try {
      await expect(source.codec?.serialize('.dsh-notes/plan.md', SIGNAL)).rejects.toThrow('context.errCheck')
    } finally { dispose() }
  })
})

describe('openReference (chip-click preview)', () => {
  it('opens the sidebar at the ref\'s file address and accepts', async () => {
    mockList()
    const opened: string[] = []
    const { source, dispose } = createNotesSource(t, undefined, (address) => { opened.push(address) })
    try {
      // Candidates first: the all-workspaces snapshot settles, through which
      // the cross-workspace `../` ref resolves to an absolute address.
      await candidatesOf(source, '')
      const ok = source.openReference?.(SESSION as never, { ref: '../ws-b/.dsh-notes/b.md' })
      expect(ok).toBe(true)
      expect(opened).toEqual(['dsh-resource://file/absolute/base/ws-b/.dsh-notes/b.md'])
      // A plain same-workspace ref rides the session-scoped address directly.
      expect(source.openReference?.(SESSION as never, { ref: '.dsh-notes/plan.md' })).toBe(true)
      expect(opened[1]).toBe('dsh-resource://file/session/s1/.dsh-notes/plan.md')
    } finally { dispose() }
  })

  it('declines without the sidebar service (editor gesture unchanged)', async () => {
    mockList()
    const { source, dispose } = createNotesSource(t)
    try {
      expect(source.openReference?.(SESSION as never, { ref: '.dsh-notes/plan.md' })).toBe(false)
    } finally { dispose() }
  })
})
