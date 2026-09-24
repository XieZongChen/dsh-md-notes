/**
 * Playwright scenario: the plugin's settings section inside the real settings
 * panel.
 *
 * Why this seat: the dsh 0.1.7 settings API change (`SettingsForms` replacing
 * `settings.register`) once took the whole host plugin down silently, and the
 * section is otherwise only eyeballed (docs/smoke-test.md §8). The jsdom lane
 * covers the form's own load/save logic; this lane proves the section is
 * reachable and rendered by the shipped panel — including the nav label it is
 * filed under.
 *
 * The second case covers the manager's 「设置」 shortcut: it used to build
 * `button[aria-haspopup="dialog"]:not([aria-label])`, which stopped matching on dsh
 * 0.1.7-rc.1 (that trigger gained an `aria-label`) and left the shortcut dead. The
 * fix anchors on `[data-slot="sidebar.settings"]` instead, and this case fails if
 * either half of the two-click simulation breaks again (coding-standards §12 #25).
 * @module dsh-md-notes/e2e/settings.e2e
 */

import type { Browser, Page } from 'playwright'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closePage, launchChromium, launchWebHarness, openHarnessPage, resetHarnessPage, type HarnessPage, type WebHarness } from './scaffold.ts'

/** Nav cell our section is filed under (`git.settingsNav`). */
const SECTION_LABEL = 'MD 笔记'

/**
 * Open the shipped settings panel and select our section.
 * @param page - the harness page.
 */
async function openOurSection(page: Page): Promise<void> {
  await page.getByRole('button', { name: '设置' }).first().click()
  const cell = page.locator('nav button').filter({ hasText: SECTION_LABEL }).first()
  await cell.waitFor({ state: 'visible', timeout: 20_000 })
  await cell.click()
  await page.getByRole('button', { name: '保存设置' }).waitFor({ state: 'visible', timeout: 20_000 })
}

describe('settings section (real browser)', () => {
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

  it('renders the git form under its nav label with the stored values', async () => {
    const { page } = opened
    await openOurSection(page)
    // The mode select shows the stored mode and the hint follows it.
    expect(await page.getByText('Git 同步').count()).toBeGreaterThan(0)
    expect(await page.getByText('笔记保存在哪里').count()).toBeGreaterThan(0)
    expect(await page.getByLabel('打开笔记时自动拉取远程').count()).toBeGreaterThan(0)
    expect(await page.getByRole('button', { name: '保存设置' }).count()).toBe(1)
  })

  it('reaches our section from the manager shortcut', async () => {
    const { page } = opened
    await page.getByRole('button', { name: 'MD 笔记' }).click()
    await page.locator('button[title="设置"]').first().click()
    await page.getByRole('button', { name: '保存设置' }).waitFor({ state: 'visible', timeout: 15_000 })
    expect(await page.getByText('笔记保存在哪里').count()).toBeGreaterThan(0)
  })
})
