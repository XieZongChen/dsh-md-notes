/**
 * Browser bundle build for dsh-md-notes, replicating the repo's
 * packages/client/tsdown.client.ts protocol: emits lib/client.js as a
 * CJS closure-factory consumed by window.__ModuleLoader__, with CSS Modules
 * compiled to hashed classes and injected as <style data-plugin-css> tags.
 *
 * ─── Protocol coupling points (hand-copied from deepseek-harness; verify
 * each on a dsh upgrade before rebuilding) ─────────────────────────────────
 *
 * 1. CJS closure-factory envelope — banner/footer/intro below. Official
 *    source: packages/client/tsdown.client.ts (~L566-568). Consumer:
 *    packages/client/modules/src/client/system.ts — the HTML-installed
 *    `window.__ModuleLoader__` facade queues until the ClientModuleSystem
 *    boots, then `load(registration)` → `register()` materializes the
 *    factory and claims its injected styles. The id MUST equal the plugin's
 *    client-module id (package name minus any /client suffix).
 *
 * 2. Platform externals — every specifier in PLATFORM_MODULES must appear in
 *    the module table the browser boot provides (rows from dsh.client.inject
 *    in package.json + the default client externals). An external that the
 *    table cannot answer fails at materialization. Official source:
 *    packages/client/tsdown.client.ts (`defaultClientExternals` /
 *    `resolveExternals`) and packages/client/web/src/boot.ts (row assembly).
 *
 * 3. CSS Modules injection — a .module.css import must emit the compiled CSS
 *    as a `<style data-plugin="dsh-md-notes" data-plugin-css="<tagId>">` tag
 *    (tagId unique per file) plus the class-name map. Consumer:
 *    packages/client/modules/src/client/system.ts `claimStyles` — tags
 *    without data-plugin are claimed wholesale, `data-plugin-css` values are
 *    the per-file inventory used for HMR style removal on unload. Hash
 *    pattern `[hash]_[local]` matches the official `dsh-css-modules-inline`
 *    plugin (tsdown.client.ts ~L508).
 *
 * 4. Entry/output contract — lib/client.js (this file's entry maps the tsc
 *    client-program output lib/client/index.js) is what package.json
 *    `exports["./client"]` points at and what dsh-client-modules scans;
 *    moving it breaks the plugin's client half silently.
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, resolve as resolvePath, sep } from 'node:path'
import { transform } from 'lightningcss'

const PLATFORM_MODULES = [
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-slots/client',
  '@deepseek-ai/dsh-client-ui-slots/types',
  '@deepseek-ai/dsh-client-ui-chat',
  '@deepseek-ai/dsh-client-ui-chat/client',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-conversation/client',
  '@deepseek-ai/dsh-client-ui-input-trigger',
  '@deepseek-ai/dsh-client-ui-input-trigger/client',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-sidebar/client',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-layout/client',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis/types',
  'react',
  'react/jsx-runtime',
  'react-dom',
]

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/**
 * Resolve an emitted JS asset import against its source-tree counterpart.
 * tsc emits src/client/x.module.css imports from lib/client/...; this maps
 * the lib/client prefix back to src/client so the CSS module is found.
 */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  // Strip a trailing /lib/client segment and re-append under src/client.
  const segments = emitted.split(sep)
  const libIdx = segments.lastIndexOf('lib')
  if (libIdx < 0 || segments[libIdx + 1] !== 'client') return emitted
  const rest = segments.slice(libIdx + 2).join(sep)
  return resolvePath(segments.slice(0, libIdx).join(sep) || sep, 'src', 'client', rest)
}

export default {
  name: 'dsh-md-notes/client',
  entry: { client: 'lib/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: PLATFORM_MODULES,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  noExternal: (id) => (PLATFORM_MODULES.includes(id) ? undefined : true),
  plugins: [
    {
      name: 'dsh-md-notes-css-modules',
      resolveId(source, importer) {
        if (!source.endsWith('.module.css')) return null
        const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
        return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const source = readFileSync(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap: Record<string, string> = {}
        for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
        const tagId = `dsh-md-notes/${basename(fileId)}`
        return [
          `const css = ${JSON.stringify(code.toString())};`,
          `const tagId = ${JSON.stringify(tagId)};`,
          `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {`,
          `  const tag = document.createElement('style');`,
          `  tag.dataset.plugin = 'dsh-md-notes';`,
          `  tag.dataset.pluginCss = tagId;`,
          `  tag.textContent = css;`,
          `  document.head.appendChild(tag);`,
          '}',
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      },
    },
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-md-notes", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}
