import { defineConfig } from 'vitest/config'

/**
 * Vitest config for the **Playwright lane** (`e2e/**\/*.e2e.ts`).
 *
 * Separate from `vitest.config.ts` on purpose: these specs boot a real `dsh web`
 * instance and a real Chromium, so they are slow, serial, and need a one-time
 * preparation (`e2e/global-setup.ts` rebuilds the plugin, installs it into an
 * isolated `DSH_HOME`, and checks the repo-local browser). `npm test` and CI stay
 * on the jsdom lane; run this one with `npm run test:e2e`.
 *
 * `PLAYWRIGHT_BROWSERS_PATH` must point at `.e2e/browsers` (the npm script does
 * it) because the shared `~/Library/Caches` location is outside this repo.
 */
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    environment: 'node',
    globalSetup: ['e2e/global-setup.ts'],
    // A cold instance (profile link + native boot) takes seconds; a failing boot
    // is bounded by the scaffold's own 60s readiness timeout.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // One instance at a time: each spec owns a `DSH_HOME`-isolated world, and the
    // shared browser cache is single-writer during install.
    fileParallelism: false,
  },
})
