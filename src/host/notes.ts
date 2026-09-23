/**
 * Notes domain logic: file operations over the `.dsh-notes` directory plus
 * the meta.json sidecar. Each API method maps to one function here; the HTTP
 * layer and the plugin entry only assemble them.
 * @module dsh-md-notes/notes
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
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
 * `rawBody` (the document-preview excerpt action) seeds the note under the
 * title heading instead of leaving the stub empty.
 */
export async function createNote(dir: string, rawTitle: string, rawName?: string, rawBody?: string): Promise<{ ok: true; name: string }> {
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
  const content = rawBody === undefined ? `# ${title}\n\n` : `# ${title}\n\n${rawBody}\n`
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
  return { ok: true, name: name }
}

// ---- pasted-image assets (TODO §3.6; editor paste/drop) ----

/**
 * Subdirectory of the notes dir holding pasted images. Markdown references it
 * as `assets/<name>`, which the preview resolves against the note's own dir
 * (relative path, so the reference survives a workspace move as long as the
 * whole `.dsh-notes` tree moves with it). Git sync copies top-level `.md`
 * only, so assets stay local until that scope is extended (TODO §3.6).
 */
export const ASSETS_DIR = 'assets'

/**
 * Decoded-byte cap for one pasted image. Also bounds the request body: the
 * HTTP layer sizes its read limit from this value (`ASSETS_DIR` uploads are
 * base64, ~4/3 the decoded size), and the `/api/file` serving route refuses
 * anything past the harness's own image limit anyway.
 */
export const ASSET_MAX_BYTES = 8 * 1024 * 1024

/** Whether the first bytes match `signature` (a short prefix comparison). */
function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((b, i) => bytes[i] === b)
}

/** ASCII bytes of a literal, for signatures that are text (`GIF89a`, `RIFF`…). */
function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0))
}

/**
 * Accepted image formats by extension, each with the signature its bytes must
 * carry. The check keeps a mislabeled payload (script, archive) out of a file
 * the preview will later serve as an image; the set is deliberately raster +
 * conservative (no SVG, whose markup is not a fixed signature).
 */
const ASSET_SIGNATURES: Readonly<Record<string, (bytes: Buffer) => boolean>> = {
  png: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  jpeg: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  gif: (b) => startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a')),
  webp: (b) => startsWith(b, ascii('RIFF')) && b.length >= 12 && b.subarray(8, 12).toString('latin1') === 'WEBP',
  bmp: (b) => startsWith(b, ascii('BM')),
  avif: (b) => b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp'
    && ['avif', 'avis'].includes(b.subarray(8, 12).toString('latin1')),
}

/** The formats the paste handler may store, for client-side pre-filtering. */
export const ASSET_EXTS: readonly string[] = Object.keys(ASSET_SIGNATURES)

/** A generated, collision-resistant asset basename — never client-supplied. */
function assetName(ext: string): string {
  return `img-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}.${ext}`
}

/**
 * Store one pasted image under `<dir>/assets/` and return its path relative to
 * the notes dir (the markdown reference the previews resolve). `data` is bare
 * base64 (a `data:<mime>;base64,` prefix is tolerated); `ext` names the format
 * and is checked against {@link ASSET_SIGNATURES}, so a payload whose bytes do
 * not match its claimed format is refused rather than stored. The basename is
 * generated here (a timestamp + random suffix), so no request value reaches the
 * filesystem as a path — traversal and overwrite are structurally impossible.
 * @param dir - absolute notes dir.
 * @param data - base64 image bytes.
 * @param ext - claimed extension (`png`, `jpg`, …).
 * @returns the relative `assets/<name>` reference, or a coded refusal.
 */
export async function saveAsset(
  dir: string,
  data: string,
  ext: string,
): Promise<{ ok: true; path: string } | { ok: false; code: string; error: string }> {
  const normalizedExt = String(ext ?? '').trim().toLowerCase().replace(/^\./, '')
  const signature = ASSET_SIGNATURES[normalizedExt]
  if (signature === undefined) {
    return { ok: false, code: 'asset-type', error: `Unsupported image format: ${normalizedExt || '(none)'}` }
  }
  // Bare base64 only; strip the data-URL prefix a browser may hand us.
  const payload = String(data ?? '').replace(/^data:[^,]*;base64,/i, '')
  if (payload === '' || !/^[A-Za-z0-9+/=\s]+$/.test(payload)) {
    return { ok: false, code: 'asset-empty', error: 'Image payload is empty or not base64' }
  }
  const bytes = Buffer.from(payload, 'base64')
  if (bytes.length === 0) {
    return { ok: false, code: 'asset-empty', error: 'Image payload is empty' }
  }
  if (bytes.length > ASSET_MAX_BYTES) {
    return { ok: false, code: 'asset-too-large', error: `Image exceeds the ${ASSET_MAX_BYTES} byte limit` }
  }
  if (!signature(bytes)) {
    return { ok: false, code: 'asset-type', error: `Image bytes do not match the claimed ${normalizedExt} format` }
  }
  const assetDir = join(dir, ASSETS_DIR)
  await mkdir(assetDir, { recursive: true })
  // `wx` refuses an existing name, so a (vanishingly unlikely) collision
  // retries with a fresh suffix instead of overwriting another image.
  for (let attempt = 0; attempt < 5; attempt++) {
    const name = assetName(normalizedExt)
    try {
      await writeFile(join(assetDir, name), bytes, { flag: 'wx' })
      return { ok: true, path: `${ASSETS_DIR}/${name}` }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        return { ok: false, code: 'asset-write', error: 'Could not write the image file' }
      }
    }
  }
  return { ok: false, code: 'asset-write', error: 'Could not allocate a unique image name' }
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
