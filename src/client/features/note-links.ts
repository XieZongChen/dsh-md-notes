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

/**
 * Resolve a link token to a note, preferring `preferredWsId`. Matches the
 * display title or the file basename; returns undefined when no note matches.
 */
export function resolveNoteLink(
  value: string,
  workspaces: readonly WorkspaceNotes[],
  preferredWsId: string | null,
): NoteLink | undefined {
  const q = normalize(value)
  if (q === '') return undefined
  const matches: NoteLink[] = []
  for (const ws of workspaces) {
    for (const note of ws.notes) {
      const title = note.title.trim().toLowerCase()
      const name = note.name.replace(/\.md$/i, '').toLowerCase()
      if (title === q || name === q) {
        matches.push({ workspaceId: ws.workspaceId, name: note.name, title: note.title })
      }
    }
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
