/**
 * Tests for the AI conflict-resolution flow: prompt assembly (three-level
 * methodology, file entries, push instruction) and the completion watcher
 * (running false→true→false, closed-session stop) against a hand-rolled
 * SessionsLike fixture.
 * @module dsh-md-notes/client/ai-conflict.test
 */

import { describe, expect, it, vi } from 'vitest'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { buildConflictPrompt, resolveConflictsWithAi, watchSessionCompletion, type SessionsLike } from './ai-conflict.ts'

/** Template stand-in: echoes the key so assertions can see interpolation. */
const t = ((key: string, params?: Record<string, unknown>) =>
  params === undefined ? `[${key}]` : `[${key}]${JSON.stringify(params)}`) as unknown as TranslateNS<'md-notes'>

describe('buildConflictPrompt', () => {
  it('lists every file with its base/remote sidecar paths and the push target', () => {
    const prompt = buildConflictPrompt(t, ['a.md', '我的笔记.md'], 'ws-1')
    expect(prompt).toContain('"base":".dsh-notes/.conflicts/a.base.md"')
    expect(prompt).toContain('"remote":".dsh-notes/.conflicts/a.remote.md"')
    expect(prompt).toContain('我的笔记.base.md')
    const pushLine = prompt.split('\n').find((l) => l.includes('conflict.promptPush'))
    expect(pushLine).toContain('"workspaceId":"ws-1"')
    expect(prompt).toContain('conflict.promptMethod')
    expect(prompt).toContain('conflict.promptReport')
  })
})

/** A mutable in-memory SessionsLike fixture with a per-session running flag. */
function fakeSessions(): SessionsLike & {
  prompts: Array<{ text: string; mode: string }>
  renames: string[]
  opened: string[]
  setRunning(id: string, running: boolean): void
  emit(): void
  remove(id: string): void
} {
  const byId: Record<string, { running?: boolean }> = {}
  const listeners = new Set<() => void>()
  const fixture = {
    prompts: [] as Array<{ text: string; mode: string }>,
    renames: [] as string[],
    opened: [] as string[],
    async create() {
      const id = `s-${Object.keys(byId).length + 1}`
      byId[id] = { running: false }
      return id
    },
    open(id: string) { fixture.opened.push(id) },
    binding(_id: string) {
      return {
        session: {
          rename(title: string) { fixture.renames.push(title) },
          async prompt(content: Array<{ type: 'text'; text: string }>, mode: 'queue') {
            fixture.prompts.push({ text: content[0]?.text ?? '', mode })
          },
        },
      }
    },
    list: {
      getSnapshot: () => ({ byId }),
      subscribe: (fn: () => void) => {
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      },
    },
    setRunning(id: string, running: boolean) { byId[id] = { running } },
    emit() { for (const fn of [...listeners]) fn() },
    remove(id: string) { delete byId[id] },
  }
  return fixture
}

describe('resolveConflictsWithAi', () => {
  it('creates, renames, prompts, and opens — in that contract shape', async () => {
    const sessions = fakeSessions()
    const id = await resolveConflictsWithAi(sessions, t, 'ws-9', ['a.md'])
    expect(id).toBe('s-1')
    expect(sessions.renames).toEqual(['[conflict.sessionTitle]'])
    expect(sessions.prompts).toHaveLength(1)
    expect(sessions.prompts[0]?.mode).toBe('queue')
    expect(sessions.prompts[0]?.text).toContain('conflict.promptIntro')
    expect(sessions.opened).toEqual(['s-1'])
  })

  it('a create failure propagates to the caller', async () => {
    const sessions = fakeSessions()
    sessions.create = async () => { throw new Error('denied') }
    await expect(resolveConflictsWithAi(sessions, t, 'ws-9', ['a.md'])).rejects.toThrow('denied')
  })
})

describe('watchSessionCompletion', () => {
  it('fires once after running goes true→false, then unsubscribes', async () => {
    const sessions = fakeSessions()
    const id = await sessions.create()
    const onDone = vi.fn()
    watchSessionCompletion(sessions, id, onDone)
    expect(onDone).not.toHaveBeenCalled() // queued (running=false) is NOT done

    sessions.setRunning('s-1', true)
    sessions.emit()
    expect(onDone).not.toHaveBeenCalled()

    sessions.setRunning('s-1', false)
    sessions.emit()
    expect(onDone).toHaveBeenCalledTimes(1)

    sessions.setRunning('s-1', true)
    sessions.emit()
    expect(onDone).toHaveBeenCalledTimes(1) // unsubscribed after firing
  })

  it('stops watching when the session disappears from the list', async () => {
    const sessions = fakeSessions()
    const id = await sessions.create()
    const onDone = vi.fn()
    const stop = watchSessionCompletion(sessions, id, onDone)
    sessions.remove(id)
    sessions.emit()
    expect(onDone).toHaveBeenCalledTimes(1)
    stop()
  })

  it('the returned unsubscribe stops the watch before completion', async () => {
    const sessions = fakeSessions()
    const id = await sessions.create()
    const onDone = vi.fn()
    const stop = watchSessionCompletion(sessions, id, onDone)
    stop()
    sessions.setRunning(id, true)
    sessions.emit()
    sessions.setRunning(id, false)
    sessions.emit()
    expect(onDone).not.toHaveBeenCalled()
  })
})
