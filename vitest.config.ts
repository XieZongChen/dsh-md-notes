import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Plugin } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'

/**
 * One link-deps symlink, used to locate both the harness checkout and its own
 * installed React copy. `npm run link-deps` creates it; CI does not.
 */
const LINKED_HARNESS_PACKAGE = fileURLToPath(
  new URL('./node_modules/@deepseek-ai/dsh-client-ui-renderer/', import.meta.url),
)

/**
 * Re-resolve a specifier the way Vite leaves it to Node once it is externalized.
 *
 * Harness sources reached through {@link dshSourceResolution} live outside this
 * project root, so their bare imports of plain npm packages can be handed to
 * Node's ESM resolver, which does not guess extensions — pnpm-linked packages
 * such as `use-sync-external-store/shim/with-selector` (imported without its
 * `.js`) then fail. Node's *CommonJS* resolver does guess, so when ESM
 * resolution fails and CommonJS resolution succeeds, that file path is the
 * intended target. Specifiers that resolve as ESM (every `exports`-mapped
 * package) are left untouched, so module identity and interop are unchanged.
 * @param source - the bare specifier as written.
 * @param importer - absolute path of the importing module.
 * @returns absolute file path to use, or undefined to keep normal resolution.
 */
function resolveLikeNodeWould(source: string, importer: string): string | undefined {
  try {
    // Throws when the specifier needs the CommonJS extension guessing below.
    import.meta.resolve(source, pathToFileURL(importer).href)
    return undefined
  } catch {
    try {
      return createRequire(importer).resolve(source)
    } catch {
      return undefined
    }
  }
}

/**
 * Resolve `@deepseek-ai/*` runtime specifiers to the linked deepseek-harness
 * **source** instead of the installed `lib/` build.
 *
 * Why this exists: dsh client *plugin* packages ship `lib/client.js` wrapped in
 * `window.__ModuleLoader__.load({ id, factory })`, a browser module-loader
 * envelope that exports nothing to Node — importing it under vitest yields an
 * empty namespace (`Cannot read properties of undefined (reading 'load')`). The
 * harness itself never hits this because its `tsconfig.base.json` `paths`
 * facade points every `@deepseek-ai/dsh-*` specifier at `packages/**\/src`, and
 * its vitest configs consume that facade through `vite-tsconfig-paths`. This
 * plugin is the same idea, scoped to the specifiers this repo's browser-lane
 * specs reach and driven by the symlinks `npm run link-deps` already creates.
 *
 * Packages without a source entry fall through to normal resolution, so the
 * consequence is that the browser lane needs the harness checkout — unlike the
 * hermetic Node lane, which never imports dsh runtime code.
 * @returns the pre-resolution plugin.
 */
function dshSourceResolution(): Plugin {
  const scopeDir = fileURLToPath(new URL('./node_modules/@deepseek-ai/', import.meta.url))
  return {
    name: 'dsh-md-notes:dsh-source-resolution',
    enforce: 'pre',
    resolveId(source: string, importer: string | undefined): string | undefined {
      if (!source.startsWith('@deepseek-ai/')) {
        if (importer === undefined || source.startsWith('.') || source.startsWith('node:')) return undefined
        // React specifiers belong to the `resolve.alias` pin below; resolving
        // them here would pick the checkout's copy before the alias sees them.
        if (/^react(?:-dom)?(?:\/|$)/.test(source)) return undefined
        return resolveLikeNodeWould(source, importer)
      }
      const rest = source.slice('@deepseek-ai/'.length)
      const slash = rest.indexOf('/')
      const name = slash === -1 ? rest : rest.slice(0, slash)
      const sub = slash === -1 ? '' : rest.slice(slash + 1)
      const pkgDir = join(scopeDir, name)
      // A subpath already under `src/` (the harness's own specifier style, e.g.
      // `@deepseek-ai/dsh-client-ui-renderer/src/client/bind.ts`) is used as-is.
      const candidates = sub === ''
        ? ['src/index.ts', 'src/index.tsx']
        : sub.startsWith('src/')
          ? [sub, `${sub}.ts`, `${sub}.tsx`, `${sub}/index.ts`, `${sub}/index.tsx`]
          : [`src/${sub}.ts`, `src/${sub}.tsx`, `src/${sub}/index.ts`, `src/${sub}/index.tsx`]
      return candidates.map(candidate => join(pkgDir, candidate)).find(existsSync)
    },
  }
}

