// @vitest-environment jsdom
/**
 * Browser-lane smoke for the notes manager: open it from the sidebar entry on
 * the jsdom slot bench and drive the two left-pane data paths through the real
 * `api()` client — the workspace/note list and the debounced full-text search —
 * with the host route stubbed at `fetch`.
 *
 * The host side of those endpoints is covered by `src/host/http.test.ts`; what
 * this file adds is that the *client* renders what the wire returns (workspace
 * grouping, hit lines, highlight marks) and sends the query it promises.
 *
 * React prints `not wrapped in act` advisories for part of the manager's data
 * path: the open path fans requests out sequentially and their state updates
 * land after the awaited assertion. They are advisories with no effect on the
 * result — every assertion below reads settled state.
 * @module dsh-md-notes/client/NotesManager/NotesManager.dom.test
 */

import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { act, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../../index.ts'

// The bench's LocaleRuntime follows `navigator`; jsdom reports the runner's own
// language, so the Chinese copy asserted below is stated, not inherited.
usePinnedBrowserLanguages('zh-CN')

/** The workspace/note fixture the stubbed `list` method answers with. */
const WORKSPACES = [
  {
    workspaceId: 'ws-a',
    name: 'Alpha',
    notesDir: '/tmp/alpha/.dsh-notes',
    notes: [{ name: 'a.md', title: '笔记 A', updatedAt: 1_700_000_000_000 }],
  },
]

/** Every payload the manager's open path asks for, before a search. */
const OPEN_RESPONSES = {
  list: { ok: true, workspaces: WORKSPACES },
  gitSettings: { ok: true, settings: { gitAutoPull: false } },
  gitStatus: { ok: false, code: 'no-repo', error: 'no repository' },
  checkUpdate: { ok: true },
}

/** Runtime under test; disposed after every case so benches never leak fibers. */
let runtime: SlotTestRuntime | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
  vi.unstubAllGlobals()
})

/**
 * Answer the plugin's `POST /plugins/md-notes` calls from a method table.
 * `api()` reads only `res.json()` (and `res.status` on a non-JSON body), so a
 * minimal response double is enough; an unstubbed method answers as a failure
 * loud enough to show up in the assertion rather than hanging the manager.
 * @param responses - payload per wire method name.
 * @returns the fetch mock, for asserting what the client sent.
 */
function stubHostApi(responses: Record<string, unknown>) {
  const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string }
    const payload = responses[body.method ?? ''] ?? { ok: false, error: `unstubbed method ${String(body.method)}` }
    return { status: 200, json: async () => payload } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/**
 * Mount the plugin on the bench with the manager reachable: declare the entry
 * and overlay seats, stub the host route, then open the manager by clicking the
 * sidebar entry the way a user does.
 * @param responses - payload per wire method name.
 * @returns the rendered overlay view and the fetch mock behind it.
 */
async function openManager(responses: Record<string, unknown>) {
  const rt = await SlotTestRuntime.create()
  runtime = rt
  const locale = new LocaleRuntime(rt.ctx)
  rt.ctx.provide('locale', locale)
  rt.slots.installLocale(locale)
  await rt.declare({
    'sidebar.footer.action': { kind: 'list', scope: 'root' },
    'shell.overlay': { kind: 'list', scope: 'root' },
  })
  const fetchMock = stubHostApi(responses)
  await rt.mount({ inject: [...inject], apply })
  const entry = rt.renderSlot('sidebar.footer.action', { wide: true })
  // The entry's click is a user gesture that flips the shared store.
  await act(async () => { entry.view.getByRole('button', { name: 'MD 笔记' }).click() })
  const overlay = rt.renderSlot('shell.overlay', {})
  // The manager fetches its list on mount; the workspace header is its signal.
  // Then drain until the stubbed route stops receiving calls, so the git-status
  // chain the open path walks resolves inside act instead of after the test.
  await act(async () => {
    await overlay.view.findByText('Alpha')
    let seen = -1
    for (let round = 0; round < 20 && seen !== fetchMock.mock.calls.length; round += 1) {
      seen = fetchMock.mock.calls.length
      await new Promise(resolve => { setTimeout(resolve, 0) })
    }
  })
  return { overlay, fetchMock }
}

describe('notes manager on the jsdom slot bench', () => {
  it('lists workspace groups and their notes from the host route', async () => {
    const { overlay } = await openManager(OPEN_RESPONSES)
    expect(overlay.view.getByText('Alpha')).not.toBeNull()
    expect(overlay.view.getByText('笔记 A')).not.toBeNull()
  })

  it('renders grouped search hits with their line number and highlight after the debounce', async () => {
    const { overlay, fetchMock } = await openManager({
      ...OPEN_RESPONSES,
      search: {
        ok: true,
        truncated: false,
        results: [{
          workspaceId: 'ws-a',
          workspaceName: 'Alpha',
          name: 'a.md',
          title: '笔记 A',
          titleMatch: false,
          totalHits: 1,
          hits: [{ line: 3, text: 'hello 关键词 world', ranges: [{ start: 6, end: 9 }] }],
        }],
      },
    })

    // Advance the 250ms debounce deterministically: fake timers keep the
    // settling request and its response inside one act window (and shave the
    // real wait) where a plain `waitFor` lets them escape it.
    vi.useFakeTimers()
    try {
      fireEvent.change(overlay.view.getByPlaceholderText('搜索全部工作区…'), { target: { value: '关键词' } })
      await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    } finally {
      vi.useRealTimers()
    }

    expect(overlay.view.getByText('L3')).not.toBeNull()
    expect(overlay.view.getByText('关键词').tagName).toBe('MARK')
    expect(overlay.view.getByText('1 处命中')).not.toBeNull()

    const sent = fetchMock.mock.calls
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { method: string; query?: string })
      .filter(call => call.method === 'search')
    expect(sent).toEqual([{ method: 'search', query: '关键词' }])
  })
})
