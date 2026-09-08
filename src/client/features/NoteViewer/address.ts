/**
 * Right-Sidebar file-address → note mapping for the note-viewer tab
 * (`docs/context.md` §3.7 addresses; `dsh-resource://file/…` grammar in
 * deepseek-harness `dsh-util-workspace-path`). Pure logic, no runtime deps
 * beyond `parseFileAddress` — the component feeds it the workspace groups the
 * plugin's own `list` API returns.
 *
 * Two address scopes meet here:
 * - `file/session/<sessionId>/<rel>` — `rel` resolves lexically against that
 *   session's workspace ROOT (the parent of its `.dsh-notes` dir). In practice
 *   `rel` carries no `..` segments: `new URL` collapses them at parse time, so
 *   dsh's own `fileAddressFor` routes anything escaping the root to the
 *   `absolute` scope instead;
 * - `file/absolute/<abs>` — compared against every workspace's notes dir. This
 *   is the cross-workspace shape (`../ws-b/…` references resolve here).
 *
 * A note is a FLAT file directly inside a workspace's `.dsh-notes` dir (the
 * same shape `host/git.ts` `resolveNotesDir` pins), so a resolved path one or
 * more levels deeper names no note.
 * @module dsh-md-notes/client/NoteViewer/address
 */

import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import type { WorkspaceNotes } from '../api.ts'

/** A file address resolved to the note it names (undefined = not a note). */
export interface NoteTarget {
  /** Owning workspace (API `workspaceId`, for `read`). */
  workspaceId: string
  /** Workspace display name (header chip). */
  workspaceName: string
  /** Absolute notes dir (`<ws>/.dsh-notes`), host-native separators. */
  notesDir: string
  /** Note file name, e.g. `a.md`. */
  name: string
}

/** Normalize separators for comparison (host paths may be Windows-style). */
function posix(p: string): string {
  return p.replaceAll('\\', '/')
}

/**
 * Lexically resolve `rel` against `base` (`/`-separated): drop `.` and leading
 * `/`, consume `..` where possible (a `..` above base keeps climbing — the
 * result then names a sibling tree, exactly the cross-workspace case).
 */
export function resolvePosix(base: string, rel: string): string {
  const out: string[] = []
  for (const segment of `${posix(base)}/${posix(rel)}`.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (out.length > 0) out.pop()
      continue
    }
    out.push(segment)
  }
  return `/${out.join('/')}`
}

/** The workspace ROOT a session-scoped address resolves against: the parent of its notes dir. */
export function sessionRootOf(group: WorkspaceNotes | undefined): string | undefined {
  if (group === undefined) return undefined
  const dir = posix(group.notesDir)
  const cut = dir.lastIndexOf('/')
  return cut <= 0 ? undefined : dir.slice(0, cut)
}

/**
 * Resolve one right-Sidebar address to the note it names.
 * @param address - the tab's `contentId` (a `dsh-resource://file/…` URL).
 * @param workspaces - every workspace group from the `list` API.
 * @param sessionRoot - the root of the address's own session workspace
 * (`sessionRootOf` over its group); `undefined` declines session-scoped
 * addresses (session resolved no workspace).
 * @returns the note target, or `undefined` when the address is not a note.
 */
export function noteTargetOf(
  address: string,
  workspaces: readonly WorkspaceNotes[],
  sessionRoot: string | undefined,
): NoteTarget | undefined {
  const parsed = parseFileAddress(address)
  if (parsed === undefined) return undefined
  const absolute = parsed.scope === 'absolute'
    ? posix(parsed.path)
    : sessionRoot === undefined ? undefined : resolvePosix(sessionRoot, parsed.path)
  if (absolute === undefined) return undefined
  for (const ws of workspaces) {
    const dir = posix(ws.notesDir)
    if (absolute === dir || absolute.startsWith(`${dir}/`)) {
      const name = absolute.slice(dir.length + 1)
      // Flat notes only: the dir itself, or anything nested deeper, is no note.
      if (name === '' || name.includes('/')) return undefined
      return { workspaceId: ws.workspaceId, workspaceName: ws.name, notesDir: ws.notesDir, name }
    }
  }
  return undefined
}

/**
 * The tab-chip title for one address: its decoded basename without the `.md`
 * suffix. Decode is per segment, matching how the address was built; a
 * malformed escape shows raw rather than throwing.
 */
export function noteTitleOf(address: string): string {
  const name = address.slice(address.lastIndexOf('/') + 1)
  if (name === '') return address
  let decoded = name
  try {
    decoded = decodeURIComponent(name)
  } catch {
    /* keep raw */
  }
  return decoded.replace(/\.md$/i, '')
}
