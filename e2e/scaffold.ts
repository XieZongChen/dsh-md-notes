/**
 * Playwright lane scaffold: boot an **isolated** `dsh web` instance — its own
 * `DSH_HOME`, its own OS-assigned port, no browser handoff — with this plugin
 * installed from the repo, then drive it with headless Chromium.
 *
 * Why isolated rather than the developer's own GUI: these specs click, type and
 * (in settings) write plugin state; sharing the running profile would mutate real
 * notes and could race the human's session. `DSH_HOME` also gives the plugin a
 * deterministic world — one seeded workspace, no other plugins' noise.
 *
 * Why the harness checkout's CLI: the npm-published `@deepseek-ai/dsh` CLI cannot
 * boot from an npm install — its bundle peers (`@deepseek-ai/cordis-plugin-group`
 * and friends) are peerDependencies, so `--legacy-peer-deps` leaves them out. The
 * checkout is already a prerequisite of this repo (link-deps for types, and the
 * jsdom lane for its source), and its built CLI is version-matched to the plugin's
 * `engines.dsh` target. `e2e/global-setup.ts` owns the one directory that must
 * exist before the first run; everything else here is per-test.
 * @module dsh-md-notes/e2e/scaffold
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'

/** Locale the specs assert copy in; the page is told to prefer it. */
export const LOCALE = 'zh-CN'

/** Repository root (this file lives in `<root>/e2e/`). */
export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Repo-local, gitignored home for this lane: browsers, profile, seeded state. */
export const E2E_ROOT = join(REPO_ROOT, '.e2e')

/** Isolated harness home — the profile inside it carries this plugin. */
export const DSH_HOME = join(E2E_ROOT, 'home')

/** Repo-local browser cache (`PLAYWRIGHT_BROWSERS_PATH`), so nothing lands in ~/Library. */
export const BROWSERS_PATH = join(E2E_ROOT, 'browsers')

/**
 * Documents directory the isolated instance is told to use (profile patch,
 * `workspace-controller.documentsDirectory`). Inside the repo on purpose: on
 * first use the Host creates `<documents>/deepseek-harness/<title>` for the
 * default Workspace, and the real `~/Documents` is outside everything this
 * sandbox may write — the app would answer "无法创建默认工作区" and the plugin
 * would have no workspace to list.
 */
export const DOCUMENTS_DIR = join(E2E_ROOT, 'documents')

/** Timestamp every seeded note gets, so listed times are stable (see `utimes` below). */
const SEEDED_NOTE_MTIME = new Date('2026-01-02T03:04:05Z')

/** Title (and therefore directory name) of the default Workspace, per page locale. */
export const DEFAULT_WORKSPACE_TITLE = LOCALE.toLowerCase().startsWith('zh') ? '默认工作区' : 'default-workspace'

/**
 * The seeded workspace: exactly where the Host's first-use initialization puts it.
 * @returns absolute path of the workspace directory.
 */
export function defaultWorkspaceDir(): string {
  return join(DOCUMENTS_DIR, 'deepseek-harness', DEFAULT_WORKSPACE_TITLE)
}

/**
 * Resolve the deepseek-harness checkout through the link-deps symlink, so
 * `DSH_CHECKOUT` overrides keep working.
 * @returns absolute path of the checkout root.
 * @throws when the dependency links are absent (the lane's documented prerequisite).
 */
export function harnessCheckout(): string {
  const linked = join(REPO_ROOT, 'node_modules/@deepseek-ai/dsh-client-ui-renderer')
  if (!existsSync(linked)) {
    throw new Error('e2e: harness dependencies are not linked — run `npm run link-deps` first')
  }
  return join(realpathSync(linked), '..', '..', '..')
}

/**
 * Entry of the checkout's built CLI.
 * @returns absolute path of `apps/cli/lib/bin.js`.
 * @throws when the checkout has not been built.
 */
export function dshCliEntry(): string {
  const entry = join(harnessCheckout(), 'apps/cli/lib/bin.js')
  if (!existsSync(entry)) {
    throw new Error(`e2e: the harness CLI is not built at ${entry} — build the checkout once`)
  }
  return entry
}

/**
 * Environment every spawned dsh process gets: the isolated home plus the
 * checkout's `.bin` on PATH (plugin management shells out to pnpm).
 * @returns the child environment.
 */
