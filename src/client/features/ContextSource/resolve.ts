/**
 * Ref → owning-workspace resolution for submit-time serialization. A chip's
 * `ref` is relative to the SESSION's workspace root (`.dsh-notes/<name>` or
 * `../<dir>/.dsh-notes/<name>`), with absolute and `<wsName>/…` fallbacks —
 * this module maps any of those onto the workspace that owns the note.
 * Extracted from ContextSource.ts so the three-branch resolution is
 * unit-tested directly (it is the easiest logic to silently break).
 * @module dsh-md-notes/client/ContextSource/resolve
 */

import type { WorkspaceNotes } from '../api.ts'
import { canon, parentDir } from './paths.ts'

/** A ref resolved onto its owning workspace entry + note basename. */
export interface ResolvedNoteRef {
  owner: WorkspaceNotes
  name: string
}

/**
 * Resolve a chip ref against the full workspace list.
 *
 * Branches:
 * - `/abs/…` — matches the workspace whose `notesDir` prefixes the ref.
 * - `.…` (dot-relative) — generated relative to the session workspace root;
 *   the resolving base and the target workspace can differ (cross-workspace
 *   refs): find a workspace that owns a note with this name, then require
 *   that SOME workspace root resolves the ref to exactly that note's path
 *   (resolving against the target's own root would break when workspaces sit
 *   at different depths — the ref's `..` count matches the session root).
 * - otherwise — `<wsName>/…` fallback (no session root at pick time) first,
 *   then the generic relative resolution (a ref UNDER the session workspace,
 *   relFrom ups=0 yields `dir/.dsh-notes/<name>`).
 *
 * Returns undefined when no workspace owns the ref.
 */
export function resolveNoteRef(workspaces: readonly WorkspaceNotes[], ref: string): ResolvedNoteRef | undefined {
  if (ref.startsWith('/')) {
    const owner = workspaces.find((ws) =>
      ref.startsWith(ws.notesDir.endsWith('/') ? ws.notesDir : `${ws.notesDir}/`))
    const name = owner === undefined ? '' : ref.slice(owner.notesDir.length + (owner.notesDir.endsWith('/') ? 0 : 1))
    return owner === undefined ? undefined : { owner, name }
  }
  if (ref.startsWith('.')) {
    return resolveByRelativeName(workspaces, ref)
  }
  // `<wsName>/…` fallback first …
  const slash = ref.indexOf('/')
  const wsName = slash === -1 ? '' : ref.slice(0, slash)
  const byName = workspaces.find((ws) => ws.name === wsName)
  if (byName !== undefined) {
    const name = ref.slice(ref.lastIndexOf('/') + 1)
    return { owner: byName, name }
  }
  // … then the generic relative resolution.
  return resolveByRelativeName(workspaces, ref)
}

/** The dot-relative / plain-relative resolution shared by two branches. */
function resolveByRelativeName(workspaces: readonly WorkspaceNotes[], ref: string): ResolvedNoteRef | undefined {
  const name = ref.slice(ref.lastIndexOf('/') + 1)
  const owner = workspaces.find((ws) => {
    if (!ws.notes.some((n) => n.name === name)) return false
    const target = canon(`${ws.notesDir}/${name}`)
    return target !== null && workspaces.some((base) =>
      canon(`${parentDir(base.notesDir)}/${ref}`) === target)
  })
  return owner === undefined ? undefined : { owner, name }
}
