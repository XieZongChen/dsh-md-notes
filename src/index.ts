/**
 * dsh-md-notes host half: a bundle plugin that serves the notes API over the
 * webServer HTTP route. Notes live as .md files under the workspace .dsh-notes
 * directory (with a meta.json sidecar for titles/updatedAt). The browser half
 * fetches this API; no typert/Remote toolchain is required.
 * @module dsh-md-notes
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
// Declaration-merge triggers so ctx.webServer / ctx.sessions types are visible.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Plugin row config. */
export interface Config {
  /** Notes directory; relative paths resolve against the process cwd. */
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

const META_NAME = 'meta.json'

interface MetaValue { title?: string; updatedAt?: number }
type Meta = Record<string, MetaValue>

/** Resolve the notes directory. */
function notesDir(config: Config): string {
  // An explicit `root` is the final notes directory; only the default falls
  // back to `<cwd>/.dsh-notes`.
  if (config.root !== undefined && config.root !== '') return config.root
  return join(process.cwd(), '.dsh-notes')
}

function sanitizeName(input: string | undefined): string {
  const base = String(input ?? '').trim().replace(/\.md$/i, '')
  const slug = base
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'note'}.md`
}

async function readMeta(dir: string): Promise<Meta> {
  try {
    const raw = await readFile(join(dir, META_NAME), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return parsed !== null && typeof parsed === 'object'
      ? parsed as Meta
      : {}
  } catch {
    return {}
  }
}

async function writeMeta(dir: string, meta: Meta): Promise<void> {
  try {
    await writeFile(join(dir, META_NAME), JSON.stringify(meta, null, 2), 'utf8')
  } catch {
    /* best-effort */
  }
}

function titleOf(content: string | undefined, fallback: string): string {
  const m = String(content ?? '').match(/^\s*#\s+(.+)$/m)
  return m !== null && m[1] !== undefined && m[1].trim() !== '' ? m[1].trim() : fallback
}

/** Render content blocks to plain markdown text. */
function blocksToText(blocks: readonly unknown[] | undefined): string {
  const parts: string[] = []
  for (const b of blocks ?? []) {
    if (b === null || typeof b !== 'object') continue
    const block = b as { type?: string; text?: string }
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'reasoning' && typeof block.text === 'string') parts.push(`> ${block.text}`)
    else if (block.type === 'image') parts.push('[图片]')
  }
  return parts.join('\n\n').trim()
}

/** Read a JSON request body (bounded). */
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buf.length
    if (size > 2 * 1024 * 1024) throw new Error('body too large')
    chunks.push(buf)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text) as unknown
  } catch {
    return {}
  }
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** One JSON API handler for the notes domain. */
async function handleApi(dir: string, method: string, body: unknown, sessionQuery: SessionQueryEngine | undefined): Promise<unknown> {
  const req = (body ?? {}) as Record<string, unknown>
  switch (method) {
    case 'list': {
      await mkdir(dir, { recursive: true })
      let entries: string[] = []
      try {
        entries = await readdir(dir)
      } catch {
        entries = []
      }
      const meta = await readMeta(dir)
      const notes = entries
        .filter((n) => n.endsWith('.md'))
        .map((n) => ({
          name: n,
          title: meta[n]?.title ?? n.replace(/\.md$/i, ''),
          updatedAt: meta[n]?.updatedAt ?? 0,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
      return { ok: true, notes, dir }
    }
    case 'read': {
      const name = sanitizeName(String(req.name ?? ''))
      await mkdir(dir, { recursive: true })
      let content = ''
      try {
        content = await readFile(join(dir, name), 'utf8')
      } catch {
        /* missing -> empty */
      }
      return { ok: true, name, content }
    }
    case 'write': {
      const name = sanitizeName(String(req.name ?? ''))
      const content = String(req.content ?? '')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, name), content, 'utf8')
      const meta = await readMeta(dir)
      meta[name] = { title: titleOf(content, name.replace(/\.md$/i, '')), updatedAt: Date.now() }
      await writeMeta(dir, meta)
      return { ok: true, name }
    }
    case 'create': {
      const title = String(req.title ?? '').trim() || '未命名笔记'
      const base = sanitizeName(title)
      await mkdir(dir, { recursive: true })
      let name = base
      let i = 2
      for (;;) {
        try {
          await stat(join(dir, name))
          name = `${base.replace(/\.md$/i, '')}-${i}.md`
          i++
        } catch {
          break
        }
      }
      const content = `# ${title}\n\n`
      await writeFile(join(dir, name), content, 'utf8')
      const meta = await readMeta(dir)
      meta[name] = { title, updatedAt: Date.now() }
      await writeMeta(dir, meta)
      return { ok: true, name }
    }
    case 'delete': {
      const name = sanitizeName(String(req.name ?? ''))
      await mkdir(dir, { recursive: true })
      try {
        await rm(join(dir, name), { force: true })
      } catch {
        /* already gone */
      }
      const meta = await readMeta(dir)
      delete meta[name]
      await writeMeta(dir, meta)
      return { ok: true, name }
    }
    case 'appendConversation': {
      const noteName = sanitizeName(String(req.noteName ?? ''))
      const sessionId = String(req.sessionId ?? '')
      const messageId = String(req.messageId ?? '')
      if (!sessionId || !messageId) return { ok: false, error: 'missing session/message id' }
      if (sessionQuery === undefined) return { ok: false, error: 'sessionQuery unavailable' }
      let events: readonly { type?: string; data?: unknown }[] = []
      let title = ''
      try {
        const snap = await sessionQuery.readSession(sessionId as SessionId)
        events = snap.events ?? []
        try {
          const t = await sessionQuery.readTitle(sessionId as SessionId)
          title = t?.title ?? ''
        } catch {
          /* optional */
        }
      } catch {
        return { ok: false, error: 'cannot read session' }
      }
      let userText = ''
      let assistantText = ''
      for (const ev of events) {
        if (ev.type !== 'user/message' && ev.type !== 'assistant/message') continue
        const data = ev.data as {
          content?: readonly unknown[]
          source?: { kind?: string }
          message?: { id?: string; content?: readonly unknown[] }
        } | undefined
        if (data === undefined) continue
        if (ev.type === 'user/message') {
          if (data.source?.kind === 'user') userText = blocksToText(data.content)
        } else if (ev.type === 'assistant/message') {
          if (data.message?.id === messageId) {
            assistantText = blocksToText(data.message.content)
            break
          }
        }
      }
      if (assistantText === '') return { ok: false, error: 'assistant message not found' }
      const stamp = new Date().toLocaleString()
      const section = `\n\n---\n\n## ${stamp}${title ? ` · ${title}` : ''}\n\n**用户**：\n\n${userText || '（无）'}\n\n**DSH**：\n\n${assistantText}\n`
      await mkdir(dir, { recursive: true })
      let content = ''
      try {
        content = await readFile(join(dir, noteName), 'utf8')
      } catch {
        /* new note */
      }
      await writeFile(join(dir, noteName), content + section, 'utf8')
      const meta = await readMeta(dir)
      meta[noteName] = { title: titleOf(content + section, noteName.replace(/\.md$/i, '')), updatedAt: Date.now() }
      await writeMeta(dir, meta)
      return { ok: true, name: noteName }
    }
    default:
      return { ok: false, error: `unknown method: ${method}` }
  }
}

/** Plugin body. */
export function apply(ctx: Context, config: Config): void {
  const web = ctx.get('webServer') as {
    register(route: { kind: string; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void
  } | undefined
  if (web === undefined) return

  const dir = notesDir(config)
  const prefix = config.route ?? '/plugins/md-notes'

  ctx.effect(() => web.register({
    kind: 'prefix',
    path: prefix,
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        const body = await readBody(req)
        const raw = body as { method?: string }
        const method = typeof raw.method === 'string' ? raw.method : ''
        const result = await handleApi(dir, method, body, ctx.get('sessionQuery'))
        sendJson(res, 200, result)
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'dsh-md-notes: api route')
}