function harnessEnv(): NodeJS.ProcessEnv {
  const bin = join(harnessCheckout(), 'node_modules/.bin')
  return {
    ...process.env,
    DSH_HOME,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    // A placeholder official credential: with no usable provider the shell raises
    // a blocking first-run API-key modal whose mask swallows every click. These
    // specs configure no model and make no model call, so a dummy value only
    // silences that prompt. (The harness's own onboarding specs deliberately run
    // keyless because the prompt IS their subject; this lane is not about it.)
    DEEPSEEK_API_KEY: process.env.DSH_E2E_DEEPSEEK_API_KEY ?? 'dsh-md-notes-e2e-placeholder',
  }
}

/** One running instance plus the seeded world it serves. */
export interface WebHarness {
  /** Token-bearing URL printed at readiness (`http://127.0.0.1:<port>/?token=…`). */
  url: string
  /** OS-assigned port the instance listens on. */
  port: number
  /** Directory the instance treats as its (auto-initialized) workspace. */
  workspaceDir: string
  /** Stop the instance and delete the seeded world. */
  stop(): Promise<void>
}

const READY_LINE = /dsh web: (http:\/\/\S+)/u

/**
 * Seed a deterministic world and boot the isolated instance in it.
 *
 * With an empty registry and no Sessions, dsh's client auto-initializes a default
 * Workspace inside the configured documents directory; seeding that exact
 * directory beforehand means the instance boots into a workspace the plugin can
 * list, with no UI picking step.
 * @param notes - note files to write into the workspace's `.dsh-notes`.
 * @returns the running instance.
 */
export async function launchWebHarness(notes: Record<string, string> = { 'a.md': '# 笔记 A\n\n第一行\n关键词 在这里\n' }): Promise<WebHarness> {
  const workspaceDir = defaultWorkspaceDir()
  await rm(workspaceDir, { recursive: true, force: true })
  const notesDir = join(workspaceDir, '.dsh-notes')
  await mkdir(notesDir, { recursive: true })
  for (const [name, content] of Object.entries(notes)) {
    const file = join(notesDir, name)
    await writeFile(file, content, 'utf8')
    // A fixed mtime: the manager prints the note's timestamp, and a pixel
    // baseline cannot survive a value that changes every run.
    await utimes(file, SEEDED_NOTE_MTIME, SEEDED_NOTE_MTIME)
  }

  const child = spawn(process.execPath, [dshCliEntry(), 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd: E2E_ROOT,
    env: harnessEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stopInstance = trackProcess(child)
  try {
    const url = await waitForReady(child)
    return {
      url,
      port: Number(new URL(url).port),
      workspaceDir,
      stop: async () => {
        stopInstance()
        await rm(workspaceDir, { recursive: true, force: true })
      },
    }
  } catch (error) {
    stopInstance()
    await rm(workspaceDir, { recursive: true, force: true })
    throw error
  }
}

/** Tail of a child's output, kept for failure messages. */
const tails = new WeakMap<ChildProcess, string[]>()

/**
 * Wait for the readiness line `dsh web: <url>` the web app prints once its Loader
 * tree settles (the documented supervisor signal), and fail with the captured
 * output when the process dies or the wait expires.
 * @param child - the spawned web process.
 * @returns the token-bearing URL.
 */
function waitForReady(child: ChildProcess): Promise<string> {
  const tail: string[] = []
  tails.set(child, tail)
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`dsh web did not report readiness within 60s:\n${tail.join('')}`))
    }, 60_000)
    const onChunk = (chunk: Buffer): void => {
      const text = chunk.toString()
      tail.push(text)
      if (tail.length > 40) tail.shift()
      const match = READY_LINE.exec(text)
      if (match?.[1] !== undefined) {
        clearTimeout(timeout)
        resolve(match[1])
      }
    }
    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`dsh web exited with ${String(code)} before readiness:\n${tail.join('')}`))
    })
  })
}

/**
 * Kill a spawned instance on one axis: SIGTERM, then SIGKILL when it lingers.
 * @param child - the spawned web process.
 * @returns an idempotent stopper.
 */
function trackProcess(child: ChildProcess): () => void {
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    const timer = setTimeout(() => { child.kill('SIGKILL') }, 5_000)
    child.once('exit', () => { clearTimeout(timer) })
    timer.unref()
  }
}

/** A page plus its context, both closed by {@link closePage}. */
export interface HarnessPage {
  page: Page
  context: BrowserContext
}

/**
 * Open one page on the harness: a fixed viewport/DPR (pixel baselines need both),
 * the asserted locale, animations off, and the token URL exchanged for a cookie.
 * @param browser - launched Chromium.
 * @param url - token-bearing URL from {@link launchWebHarness}.
 * @returns the page and its context.
 */
export async function openHarnessPage(browser: Browser, url: string): Promise<HarnessPage> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: LOCALE,
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'load' })
  await settleHarnessPage(page)
  return { page, context }
}

