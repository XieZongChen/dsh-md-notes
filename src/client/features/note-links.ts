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
 * Resolve a link token to a note, preferring `preferredWsId`. Matches the
 * display title or the file basename; returns undefined when no note matches.
 *
 * A `工作区名/笔记名` token resolves **only inside** the named workspace (matched
 * by display name or workspace id, case-insensitive), letting a cross-workspace
 * name collision address the other workspace's note explicitly. The prefix must
 * match a workspace; otherwise the token falls through to the unqualified match
 * below (a note title may itself contain `/`, while a file basename never does).
 */
export function resolveNoteLink(
  value: string,
  workspaces: readonly WorkspaceNotes[],
  preferredWsId: string | null,
): NoteLink | undefined {
  const raw = value.trim()
  if (raw === '') return undefined

  const slash = raw.indexOf('/')
  if (slash > 0) {
    const wsPart = raw.slice(0, slash).trim()
    const notePart = raw.slice(slash + 1).trim()
    const ws = workspaces.find((w) =>
      w.workspaceId.toLowerCase() === wsPart.toLowerCase() ||
      w.name.trim().toLowerCase() === wsPart.toLowerCase())
    if (ws !== undefined) return matchInWorkspace(ws, notePart)
  }

  const q = normalize(raw)
  const matches: NoteLink[] = []
  for (const ws of workspaces) {
    const match = matchInWorkspace(ws, q)
    if (match !== undefined) matches.push(match)
  }
  if (matches.length === 0) return undefined
  return matches.find((m) => m.workspaceId === preferredWsId) ?? matches[0]
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
