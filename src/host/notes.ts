/**
 * Notes domain logic: file operations over the `.dsh-notes` directory plus
 * the meta.json sidecar. Each API method maps to one function here; the HTTP
 * layer and the plugin entry only assemble them.
 * @module dsh-md-notes/notes
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

const META_NAME = 'meta.json'

interface MetaValue { title?: string; updatedAt?: number }
type Meta = Record<string, MetaValue>

export interface NoteSummary {
  name: string
  title: string
  updatedAt: number
}

/** Normalize a user-supplied note name into a safe `.md` basename. */
export function sanitizeName(input: string | undefined): string {
  const base = String(input ?? '').trim().replace(/\.md$/i, '')
  const slug = base
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'note'}.md`
}

/** Extract the first `# ` heading as the display title. */
export function titleOf(content: string | undefined, fallback: string): string {
  const m = String(content ?? '').match(/^\s*#\s+(.+)$/m)
  return m !== null && m[1] !== undefined && m[1].trim() !== '' ? m[1].trim() : fallback
}

/** Render message content blocks to plain markdown text. */
export function blocksToText(blocks: readonly unknown[] | undefined, imageLabel = '[image]'): string {
  const parts: string[] = []
  for (const b of blocks ?? []) {
    if (b === null || typeof b !== 'object') continue
    const block = b as { type?: string; text?: string }
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'image') parts.push(imageLabel)
    // reasoning blocks are intentionally skipped — only the final answer is
    // kept, matching how dsh surfaces the response (Think is transient).
  }
  return parts.join('\n\n').trim()
}

async function readMeta(dir: string): Promise<Meta> {
  try {
    const raw = await readFile(join(dir, META_NAME), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return parsed !== null && typeof parsed === 'object' ? parsed as Meta : {}
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

/** List every `.md` note, newest-first. */
export async function listNotes(dir: string): Promise<{ ok: true; notes: NoteSummary[]; dir: string }> {
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

/** Read one note's content (empty for a missing file). */
export async function readNote(dir: string, rawName: string): Promise<{ ok: true; name: string; content: string }> {
  const name = sanitizeName(rawName)
  await mkdir(dir, { recursive: true })
  let content = ''
  try {
    content = await readFile(join(dir, name), 'utf8')
  } catch {
    /* missing -> empty */
  }
  return { ok: true, name, content }
}

/** Overwrite one note, refreshing the meta title/updatedAt. */
export async function writeNote(dir: string, rawName: string, content: string): Promise<{ ok: true; name: string }> {
  const name = sanitizeName(rawName)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, name), content, 'utf8')
  const meta = await readMeta(dir)
  meta[name] = { title: titleOf(content, name.replace(/\.md$/i, '')), updatedAt: Date.now() }
  await writeMeta(dir, meta)
  return { ok: true, name }
}

/** Create one note with a `# title` stub, deduping the basename. */
export async function createNote(dir: string, rawTitle: string): Promise<{ ok: true; name: string }> {
  // Client always passes a localized title; this neutral fallback only guards
  // direct API calls without a title.
  const title = String(rawTitle ?? '').trim() || 'Untitled note'
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

/** Remove one note file. */
export async function deleteNote(dir: string, rawName: string): Promise<{ ok: true; name: string }> {
  const name = sanitizeName(rawName)
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

/**
 * Append the user question + assistant answer for one message to a note.
 * Section labels (`userLabel` / `assistantLabel` / `emptyText`) come from the
 * caller (the client localizes them) so the note content follows the UI
 * language; default to neutral English when omitted.
 */
export async function appendConversation(
  dir: string,
  noteName: string,
  sessionId: string,
  messageId: string,
  sessionQuery: SessionQueryEngine | undefined,
  labels?: { user?: string; assistant?: string; empty?: string; image?: string },
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  if (!sessionId || !messageId) return { ok: false, error: 'missing session/message id' }
  if (sessionQuery === undefined) return { ok: false, error: 'sessionQuery unavailable' }

  let events: readonly { type?: string; data?: unknown }[] = []
  let sessionTitle = ''
  try {
    const snap = await sessionQuery.readSession(sessionId as SessionId)
    events = snap.events ?? []
    try {
      const t = await sessionQuery.readTitle(sessionId as SessionId)
      sessionTitle = t?.title ?? ''
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
      if (data.source?.kind === 'user') userText = blocksToText(data.content, labels?.image)
    } else if (ev.type === 'assistant/message') {
      if (data.message?.id === messageId) {
        assistantText = blocksToText(data.message.content, labels?.image)
        break
      }
    }
  }
  if (assistantText === '') return { ok: false, error: 'assistant message not found' }

  const stamp = new Date().toLocaleString()
  const userLabel = labels?.user ?? 'User'
  const assistantLabel = labels?.assistant ?? 'DSH'
  const emptyText = labels?.empty ?? '(none)'
  // Section heading `<会话标题> -- <时间戳>` (timestamp only when the session
  // has no title); role labels are h3 subsection headings with role emoji so
  // the preview clearly separates the user question from the assistant answer.
  const heading = sessionTitle !== '' ? `## ${sessionTitle} -- ${stamp}` : `## ${stamp}`
  const section = `\n\n---\n\n${heading}\n\n### 👤 ${userLabel}\n\n${userText || emptyText}\n\n### 🤖 ${assistantLabel}\n\n${assistantText}\n`

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
