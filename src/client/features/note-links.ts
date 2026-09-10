/**
 * Note interlink resolution + link preprocessing for the notes previews.
 * dsh 0.1.2-alpha.1 opened `MarkdownText.fileMentions`: an inline-code token
 * (`` `x` ``) whose resolver returns `{ open, label, title }` renders as a
 * clickable link. Notes therefore interlink through three equivalent spellings:
 * - `` `笔记名` `` — native fileMentions (no preprocessing);
 * - `[[笔记名]]` — wiki syntax, rewritten to backticks here before rendering;
 * - `[任意文字](路径)` — a markdown link whose destination is a note path
 *   (`.dsh-notes/<名>.md`, optionally `../<工作区>/.dsh-notes/…`). This is the
 *   form the injected citation convention teaches the MODEL, so answers
 *   captured into notes (记入笔记) carry it verbatim; without the rewrite the
 *   preview shows a dead relative link. Destination resolution is layered:
 *   exact path semantics first (`resolveNoteRef`), then a basename fallback
 *   for sloppy forms (e.g. `../.dsh-notes/x.md` the model wrote against the
 *   wrong depth). Image links (`![…](…)`) are never rewritten.
 *
 * Resolution matches a note by its display title or file basename (both
 * case-insensitive), preferring the current workspace on cross-workspace name
 * collisions. Unresolved tokens stay inert.
 * @module dsh-md-notes/client/note-links
 */

import type { WorkspaceNotes } from './api.ts'
import { resolveNoteRef } from './ContextSource/resolve.ts'

/** One resolved link target (workspace + note). */
export interface NoteLink {
  workspaceId: string
  /** File name, e.g. `xxx.md`. */
  name: string
  /** Display title. */
  title: string
}

/** Normalize a link token: trim, drop `.md`, lowercase for compares. */
function normalize(value: string): string {
  return value.trim().replace(/\.md$/i, '').toLowerCase()
}

/** Match a note inside one workspace by display title or file basename. */
function matchInWorkspace(ws: WorkspaceNotes, q: string): NoteLink | undefined {
  const norm = normalize(q)
  if (norm === '') return undefined
  for (const note of ws.notes) {
    const title = note.title.trim().toLowerCase()
    const name = note.name.replace(/\.md$/i, '').toLowerCase()
    if (title === norm || name === norm) {
      return { workspaceId: ws.workspaceId, name: note.name, title: note.title }
    }
  }
  return undefined
}

/**
 * Split a possibly workspace-qualified token into its note part plus the named
 * workspace when the prefix matches one (by display name or id, case-insensitive).
 * The prefix must match a workspace; otherwise the whole token is the note part
 * (a note title may itself contain `/`, while a file basename never does).
 */
function splitQualified(
  value: string,
  workspaces: readonly WorkspaceNotes[],
): { notePart: string; ws?: WorkspaceNotes } {
  const raw = value.trim()
  const slash = raw.indexOf('/')
  if (slash > 0) {
    const wsPart = raw.slice(0, slash).trim()
    const ws = workspaces.find((w) =>
      w.workspaceId.toLowerCase() === wsPart.toLowerCase() ||
      w.name.trim().toLowerCase() === wsPart.toLowerCase())
    if (ws !== undefined) return { notePart: raw.slice(slash + 1).trim(), ws }
  }
  return { notePart: raw }
}

/**
 * Resolve a link token to a note, preferring `preferredWsId`. Matches the
 * display title or the file basename; returns undefined when no note matches.
 *
 * A `工作区名/笔记名` token resolves **only inside** the named workspace (matched
 * by display name or workspace id, case-insensitive), letting a cross-workspace
 * name collision address the other workspace's note explicitly.
 */
export function resolveNoteLink(
  value: string,
  workspaces: readonly WorkspaceNotes[],
  preferredWsId: string | null,
): NoteLink | undefined {
  const { notePart, ws } = splitQualified(value, workspaces)
  if (notePart === '') return undefined
  if (ws !== undefined) return matchInWorkspace(ws, notePart)

  const matches: NoteLink[] = []
  for (const w of workspaces) {
    const match = matchInWorkspace(w, notePart)
    if (match !== undefined) matches.push(match)
  }
  if (matches.length === 0) return undefined
  return matches.find((m) => m.workspaceId === preferredWsId) ?? matches[0]
}

