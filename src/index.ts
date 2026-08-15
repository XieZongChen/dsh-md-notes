/**
 * dsh-md-notes host half plugin entry: a bundle plugin that serves the notes
 * API over the webServer HTTP route. Notes live as .md files under the notes
 * directory (with a meta.json sidecar for titles/updatedAt). The browser half
 * fetches this API; no typert/Remote toolchain is required.
 *
 * Domain logic lives in `notes.ts`; HTTP helpers and the route handler in
 * `http.ts`. This file only declares the plugin contract.
 * @module dsh-md-notes
 */

import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
// Declaration-merge triggers so ctx.webServer / ctx.sessions types are visible.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'
import { notesDir } from './host/notes.ts'
import { iconHandler, notesApiHandler } from './host/http.ts'

/** Plugin row config. */
export interface Config {
  /** Notes directory; an explicit root wins over the `<cwd>/.dsh-notes` default. */
  readonly root?: string
  /** API route prefix (default /plugins/md-notes). */
  readonly route?: string
}

export const name = 'md-notes'
export const inject = ['webServer']
export const Config: s<Config> = s.object({
  root: s.string().default('.dsh-notes'),
  route: s.string().default('/plugins/md-notes'),
})

/** Minimal shape of the webServer route registration used here. */
interface WebServerLike {
  register(route: {
    kind: string
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/** Plugin body. */
export function apply(ctx: Context, config: Config): void {
  const web = ctx.get('webServer') as WebServerLike | undefined
  if (web === undefined) return

  const dir = notesDir(config.root)
  const prefix = config.route ?? '/plugins/md-notes'
  const handler = notesApiHandler(dir, ctx.get('sessionQuery'))
  // lib/../assets/dsh-md-notes.svg — the packaged icon, served as-is.
  const iconPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..', 'assets', 'dsh-md-notes.svg',
  )

  ctx.effect(() => web.register({
    kind: 'prefix',
    path: prefix,
    handler,
  }), 'dsh-md-notes: api route')
  ctx.effect(() => web.register({
    kind: 'exact',
    path: `${prefix}/icon.svg`,
    handler: iconHandler(iconPath),
  }), 'dsh-md-notes: icon route')
}
