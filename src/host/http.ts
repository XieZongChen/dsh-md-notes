/**
 * HTTP helpers and the API route handler assembly for the notes domain.
 * @module dsh-md-notes/http
 */

import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import {
  appendConversation, createNote, deleteNote, listNotes, readNote, writeNote,
} from './notes.ts'

/** Read a JSON request body (bounded). */
export async function readBody(req: IncomingMessage): Promise<unknown> {
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

/** Write a JSON response. */
export function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** Dispatch one `{ method, ...args }` body to the notes domain. */
async function handleApi(
  dir: string,
  method: string,
  body: unknown,
  sessionQuery: SessionQueryEngine | undefined,
): Promise<unknown> {
  const req = (body ?? {}) as Record<string, unknown>
  switch (method) {
    case 'list':
      return listNotes(dir)
    case 'read':
      return readNote(dir, String(req.name ?? ''))
    case 'write':
      return writeNote(dir, String(req.name ?? ''), String(req.content ?? ''))
    case 'create':
      return createNote(dir, String(req.title ?? ''))
    case 'delete':
      return deleteNote(dir, String(req.name ?? ''))
    case 'appendConversation':
      return appendConversation(
        dir,
        String(req.noteName ?? ''),
        String(req.sessionId ?? ''),
        String(req.messageId ?? ''),
        sessionQuery,
      )
    default:
      return { ok: false, error: `unknown method: ${method}` }
  }
}

/**
 * Build the GET handler serving the packaged icon SVG, so the client can use
 * `<img src="/plugins/md-notes/icon.svg">` — a single source of truth: editing
 * `assets/dsh-md-notes.svg` takes effect without regenerating any component.
 * @param svgPath - absolute path to the icon file inside the package.
 * @returns an async request handler.
 */
export function iconHandler(
  svgPath: string,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    try {
      const data = await readFile(svgPath)
      res.writeHead(200, {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'no-cache', // reflect SVG edits without a restart
      })
      res.end(data)
    } catch {
      sendJson(res, 404, { ok: false, error: 'icon not found' })
    }
  }
}

/**
 * Build the POST handler for the notes API route.
 * @param dir - the notes directory.
 * @param sessionQuery - optional session query service (for appendConversation).
 * @returns an async request handler.
 */
export function notesApiHandler(
  dir: string,
  sessionQuery: SessionQueryEngine | undefined,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      const body = await readBody(req)
      const raw = body as { method?: string }
      const method = typeof raw.method === 'string' ? raw.method : ''
      const result = await handleApi(dir, method, body, sessionQuery)
      sendJson(res, 200, result)
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
}
