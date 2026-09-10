/**
 * Notes domain logic: file operations over the `.dsh-notes` directory plus
 * the meta.json sidecar. Each API method maps to one function here; the HTTP
 * layer and the plugin entry only assemble them.
 * @module dsh-md-notes/notes
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { NoteHits, NoteSummary, SearchHit } from '../contract.ts'

export type { NoteHits, NoteSummary, SearchHit }

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
/** Extras captured from the assistant message (client snapshot → host rendering). */
export interface AppendExtras {
  /** Absolute paths of files the answer produced; rendered as markdown links relative to the note dir. */
  files?: readonly string[]
}

/** Markdown-safe link path: spaces/parens escaped so `[name](path)` stays one token. */
function mdPath(path: string): string {
  return path.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20')
}

/** POSIX-relative path from the note's dir to an absolute target (`..` climbs out of `.dsh-notes`). */
function relFromDir(dir: string, target: string): string {
  const f = dir.replace(/\\/g, '/').split('/').filter(Boolean)
  const t = target.replace(/\\/g, '/').split('/').filter(Boolean)
  let i = 0
  while (i < f.length && i < t.length && f[i] === t[i]) i += 1
  const ups = f.length - i
  const down = t.slice(i).join('/')
  return ups === 0 ? down : `${'../'.repeat(ups)}${down}`
}

export async function appendConversation(
  dir: string,
  noteName: string,
  questionText: string,
  answerText: string,
  sessionTitle = '',
  labels?: { user?: string; assistant?: string; empty?: string; image?: string; files?: string },
  extras?: AppendExtras,
): Promise<{ ok: true; name: string } | { ok: false; error: string; code?: string }> {
  // Coded so the client localizes it (an English free-text error would leak
  // into the localized picker message — bilingual audit 2026-09-11).
  if (answerText === '') return { ok: false, code: 'empty-answer', error: 'assistant message not found' }

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
  let section = `\n\n---\n\n${heading}\n\n### 👤 ${userLabel}\n\n${questionText || emptyText}\n\n### 🤖 ${assistantLabel}\n\n${answerText}\n`
  // Produced files: markdown links relative to the note's own dir (the
  // `.dsh-notes` dir — `../x.png` reaches the workspace root, matching the
  // preview's path-images vocabulary). Duplicates collapse in first-seen order.
  const files = [...new Set(extras?.files ?? [])].filter(p => p.trim() !== '')
  if (files.length > 0) {
    const links = files.map(p => {
      const base = p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p
      return `- [${base}](${mdPath(relFromDir(dir, p))})`
    })
    section += `\n### 📎 ${labels?.files ?? 'Files'}\n\n${links.join('\n')}\n`
  }
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
  return { ok: true, name: name }
}

// ---- full-text search (manager search box, docs/search.md §3–§4) ----

/** Query cap: the manager box is short; the cap bounds the scan, not the user. */
const SEARCH_QUERY_MAX = 100
/** Matched lines returned per note; `totalHits` keeps the uncapped count. */
const SEARCH_HITS_PER_NOTE = 5
/** Per-line display cap; occurrences past the cut are dropped (not visible). */
const SEARCH_LINE_MAX = 160
/** Max notes in one response; further matches fold into `truncated`. */
const SEARCH_NOTES_MAX = 50

/** One workspace to scan (assembled by the HTTP layer from `listWorkspaces()`). */
export interface SearchScope {
  workspaceId: string
  workspaceName: string
  dir: string
}

/**
 * Split a query into deduped lowercase tokens (AND semantics). Whitespace-only
 * or empty queries yield no tokens → the search returns no results.
 */
export function searchTokens(rawQuery: string): string[] {
  const query = String(rawQuery ?? '').slice(0, SEARCH_QUERY_MAX)
  return [...new Set(query.split(/\s+/).map((token) => token.toLowerCase()).filter((token) => token !== ''))]
}

