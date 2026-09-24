/**
 * Playwright scenario: the sidebar footer entry in a real browser.
 *
 * This is the layer the jsdom lane cannot reach — it asserts *geometry*: the entry
 * is a full-width footer row, the footer stacks its entries in a column (the
 * plugin's own fallback rule for dsh's row+nowrap container), the row carries no
 * plugin-written inline styles (issue #1's "the sidebar must not be stretched"
 * contract), and collapsing the sidebar turns the same control into a rail icon.
 * @module dsh-md-notes/e2e/sidebar.e2e
 */

import type { Browser } from 'playwright'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closePage, launchChromium, launchWebHarness, openHarnessPage, resetHarnessPage, type HarnessPage, type WebHarness } from './scaffold.ts'

describe('sidebar footer entry (real browser)', () => {
  let harness: WebHarness
  let browser: Browser
  let opened: HarnessPage

  beforeAll(async () => {
    browser = await launchChromium()
    harness = await launchWebHarness()
    opened = await openHarnessPage(browser, harness.url)
  }, 180_000)

  afterAll(async () => {
    await closePage(opened)
    await browser.close()
    await harness.stop()
  })

  // Sharing one page across cases is what makes the suite fast; reloading to the
  // ready state is what keeps cases independent of each other's open panels.
  beforeEach(async () => { await resetHarnessPage(opened.page) })

  it('renders a full-width footer row whose container stacks entries', async () => {
    const { page } = opened
    const entry = page.getByRole('button', { name: 'MD 笔记' })
    await entry.waitFor({ state: 'visible', timeout: 15_000 })

    const box = await entry.boundingBox()
    expect(box).not.toBeNull()
    // A full-width row, not a bare icon squeezed next to the panel entry.
    expect(box?.width).toBeGreaterThan(200)
    expect(box?.height).toBeGreaterThanOrEqual(30)

    // The plugin's issued stylesheet rule: the column stack that keeps two
    // footer entries on separate rows (issue #2).
    const direction = await page.locator('[data-slot="sidebar.footer.action"]').evaluate(
      slot => (slot.parentElement === null ? '' : getComputedStyle(slot.parentElement).flexDirection),
    )
    expect(direction).toBe('column')
  })

  it('writes no inline geometry on the row or its ancestors (issue #1 contract)', async () => {
    // The contract is about geometry, not about `style` existing at all: framework
    // wrappers may carry unrelated inline styles. What the plugin must never do is
    // stretch or squeeze the sidebar through inline sizing.
    const offenders = await opened.page.getByRole('button', { name: 'MD 笔记' }).evaluate((entry) => {
      const geometry = /(^|;)\s*(width|min-width|max-width|flex|flex-basis|flex-grow|flex-shrink)\s*:/u
      const chain: Element[] = []
      for (let node: Element | null = entry; node !== null; node = node.parentElement) {
        chain.push(node)
        if (node.getAttribute('data-slot') === 'sidebar.footer.action') break
      }
      return chain
        .map(node => ({ tag: node.tagName, style: node.getAttribute('style') ?? '' }))
        .filter(candidate => geometry.test(candidate.style))
    })
    expect(offenders).toEqual([])
  })

  it('stays reachable as a rail icon once the sidebar is collapsed', async () => {
    const { page } = opened
    await page.getByRole('button', { name: '收起侧边栏' }).click()
    const entry = page.getByRole('button', { name: 'MD 笔记' })
    await entry.waitFor({ state: 'visible', timeout: 10_000 })
    // The width transition is animated, so poll instead of sampling once.
    await expect.poll(async () => (await entry.boundingBox())?.width ?? Number.POSITIVE_INFINITY, { timeout: 10_000 })
      .toBeLessThan(100)
    // The accessible name survives the rail layout; the visible label does not.
    expect((await entry.textContent())?.trim()).toBe('')
  })
})
