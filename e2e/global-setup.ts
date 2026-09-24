/**
 * One-time preparation for the Playwright lane, run before any spec:
 * rebuild the plugin (the isolated profile links this repo, so `lib/` is what the
 * browser is served), install it into the isolated profile on first use, and check
 * that the repo-local Chromium exists.
 *
 * Everything here is cached: the build is incremental, and the profile install is
 * skipped once `dsh-md-notes` is in the profile's dependencies.
 * @module dsh-md-notes/e2e/global-setup
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { BROWSERS_PATH, DOCUMENTS_DIR, DSH_HOME, REPO_ROOT, dshCliEntry, harnessCheckout } from './scaffold.ts'

/** Marks the block this lane owns inside the profile's patch layer. */
const PATCH_MARKER = '# --- dsh-md-notes e2e (managed) ---'

/**
 * Point first-use workspace creation at the repo-local documents directory.
 *
 * The Host creates the default Workspace under the system Documents folder unless
 * `workspace-controller.documentsDirectory` says otherwise; the real one lives
 * outside everything this repo may write, so the app would report
 * "无法创建默认工作区" and there would be no workspace for the plugin to list. The
 * patch layer is the documented override point, and this file is generated state
 * inside the gitignored `.e2e/home`, so owning a marked block in it is safe.
 */
function ensureDocumentsDirectoryPatch(): void {
  const patch = join(DSH_HOME, 'profiles/web/cordis.patch.yml')
  const existing = existsSync(patch) ? readFileSync(patch, 'utf8') : ''
  const withoutManaged = existing.split(PATCH_MARKER)[0] ?? ''
  writeFileSync(patch, [
    withoutManaged.trimEnd(),
    '',
    PATCH_MARKER,
    '- id: workspace-controller',
    '  config:',
    `    documentsDirectory: ${DOCUMENTS_DIR}`,
    '',
  ].join('\n'), 'utf8')
}

/**
 * Run a command to completion, forwarding its output on failure.
 * @param command - executable.
 * @param args - arguments.
 * @param env - extra environment for the child.
 */
async function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { cwd: REPO_ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${String(code)}:\n${output}`))
    })
  })
}

/** Whether the isolated profile already links this plugin. */
function profileHasPlugin(): boolean {
  const manifest = join(DSH_HOME, 'profiles/web/package.json')
  if (!existsSync(manifest)) return false
  try {
    const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { dependencies?: Record<string, string> }
    return parsed.dependencies?.['dsh-md-notes'] !== undefined
  } catch {
    return false
  }
}

export default async function setup(): Promise<void> {
  if (!existsSync(join(BROWSERS_PATH, 'chromium-1228'))) {
    throw new Error(
      `e2e: Chromium is missing from ${BROWSERS_PATH} — run \`npm run e2e:install\` once (it downloads ~170 MB into the repo).`,
    )
  }

  await run('npm', ['run', 'build'])

  if (!profileHasPlugin()) {
    const bin = join(harnessCheckout(), 'node_modules/.bin')
    await run(process.execPath, [dshCliEntry(), 'plugin', '--profile', 'web', 'add', REPO_ROOT], {
      DSH_HOME,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
    })
  }

  mkdirSync(DOCUMENTS_DIR, { recursive: true })
  ensureDocumentsDirectoryPatch()
}