/** Token occurrence ranges inside one line, sorted, non-overlapping, cut to `limit`. */
function lineRanges(lowerLine: string, tokens: readonly string[], limit: number): Array<{ start: number; end: number }> {
  const found: Array<{ start: number; end: number }> = []
  for (const token of tokens) {
    let from = 0
    for (;;) {
      const at = lowerLine.indexOf(token, from)
      if (at === -1 || at >= limit) break
      found.push({ start: at, end: Math.min(at + token.length, limit) })
      from = at + token.length
    }
  }
  found.sort((a, b) => a.start - b.start || a.end - b.end)
  // Drop overlaps (different tokens can overlap): keep the earlier range.
  const kept: Array<{ start: number; end: number }> = []
  for (const range of found) {
    const last = kept[kept.length - 1]
    if (last !== undefined && range.start < last.end) continue
    kept.push(range)
  }
  return kept
}

/** Match one note's content against the tokens (title AND-body over title+body). */
function matchNote(
  scope: SearchScope,
  name: string,
  content: string,
  tokens: readonly string[],
): NoteHits | undefined {
  // EOL-normalize BEFORE splitting so hit line numbers match what the client
  // computes when it re-splits the loaded content (browsers normalize the
  // textarea value to \n the same way).
  const normalized = content.replace(/\r\n?/g, '\n')
  const title = titleOf(normalized, name.replace(/\.md$/i, ''))
  const hay = `${title}\n${normalized}`.toLowerCase()
  if (!tokens.every((token) => hay.includes(token))) return undefined
  const hits: SearchHit[] = []
  let totalHits = 0
  const lines = normalized.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    const lower = line.toLowerCase()
    if (!tokens.some((token) => lower.includes(token))) continue
    totalHits += 1
    if (hits.length >= SEARCH_HITS_PER_NOTE) continue
    const cut = line.length > SEARCH_LINE_MAX ? SEARCH_LINE_MAX : line.length
    hits.push({
      line: i + 1,
      text: line.slice(0, cut) + (cut < line.length ? '…' : ''),
      ranges: lineRanges(lower, tokens, cut),
    })
  }
  return {
    workspaceId: scope.workspaceId,
    workspaceName: scope.workspaceName,
    name,
    title,
    titleMatch: tokens.every((token) => title.toLowerCase().includes(token)),
    totalHits,
    hits,
  }
}

/**
 * Full-text search over every scope's notes: title + body, tokens AND,
 * case-insensitive substring (no regex — nothing to inject or blow up).
 * Read-only: meta.json is neither read nor written here (content is the source
 * of truth for search); notes are visited newest-first via file mtime.
 * Workspaces are scanned serially — parallel reads buy nothing on one disk and
 * can starve the browser's same-origin connection pool (same reasoning as the
 * git-status serialization).
 */
export async function searchNotes(
  scopes: readonly SearchScope[],
  rawQuery: string,
): Promise<{ ok: true; results: NoteHits[]; truncated: boolean }> {
  const tokens = searchTokens(rawQuery)
  if (tokens.length === 0) return { ok: true, results: [], truncated: false }
  const results: NoteHits[] = []
  let truncated = false
  for (const scope of scopes) {
    let entries: string[] = []
    try {
      entries = await readdir(scope.dir)
    } catch {
      continue // no notes dir yet → nothing to scan
    }
    const notes: Array<{ name: string; updatedAt: number }> = []
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue // meta.json and assets never match anyway
      try {
        const st = await stat(join(scope.dir, entry))
        notes.push({ name: entry, updatedAt: st.mtimeMs })
      } catch {
        /* vanished between readdir and stat → skip */
      }
    }
    notes.sort((a, b) => b.updatedAt - a.updatedAt)
    for (const { name } of notes) {
      let content = ''
      try {
        content = await readFile(join(scope.dir, name), 'utf8')
      } catch {
        continue
      }
      const hit = matchNote(scope, name, content, tokens)
      if (hit === undefined) continue
      if (results.length >= SEARCH_NOTES_MAX) {
        truncated = true
        return { ok: true, results, truncated }
      }
      results.push(hit)
    }
  }
  return { ok: true, results, truncated }
}
