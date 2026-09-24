/**
 * Minimal pixel-baseline helper for the Playwright lane.
 *
 * The repo has one test runner (vitest), so `@playwright/test`'s
 * `toHaveScreenshot` is not available; this does the same job with `pixelmatch`
 * over PNG buffers. Baselines are committed files under `e2e/baseline/` and are
 * **machine-specific** (font rasterization), which is why this lane is local —
 * the same reason the jsdom lane is local (docs/smoke-test.md).
 *
 * Recording: a missing baseline is written and reported, so the first run of a
 * new scenario does not fail. Refresh on purpose with
 * `DSH_E2E_UPDATE_BASELINE=1 npm run test:e2e`.
 * @module dsh-md-notes/e2e/pixel
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { REPO_ROOT } from './scaffold.ts'

/** Fraction of differing pixels tolerated (antialiasing on text edges). */
const MAX_DIFF_RATIO = 0.002

/** Baseline directory for this lane. */
export const BASELINE_DIR = join(REPO_ROOT, 'e2e/baseline')

/**
 * Compare a screenshot with its committed baseline, or record it.
 * @param name - baseline file name (e.g. `manager.png`).
 * @param actual - PNG bytes from `page.screenshot()`.
 * @returns the differing-pixel ratio (0 when recorded or identical).
 * @throws when the difference exceeds {@link MAX_DIFF_RATIO}, after writing the
 *   actual and diff images next to the baseline for inspection.
 */
export async function compareOrRecord(name: string, actual: Buffer): Promise<number> {
  const path = join(BASELINE_DIR, name)
  await mkdir(dirname(path), { recursive: true })
  const update = process.env.DSH_E2E_UPDATE_BASELINE === '1'
  if (update || !existsSync(path)) {
    await writeFile(path, actual)
    console.log(`e2e: ${update ? 'refreshed' : 'recorded'} baseline ${name}`)
    return 0
  }

  const expected = PNG.sync.read(await readFile(path))
  const received = PNG.sync.read(actual)
  if (expected.width !== received.width || expected.height !== received.height) {
    throw new Error(`e2e: ${name} changed size: baseline ${expected.width}x${expected.height}, actual ${received.width}x${received.height}`)
  }
  const diff = new PNG({ width: expected.width, height: expected.height })
  const differing = pixelmatch(expected.data, received.data, diff.data, expected.width, expected.height, { threshold: 0.1 })
  const ratio = differing / (expected.width * expected.height)
  if (ratio > MAX_DIFF_RATIO) {
    const actualPath = join(BASELINE_DIR, name.replace(/\\.png$/u, '.actual.png'))
    const diffPath = join(BASELINE_DIR, name.replace(/\\.png$/u, '.diff.png'))
    await writeFile(actualPath, actual)
    await writeFile(diffPath, PNG.sync.write(diff))
    throw new Error(
      `e2e: ${name} differs in ${(ratio * 100).toFixed(3)}% of pixels (limit ${(MAX_DIFF_RATIO * 100).toFixed(1)}%) — `
      + `see ${actualPath} and ${diffPath}, or refresh with DSH_E2E_UPDATE_BASELINE=1`,
    )
  }
  return ratio
}
