/**
 * Agent-facing note access — the "memory" surface of the plugin.
 *
 * Everything here is PURE: it shapes what the model sees and resolves the
 * reference a model wrote back to one note. The filesystem work stays in
 * `notes.ts` and the tool wiring in `src/index.ts`, so this module is testable
 * without a temp dir or a cordis context.
 *
 * The point of these helpers is the pivot from "a human attaches a note with
 * `@`" to "the model decides to look": a model cannot browse a UI, so the tool
 * results must carry enough to pick a note (workspace + file name + title +
 * matched lines) and nothing that only a renderer needs (highlight ranges).
 * @module dsh-md-notes/note-tools
 */

import type { NoteHits, NoteSummary } from '../contract.ts'

/** One note the agent tools can address. */
export interface AgentNoteRef {
  /** Workspace id (needed to read or write the note back). */
  workspaceId: string
  /** Workspace display name (how the model refers to it in an answer). */
  workspaceName: string
  /** File name, e.g. `deploy.md`. */
  name: string
  /** Display title (the `# heading`). */
  title: string
  /** Last modification time (ms); the listing sorts on it. */
  updatedAt: number
}

/** One matched body line as the model sees it. */
export interface AgentNoteHit {
  line: number
  text: string
}

/** One search result row (a note plus its matched lines). */
export interface AgentSearchRow extends AgentNoteRef {
  /** Every query token matched the title (the note may have no body hits). */
  titleMatch: boolean
  /** Total matched body lines, before the per-note cap. */
  totalHits: number
  hits: AgentNoteHit[]
}

/** What `note_search` returns: either a listing (no query) or matched rows. */
export interface AgentSearchResult {
  /** True when there was no query and the call listed recent notes instead. */
  listed: boolean
  results: AgentSearchRow[]
  /** True when matches were dropped by the caps (narrow the query to see them). */
  truncated: boolean
}

/** Collect the addressable refs of one workspace's notes. */
export function agentRefs(
  workspace: { workspaceId: string; workspaceName: string },
  notes: readonly NoteSummary[],
): AgentNoteRef[] {
  return notes.map((note) => ({
    workspaceId: workspace.workspaceId,
    workspaceName: workspace.workspaceName,
    name: note.name,
    title: note.title,
    updatedAt: note.updatedAt,
  }))
}

/** Normalize a note reference for comparison: trim, drop `.md`, lowercase. */
function normalizeRef(value: string): string {
  return value.trim().replace(/\.md$/i, '').toLowerCase()
}

/**
 * Resolve what the model wrote to exactly one note.
 *
 * An exact FILE NAME match wins over a title match (file names are unique per
 * workspace, titles are not), and `preferredWorkspaceId` breaks a cross-workspace
 * tie. Several surviving candidates are NOT guessed: the caller returns them so
 * the model can disambiguate, which is the whole reason a wrong guess is worse
 * than a question here.
 * @param refs - every note the call may address.
 * @param rawRef - the model's `name` argument.
 * @param preferredWorkspaceId - the calling session's workspace, if any.
 * @returns the matched note, or the candidates to choose from.
 */
export function pickAgentNote(
  refs: readonly AgentNoteRef[],
  rawRef: string,
  preferredWorkspaceId?: string,
): { ok: true; note: AgentNoteRef } | { ok: false; candidates: AgentNoteRef[] } {
  const needle = normalizeRef(rawRef)
  if (needle === '') return { ok: false, candidates: [] }
  const byName = refs.filter((ref) => normalizeRef(ref.name) === needle)
  const candidates = byName.length > 0
    ? byName
    : refs.filter((ref) => ref.title.trim().toLowerCase() === needle)
  if (candidates.length === 0) return { ok: false, candidates: [] }
  if (candidates.length === 1) return { ok: true, note: candidates[0]! }
  const preferred = candidates.find((ref) => ref.workspaceId === preferredWorkspaceId)
  if (preferred !== undefined) return { ok: true, note: preferred }
  return { ok: false, candidates }
}

/**
 * Shape `searchNotes` output for the model: matched lines only (the client's
 * highlight `ranges` are renderer state), capped to `limit` notes.
 * @param results - the domain search result.
 * @param limit - maximum rows to return.
 * @returns the rows plus whether the cap dropped any.
 */
export function shapeAgentSearch(
  results: readonly NoteHits[],
  limit: number,
): { results: AgentSearchRow[]; truncated: boolean } {
  const rows = results.slice(0, Math.max(0, limit)).map((hit) => ({
    workspaceId: hit.workspaceId,
    workspaceName: hit.workspaceName,
    name: hit.name,
    title: hit.title,
    updatedAt: 0,
    titleMatch: hit.titleMatch,
    totalHits: hit.totalHits,
    hits: hit.hits.map((line) => ({ line: line.line, text: line.text })),
  }))
  return { results: rows, truncated: results.length > rows.length }
}

/**
 * The listing an empty `note_search` returns: the most recently updated notes,
 * so a model that does not yet know what the library holds can find out.
 * @param refs - every note the call may address.
 * @param limit - maximum rows.
 * @returns the newest-first slice.
 */
export function recentAgentNotes(refs: readonly AgentNoteRef[], limit: number): AgentNoteRef[] {
  return [...refs].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, Math.max(0, limit))
}
