/**
 * Browser bundle build for dsh-md-notes, replicating the repo's
 * packages/client/tsdown.client.ts protocol: emits lib/client.js as a
 * CJS closure-factory consumed by window.__ModuleLoader__.
 */

const PLATFORM_MODULES = [
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-runtime/types',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-slots/client',
  '@deepseek-ai/dsh-client-ui-slots/types',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-conversation/client',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-sidebar/client',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-layout/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis/types',
  'react',
  'react/jsx-runtime',
  'react-dom',
]

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
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-md-notes", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}
