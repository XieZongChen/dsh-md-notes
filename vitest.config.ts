import { defineConfig } from 'vitest/config'

/**
 * Vitest config for dsh-md-notes unit tests. Tests cover the pure domain
 * modules (host notes/settings/keyed-lock/git + client note-links/note-text),
 * which need only a Node environment — no jsdom, no React, no dsh runtime.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
