/**
 * Tests for BusyTracker's reference-counting semantics (docs/state.md 铁律 2):
 * nested begin counts once and releases pair down before the busy mark clears;
 * `run` releases on the throw path too. busy.ts imports the store TYPE only,
 * so a hand-rolled mutable store is the whole fixture.
 * @module dsh-md-notes/client/busy.test
 */

import { describe, expect, it } from 'vitest'
import { createBusyTracker, noteKey, type BusyTracker } from './busy.ts'
import type { NotesUiState, NotesUiStore } from './store.ts'

/** A minimal mutable snapshot store (update applies a direct-mutating draft). */
function fakeStore(): NotesUiStore {
  const state: NotesUiState = { managerOpen: false, picker: null, busy: {} }
  return {
    update(draft: (d: NotesUiState) => void) { draft(state) },
    getSnapshot: () => state,
    subscribe: () => () => {},
  } as unknown as NotesUiStore
}

function tracker(): BusyTracker {
  return createBusyTracker(fakeStore())
}

describe('BusyTracker', () => {
  it('marks busy on begin and clears on the paired release', () => {
    const t = tracker()
    const release = t.begin('note/ws-1/a.md')
    expect(t.isBusy('note/ws-1/a.md')).toBe(true)
    expect(t.count()).toBe(1)
    release()
    expect(t.isBusy('note/ws-1/a.md')).toBe(false)
    expect(t.count()).toBe(0)
  })

  it('nested begin/release pairs: the mark clears only after the last release', () => {
    const t = tracker()
    const r1 = t.begin('k')
    const r2 = t.begin('k')
    r1()
    expect(t.isBusy('k')).toBe(true) // still held once
    r2()
    expect(t.isBusy('k')).toBe(false)
  })

  it('counts distinct keys independently', () => {
    const t = tracker()
    const a = t.begin('note/ws-1/a.md')
    const b = t.begin('note/ws-2/b.md')
    expect(t.count()).toBe(2)
    a()
    expect(t.count()).toBe(1)
    b()
    expect(t.count()).toBe(0)
  })

  it('run releases the mark when the task throws', async () => {
    const t = tracker()
    await expect(t.run('k', async () => { throw new Error('x') })).rejects.toThrow('x')
    expect(t.isBusy('k')).toBe(false)
  })

  it('run returns the task value and releases afterwards', async () => {
    const t = tracker()
    const value = await t.run('k', async () => 42)
    expect(value).toBe(42)
    expect(t.isBusy('k')).toBe(false)
  })
})

describe('noteKey', () => {
  it('joins the notes-domain prefix, workspace and name', () => {
    expect(noteKey('ws-1', 'a.md')).toBe('note/ws-1/a.md')
  })
})
