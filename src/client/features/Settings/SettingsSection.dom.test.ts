// @vitest-environment jsdom
/**
 * Browser-lane smoke for the settings section (`settings.section`): render it on
 * the jsdom slot bench, let it load the git settings through the real `api()`
 * client over a stubbed `fetch`, then drive the write path (toggle auto-pull →
 * Save) and assert the patch that reaches `gitConfig`.
 *
 * Why this seat is worth a test: the dsh 0.1.7 settings API change
 * (`SettingsForms` replacing `settings.register`) silently killed the whole host
 * plugin once, and the panel itself is otherwise only checked by hand
 * (docs/smoke-test.md §8). This keeps the client half — load, local edit, Save
 * patch — under the machine gate.
 *
 * React may print `not wrapped in act` advisories: the section's load and save
 * chains resolve their requests after the awaited assertion. They are advisories
 * with no effect on the result — every assertion reads settled state.
 * @module dsh-md-notes/client/Settings/SettingsSection.dom.test
 */

import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { act, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../../index.ts'

// The bench's LocaleRuntime follows `navigator`; jsdom reports the runner's own
// language, so the Chinese copy asserted below is stated, not inherited.
usePinnedBrowserLanguages('zh-CN')

/** The stored git settings the stubbed `gitSettings` method answers with. */
const SETTINGS = { gitMode: 'off' as const, gitAutoPull: true }

/** Runtime under test; disposed after every case so benches never leak fibers. */
let runtime: SlotTestRuntime | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
  vi.unstubAllGlobals()
})

/**
 * Answer the plugin's `POST /plugins/md-notes` calls from a method table.
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

/** The wire methods the settings section sends, decoded from the fetch mock. */
function sentMethods(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([, init]) =>
    JSON.parse(String((init as RequestInit).body)) as { method: string } & Record<string, unknown>)
}

/**
 * Mount the plugin on the bench, declare the settings seat, and render it the
 * way the settings shell does (owner prop `close` plus the injected locale seat).
 * @param responses - payload per wire method name.
 * @returns the rendered settings slot and the fetch mock behind it.
 */
async function openSettings(responses: Record<string, unknown>) {
  const rt = await SlotTestRuntime.create()
  runtime = rt
  const locale = new LocaleRuntime(rt.ctx)
  rt.ctx.provide('locale', locale)
  rt.slots.installLocale(locale)
  await rt.declare({ 'settings.section': { kind: 'list', scope: 'root' } })
  const fetchMock = stubHostApi(responses)
  await rt.mount({ inject: [...inject], apply })
  const slot = rt.renderSlot('settings.section', { close: vi.fn() })
  // The section loads its settings and workspaces on mount; the mode select is
  // its loaded signal, so settle that chain inside act before returning.
  await act(async () => { await slot.view.findByRole('button', { name: 'Git 同步' }) })
  return { slot, fetchMock }
}

/** The standard payloads the section's load path asks for. */
const LOAD_RESPONSES = {
  gitSettings: { ok: true, settings: SETTINGS },
  list: { ok: true, workspaces: [] },
  gitConfig: { ok: true },
}

describe('settings section on the jsdom slot bench', () => {
  it('renders the stored git settings and the save control', async () => {
    const { slot } = await openSettings(LOAD_RESPONSES)
    // The mode select shows the stored mode.
    expect(slot.view.getByRole('button', { name: 'Git 同步' }).textContent).toContain('关闭')
    expect(slot.view.getByRole('button', { name: '保存设置' })).not.toBeNull()
    expect((slot.view.getByLabelText('打开笔记时自动拉取远程') as HTMLInputElement).checked).toBe(true)
  })

  it('sends only the edited key as a gitConfig patch on save', async () => {
    const { slot, fetchMock } = await openSettings(LOAD_RESPONSES)
    await act(async () => {
      fireEvent.click(slot.view.getByLabelText('打开笔记时自动拉取远程'))
      fireEvent.click(slot.view.getByRole('button', { name: '保存设置' }))
    })

    // Saving re-reads the settings first (merge over the latest) and then writes
    // the dirty scalar only — never the untouched mode.
    const methods = sentMethods(fetchMock).map(call => call.method)
    expect(methods.slice(-2)).toEqual(['gitSettings', 'gitConfig'])
    expect(sentMethods(fetchMock).at(-1)).toEqual({ method: 'gitConfig', gitAutoPull: false })
    // The success copy arrives with the gitConfig response.
    await act(async () => { await slot.view.findByText('已保存 ✓') })
  })
})
