// @vitest-environment jsdom
/**
 * Browser-lane smoke for the client entry: mount the plugin on the production
 * SlotRegistry through `@deepseek-ai/dsh-client-test-runtime`'s jsdom bench and
 * assert the notes seats register and the sidebar entry renders in both widths.
 *
 * The sibling `*.test.ts` suites under `features/` stay in the Node environment
 * (pure domain logic); this file opts into jsdom per-file and carries the
 * `*.dom.test.ts` browser-lane name — see docs/smoke-test.md.
 * @module dsh-md-notes/client/index.dom.test
 */

import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, inject } from './index.ts'

// The bench's LocaleRuntime follows `navigator`, and jsdom reports the runner's
// own language, so the Chinese copy asserted below is stated, not inherited.
usePinnedBrowserLanguages('zh-CN')

/** Runtime under test; disposed after every case so benches never leak fibers. */
let runtime: SlotTestRuntime | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
})

/**
 * Assemble the bench, provide the locale service the plugin injects, declare the
 * root-scoped seats the entry registers into, and mount the real client entry.
 * @returns the mounted runtime.
 */
async function boot(): Promise<SlotTestRuntime> {
  const rt = await SlotTestRuntime.create()
  runtime = rt
  const locale = new LocaleRuntime(rt.ctx)
  rt.ctx.provide('locale', locale)
  rt.slots.installLocale(locale)
  await rt.declare({
    // Every seat this entry registers into is a multi-entry list slot: the
    // bench's `declare` is typed against the real SlotMap, so a wrong kind here
    // fails typecheck instead of silently rendering nothing.
    'sidebar.footer.action': { kind: 'list', scope: 'root' },
    'shell.overlay': { kind: 'list', scope: 'root' },
    'settings.section': { kind: 'list', scope: 'root' },
  })
  await rt.mount({ inject: [...inject], apply })
  return rt
}

describe('client entry on the jsdom slot bench', () => {
  it('registers the notes seats the sidebar and settings surfaces need', async () => {
    const rt = await boot()
    const idsOf = (key: 'sidebar.footer.action' | 'shell.overlay' | 'settings.section') =>
      rt.slots.entries(key).map(entry => entry.options.id)
    expect(idsOf('sidebar.footer.action')).toEqual(['dsh-notes-entry'])
    expect(idsOf('shell.overlay')).toEqual(['dsh-notes-overlay'])
    expect(idsOf('settings.section')).toEqual(['md-notes'])
  })

  it('renders the wide entry with its label and the rail entry without one', async () => {
    const rt = await boot()
    const slot = rt.renderSlot('sidebar.footer.action', { wide: true })
    expect(slot.view.getByRole('button', { name: 'MD 笔记' }).textContent).toBe('笔记')

    slot.update({ wide: false })
    expect(slot.view.getByRole('button', { name: 'MD 笔记' }).textContent).toBe('')
  })
})