/**
 * Vitest's default `server.deps.external` rule (`/node_modules/`) would
 * externalize harness sources in their link-deps symlink spelling, and an
 * externalized module's imports go to Node's ESM loader instead of Vite — which
 * can load neither a `window.__ModuleLoader__` client bundle nor a pnpm-linked
 * extensionless specifier. Simultaneously, a dependency's non-script asset
 * (katex's CSS is the one this bench reaches) must stay in Vite's pipeline, or
 * Node rejects its file extension. The rule below keeps `@deepseek-ai/*` and
 * every non-script file inlined, and leaves the rest of `node_modules` external.
 * @returns the external rule to install.
 */
function harnessExternalRule(): RegExp {
  return /\/node_modules\/(?!@deepseek-ai\/).*\.(?:m?js|cjs)$/
}

/**
 * Absolute path of one React entry point, taken from the harness checkout.
 *
 * Harness sources resolve React from the checkout's own pnpm store while this
 * repo has its own copy; two React instances make every hook call fail with a
 * null dispatcher (`react-dom` renders with one copy, `useContext` reads the
 * other). The renderer's copy therefore wins for both sides. Without a linked
 * checkout there is no browser lane, so this repo's copy is the fallback.
 * @param pkg - `react` or `react-dom`.
 * @param entry - file name inside the package.
 * @returns absolute file path of the entry point.
 */
function reactEntryPoint(pkg: string, entry: string): string {
  const resolve = (from: string): string => join(dirname(createRequire(from).resolve(`${pkg}/package.json`)), entry)
  try {
    return resolve(LINKED_HARNESS_PACKAGE)
  } catch {
    return resolve(import.meta.url)
  }
}

/**
 * Vitest config for dsh-md-notes tests.
 *
 * Two lanes share one run:
 * - the **Node lane** covers the pure domain modules (host notes/settings/
 *   keyed-lock/git, client note-links/note-text/search/paths) with no jsdom, no
 *   React and no dsh runtime, and runs everywhere including hermetic CI;
 * - the **browser lane** is marked as such by its `*.dom.test.ts` name plus a
 *   per-file `// @vitest-environment jsdom` comment. It drives plugin UI through
 *   `@deepseek-ai/dsh-client-test-runtime`'s jsdom bench (real SlotRegistry and
 *   renderer) against harness **source**, so it needs the checkout that
 *   `npm run link-deps` links and is excluded when that checkout is absent —
 *   see docs/smoke-test.md for the local verification route.
 */
export default defineConfig({
  plugins: [dshSourceResolution()],
  resolve: {
    alias: [
      { find: /^react$/, replacement: reactEntryPoint('react', 'index.js') },
      { find: /^react\/jsx-runtime$/, replacement: reactEntryPoint('react', 'jsx-runtime.js') },
      { find: /^react\/jsx-dev-runtime$/, replacement: reactEntryPoint('react', 'jsx-dev-runtime.js') },
      { find: /^react-dom$/, replacement: reactEntryPoint('react-dom', 'index.js') },
      { find: /^react-dom\/client$/, replacement: reactEntryPoint('react-dom', 'client.js') },
      { find: /^react-dom\/test-utils$/, replacement: reactEntryPoint('react-dom', 'test-utils.js') },
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: existsSync(join(LINKED_HARNESS_PACKAGE, 'src'))
      ? configDefaults.exclude
      : [...configDefaults.exclude, 'src/**/*.dom.test.ts'],
    environment: 'node',
    server: {
      deps: { external: [harnessExternalRule()] },
    },
  },
})
