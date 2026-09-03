/**
 * Notes domain logic: file operations over the `.dsh-notes` directory plus
 * the meta.json sidecar. Each API method maps to one function here; the HTTP
 * layer and the plugin entry only assemble them.
 * @module dsh-md-notes/notes
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { NoteSummary } from '../contract.ts'

export type { NoteSummary }

const META_NAME = 'meta.json'

interface MetaValue { title?: string; updatedAt?: number }
type Meta = Record<string, MetaValue>

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
  const names = entries.filter((n) => n.endsWith('.md'))
  // Rebuild missing cache entries from the note's `# heading` + file mtime, so a
  // freshly cloned / git-pulled workspace (no meta.json) still lists accurate
  // titles and a sane updatedAt — without committing meta.json to git. One-time
  // cost: after this pass the rebuilt meta.json backs every later list.
  let dirty = false
  for (const n of names) {
    if (meta[n] !== undefined) continue
    let title = n.replace(/\.md$/i, '')
    let updatedAt = 0
    try {
      const [content, st] = await Promise.all([
        readFile(join(dir, n), 'utf8'),
        stat(join(dir, n)),
      ])
      title = titleOf(content, n.replace(/\.md$/i, ''))
      updatedAt = st.mtimeMs
    } catch {
      // unreadable → keep the filename fallback + 0
    }
    meta[n] = { title, updatedAt }
    dirty = true
  }
  if (dirty) await writeMeta(dir, meta)
  const notes = names
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

/**
 * Create one note with a `# title` stub, deduping the basename. The file
 * basename defaults to a slug of the title, but an explicit `rawName` (the
 * user-chosen file name from the create dialog) wins when non-empty — so the
 * file name and the display title are chosen independently at creation time.
 */
export async function createNote(dir: string, rawTitle: string, rawName?: string): Promise<{ ok: true; name: string }> {
  // Client always passes a localized title; this neutral fallback only guards
  // direct API calls without a title.
  const title = String(rawTitle ?? '').trim() || 'Untitled note'
  const explicitName = String(rawName ?? '').trim()
  const base = explicitName !== '' ? sanitizeName(explicitName) : sanitizeName(title)
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
 * Append the captured question + answer texts to a note. The client extracts
 * the texts from the browser conversation snapshot (docs/context.md) — this
 * function only formats and writes the file, so the host never re-reads the
 * session log (previously `sessionQuery.readSession`, heavy on long sessions
 * and blocking the event loop). Section labels (`userLabel` / `assistantLabel`
 * / `emptyText`) come from the caller (the client localizes them) so the note
 * content follows the UI language; default to neutral English when omitted.
 */
export async function appendConversation(
  dir: string,
  noteName: string,
  questionText: string,
  answerText: string,
  sessionTitle = '',
  labels?: { user?: string; assistant?: string; empty?: string; image?: string },
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  if (answerText === '') return { ok: false, error: 'assistant message not found' }

  // Normalize + sanitize the target basename (same guard as read/write/delete):
  // blocks `../` path traversal and absolute paths before any join below.
  const name = sanitizeName(noteName)

  const stamp = new Date().toLocaleString()
  const userLabel = labels?.user ?? 'User'
  const assistantLabel = labels?.assistant ?? 'DSH'
  const emptyText = labels?.empty ?? '(none)'
  // Section heading `<会话标题> -- <时间戳>` (timestamp only when the session
  // has no title); role labels are h3 subsection headings with role emoji so
  // the preview clearly separates the user question from the assistant answer.
  const heading = sessionTitle !== '' ? `## ${sessionTitle} -- ${stamp}` : `## ${stamp}`
  const section = `\n\n---\n\n${heading}\n\n### 👤 ${userLabel}\n\n${questionText || emptyText}\n\n### 🤖 ${assistantLabel}\n\n${answerText}\n`

  await mkdir(dir, { recursive: true })
  let content = ''
  try {
    content = await readFile(join(dir, name), 'utf8')
  } catch {
    /* new note */
  }
  await writeFile(join(dir, name), content + section, 'utf8')
  const meta = await readMeta(dir)
  meta[name] = { title: titleOf(content + section, name.replace(/\.md$/i, '')), updatedAt: Date.now() }
  await writeMeta(dir, meta)
  return { ok: true, name }
}