/**
 * Bring a page to the lane's ready state: shell rendered, first-use prompts gone,
 * the seeded workspace answering through the plugin's own route, no mask left.
 *
 * The token in the page URL is exchanged for the session cookie by the root
 * redirect, so a reload returns to the same authenticated shell — which is what
 * {@link resetHarnessPage} relies on to give every case an independent start.
 * `networkidle` is deliberately not used: the client keeps long-lived streams open.
 * @param page - the harness page.
 */
export async function settleHarnessPage(page: Page): Promise<void> {
  await waitForShell(page)
  await dismissFirstUseModals(page)
  await waitForSeededWorkspace(page)
  await waitForUnobstructed(page)
}

/**
 * Reload a page back to the ready state, so cases sharing one context never
 * inherit the previous case's open panel or typed query.
 * @param page - the harness page.
 */
export async function resetHarnessPage(page: Page): Promise<void> {
  await page.reload({ waitUntil: 'load' })
  await settleHarnessPage(page)
}

/**
 * Wait for the web shell to render: the sidebar's footer slot is part of the
 * always-present layout, so its appearance means the client roster booted.
 * @param page - the harness page.
 */
export async function waitForShell(page: Page): Promise<void> {
  await page.locator('[data-slot="sidebar.footer.action"]').waitFor({ state: 'attached', timeout: 30_000 })
}

/**
 * Close the one-time modals a fresh dsh home shows (beta notice, API-key prompt).
 * They render as full-page masks in `role="presentation"` subtrees — the API-key
 * one carries no `dialog` role at all — so dismissal targets their action buttons.
 * Everything behind a mask, including the plugin's sidebar entry, is unreachable
 * until it is gone. An older home has acknowledged them, so this is a no-op then.
 * @param page - the harness page.
 */
export async function dismissFirstUseModals(page: Page): Promise<void> {
  for (const action of ['继续', '稍后配置']) {
    const button = page.getByRole('button', { name: action })
    if (await button.isVisible().catch(() => false)) {
      await button.click()
      await page.waitForTimeout(500)
    }
  }
}

/**
 * Dismiss first-use modals until nothing masks the page.
 *
 * The prompts chain and remount asynchronously (the API-key one appears once the
 * workspace, and with it the composer, exists), so a single pass races them. Each
 * round dismisses whatever is up and re-checks the mask this lane's primitives
 * render.
 * @param page - the harness page.
 * @param timeoutMs - how long to keep trying before failing loudly.
 */
export async function waitForUnobstructed(page: Page, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await page.locator('div[aria-hidden="true"][class*="mask"]').count() === 0) return
    await dismissFirstUseModals(page)
    await page.waitForTimeout(400)
  }
  const blocking = await page.locator('[role="presentation"]').evaluateAll(nodes =>
    nodes.map(node => (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)).filter(text => text !== ''))
  throw new Error(`e2e: a first-use modal still masks the page: ${JSON.stringify(blocking)}`)
}

/**
 * Wait until the Host answers the plugin's own `list` route with the seeded
 * workspace.
 *
 * First-use Workspace creation is driven by client navigation and lands *after*
 * the shell renders, so opening the manager too early makes the Host answer
 * "no workspaces" — a race, not a product bug. This polls through the page (real
 * session cookie, real route) until the seeded note is visible, which also proves
 * the whole chain: host plugin loaded, route authorized, notes read from disk.
 * @param page - the harness page.
 * @param timeoutMs - how long to wait before failing.
 */
export async function waitForSeededWorkspace(page: Page, timeoutMs = 45_000): Promise<void> {
  await page.waitForFunction(async () => {
    const response = await fetch('/plugins/md-notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'list' }),
    })
    const body = await response.json() as { ok?: boolean; workspaces?: Array<{ notes?: unknown[] }> }
    return body.ok === true && (body.workspaces ?? []).some(workspace => (workspace.notes ?? []).length > 0)
  }, undefined, { timeout: timeoutMs, polling: 500 })
}

/**
 * Launch the shared Chromium for the browser cache this lane installs into.
 * @returns the browser; callers close it in `afterAll`.
 */
export async function launchChromium(): Promise<Browser> {
  if (!existsSync(BROWSERS_PATH)) {
    throw new Error(`e2e: no browsers at ${BROWSERS_PATH} — run \`npm run e2e:install\` once`)
  }
  return await chromium.launch()
}

/**
 * Close a page's context, ignoring an already-closed one.
 * @param opened - the page opened by {@link openHarnessPage}.
 */
export async function closePage(opened: HarnessPage): Promise<void> {
  await opened.context.close().catch(() => undefined)
}
