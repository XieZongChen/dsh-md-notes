/**
 * Playwright scenario: the notes manager in a real browser.
 *
 * Covers the parts a jsdom bench cannot show: the manager really covers the
 * shell, the seeded workspace and its note render with host-supplied data, the
 * debounced search paints a real `<mark>` on the hit line, and the whole view is
 * pinned by a pixel baseline (fonts, spacing, scrollbars — everything jsdom
 * stubs out).
 * @module dsh-md-notes/e2e/manager.e2e
 */

import type { Browser, Page } from 'playwright'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { compareOrRecord } from './pixel.ts'
import { closePage, launchChromium, launchWebHarness, openHarnessPage, resetHarnessPage, type HarnessPage, type WebHarness } from './scaffold.ts'

/** The seeded note's title, as the manager lists it. */
const NOTE_TITLE = '笔记 A'

/**
 * Open the manager from the sidebar entry unless it is already up.
 * @param page - the harness page.
 */
async function openManager(page: Page): Promise<void> {
  if (await page.getByPlaceholder('搜索全部工作区…').isVisible().catch(() => false)) return
  await page.getByRole('button', { name: 'MD 笔记' }).click()
  await page.getByPlaceholder('搜索全部工作区…').waitFor({ state: 'visible', timeout: 20_000 })
}

describe('notes manager (real browser)', () => {
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

  it('opens from the sidebar entry and lists the seeded workspace and note', async () => {
    const { page } = opened
    await openManager(page)
    await expect.poll(() => page.getByText(NOTE_TITLE).count(), { timeout: 20_000 }).toBeGreaterThan(0)
    expect(await page.getByText('默认工作区').count()).toBeGreaterThan(0)
  })

  it('paints the debounced search hit with its line number and highlight', async () => {
    const { page } = opened
    await openManager(page)
    await page.getByPlaceholder('搜索全部工作区…').fill('关键词')
    // The seeded note puts 关键词 on line 4 ('# 笔记 A' / '' / '第一行' / '关键词 在这里').
    await page.getByText('L4').waitFor({ state: 'visible', timeout: 20_000 })
    expect(await page.locator('mark', { hasText: '关键词' }).count()).toBeGreaterThan(0)
    expect(await page.getByText('1 处命中').count()).toBeGreaterThan(0)
    await page.getByPlaceholder('搜索全部工作区…').fill('')
    await page.getByText(NOTE_TITLE).first().waitFor({ state: 'visible', timeout: 10_000 })
  })

  it('matches the recorded pixel baseline', async () => {
    const { page } = opened
    await openManager(page)
    // Fixed viewport, DPR 1, reduced motion and a fixed note mtime (scaffold) are
    // what make this comparable at all; the baseline itself is machine-specific.
    const ratio = await compareOrRecord('manager.png', await page.screenshot())
    expect(ratio).toBeLessThanOrEqual(0.01)
  })
})