/**
 * Count the notes inside `workspaceId` whose display title matches the note
 * part of `value` (case-insensitive). A count > 1 means a title-based link is
 * ambiguous: several notes share that title within the same workspace, so the
 * caller should hint that the file name be used instead. Returns 0 when the
 * workspace is unknown or the token matches by file name only.
 */
export function titleMatchCount(
  value: string,
  workspaces: readonly WorkspaceNotes[],
  workspaceId: string,
): number {
  const ws = workspaces.find((w) => w.workspaceId === workspaceId)
  if (ws === undefined) return 0
  const { notePart } = splitQualified(value, workspaces)
  const q = normalize(notePart)
  if (q === '') return 0
  let count = 0
  for (const note of ws.notes) {
    if (note.title.trim().toLowerCase() === q) count += 1
  }
  return count
}

/** Match one wiki link `[[name]]` (no nesting, no newline inside the brackets). */
const WIKI_LINK_RE = /\[\[([^\[\]\n]+)\]\]/g

/** Match one markdown link `[text](dest)` that is NOT an image (`!`-prefixed). */
const MD_LINK_RE = /(?<!!)\[([^\]\n]*)\]\(([^)\n]+)\)/g

/** Whether a markdown destination names a note path (any depth, `../`-prefixed or not). */
function notePathName(dest: string): string | undefined {
  const m = /(?:^|\/)(?:\.\.\/(?:[^/]+\/)*)?\.dsh-notes\/([^/]+)\.md$/.exec(dest)
  return m === null ? undefined : (m[1] ?? '')
}

/**
 * Resolve one markdown-link destination to its note: exact path semantics
 * (`resolveNoteRef`) first, then a basename fallback for model-sloppy forms
 * whose `..` depth does not match any workspace root.
 */
function resolveNoteDest(
  dest: string,
  workspaces: readonly WorkspaceNotes[],
  preferredWsId: string | null,
): string | undefined {
  const byPath = resolveNoteRef(workspaces, dest)
  if (byPath !== undefined && byPath.owner.notes.some((n) => n.name === byPath.name)) {
    return byPath.owner.workspaceId === preferredWsId
      ? byPath.name.replace(/\.md$/i, '')
      : `${byPath.owner.name}/${byPath.name.replace(/\.md$/i, '')}`
  }
  const name = notePathName(dest)
  if (name === undefined) return undefined
  const byName = resolveNoteLink(name, workspaces, preferredWsId)
  return byName === undefined ? undefined
    : byName.workspaceId === preferredWsId ? byName.name.replace(/\.md$/i, '')
      : `${workspaces.find((w) => w.workspaceId === byName.workspaceId)?.name ?? ''}/${byName.name.replace(/\.md$/i, '')}`
}

/**
 * Rewrite interlink spellings MarkdownText cannot link on its own — `[[name]]`
 * wiki links and `[text](note path)` markdown links — to `` `token` `` for
 * tokens that resolve to a note, so `fileMentions` can link them. The markdown
 * form keeps neither text nor destination (the rendered label becomes the
 * note's own title via the resolver). Code fences are left untouched.
 */
export function preprocessNoteLinks(
  content: string,
  workspaces: readonly WorkspaceNotes[],
  preferredWsId: string | null,
): string {
  let inFence = false
  let fenceChar = ''
  return content.split('\n').map((line) => {
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence !== null) {
      const marker = fence[1]?.[0] ?? ''
      if (!inFence) {
        inFence = true
        fenceChar = marker
      } else if (marker === fenceChar) {
        inFence = false
      }
      return line
    }
    if (inFence) return line
    return line
      .replace(WIKI_LINK_RE, (full, name) =>
        resolveNoteLink(name, workspaces, preferredWsId) !== undefined ? `\`${name}\`` : full)
      .replace(MD_LINK_RE, (full, _text, dest) => {
        if (/\s/.test(dest)) return full
        const token = resolveNoteDest(dest, workspaces, preferredWsId)
        return token === undefined ? full : `\`${token}\``
      })
  }).join('\n')
}

/** Backwards-compatible alias (the preprocessing grew beyond wiki links). */
export const preprocessWikiLinks = preprocessNoteLinks
