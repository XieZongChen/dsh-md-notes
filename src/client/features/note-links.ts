/**
 * Note interlink resolution + wiki-link preprocessing for the notes manager
 * preview. dsh 0.1.2-alpha.1 opened `MarkdownText.fileMentions`: an inline-code
 * token (`` `x` ``) whose resolver returns `{ open, label, title }` renders as a
 * clickable link. Notes therefore interlink through two equivalent spellings:
 * - `` `笔记名` `` — native fileMentions (no preprocessing);
 * - `[[笔记名]]` — wiki syntax, rewritten to backticks here before rendering.
 *
 * Resolution matches a note by its display title or file basename (both
 * case-insensitive), preferring the current workspace on cross-workspace name
 * collisions. Unresolved tokens stay inert.
 * @module dsh-md-notes/client/note-links
 */

import type { WorkspaceNotes } from './api.ts'

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

/**
 * Rewrite `[[name]]` to `` `name` `` for tokens that resolve to a note, so
 * MarkdownText's `fileMentions` can link them. Code fences are left untouched:
 * a `[[…]]` inside a code block stays literal.
 */
export function preprocessWikiLinks(
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
    return line.replace(WIKI_LINK_RE, (full, name) =>
      resolveNoteLink(name, workspaces, preferredWsId) !== undefined ? `\`${name}\`` : full)
  }).join('\n')
}
