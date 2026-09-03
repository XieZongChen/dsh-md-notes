/**
 * dsh-md-notes `@` reference source for the dsh input-trigger pipeline
 * (`ui-input-trigger`). Candidates are notes: by default the session's own
 * workspace; typing `@工作区名/` (ASCII names only) switches to that
 * workspace. A pick inserts a chip whose `ref` is a path RELATIVE to the
 * session workspace root (same workspace `.dsh-notes/<name>.md`, other
 * workspaces `../<dir>/.dsh-notes/<name>.md` — resolvable against the
 * session cwd; an absolute fallback only when the session workspace is
 * unknown at pick time) — and the codec serializes each chip at submit time
 * to a localized, readable path reference the model can `read` (fs sandbox
 * reads pass through, so cross-workspace paths work). A missing note at
 * submit time blocks the send with a localized notice (never a silent
 * downgrade).
 *
 * Plain-text `@标题` is decorative only (the lexicon hot roll highlights
 * exact `[\w-]+` matches); real references always go through the chip.
 * @module dsh-md-notes/client/ContextSource
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  InputTriggerCandidate, InputTriggerSource, ReferenceInsert,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ListResult, NoteSummary, WorkspaceNotes } from '../api.ts'
import { api } from '../api.ts'
import { chipLabel, parentDir, refPath, relFrom } from './paths.ts'
import { resolveNoteRef } from './resolve.ts'

/** Source identity: the menu group title and the chip `source` field. */
export const NOTES_SOURCE = 'notes'

/** Candidate row glyph: a semantic icon kind — ui-input-trigger now renders a
 *  real glyph for `file`/`folder`/`session` (arbitrary emoji/URL no longer
 *  valid), so notes use the built-in file glyph. */
const NOTE_ICON = 'file'

/** One candidate's resolved note identity (built at candidates time, picked by object identity). */
interface NoteRef {
  readonly ws: WorkspaceNotes
  readonly note: NoteSummary
  readonly crossWs: boolean
}

/** One-time stale-host warning (the running dsh host predates `notesDir`). */
let warnedStaleHost = false

/** Warn once when the host list response lacks `notesDir` (old host code). */
function warnStaleHost(): void {
  if (warnedStaleHost) return
  warnedStaleHost = true
  // The client bundle updates via a page refresh alone, but the backend is
  // loaded at process start — a restart of dsh web is required for the new
  // `list` response shape (`notesDir`) to take effect.
  console.error('[dsh-md-notes] stale host: the list response lacks "notesDir"; restart dsh web so the host loads the updated plugin')
}

/** The `@` source plus its teardown (clears per-session caches). */
export interface NotesSourceBundle {
  source: InputTriggerSource
  dispose: () => void
}

/**
 * Re-track hook supplied by the entry (apply): after a workspace auto-complete
 * the machine-driven draft change never passes through the composer's
 * onChange, so the menu would stay closed — the hook re-tracks the session's
 * input with the caret right after the completed token, which re-runs trigger
 * detection and pops that workspace's note list.
 * @param sessionId - the session whose composer to re-track.
 * @param caret - caret offset in draft coordinates after the insertion.
 */
export type ReTrackHook = (sessionId: SessionId, caret: number) => void

/**
 * Build the `@` notes source. All state lives in the returned closure;
 * `dispose` clears it (the registering effect calls it on HMR/unmount).
 * @param t - bound `md-notes` translate (localized error copy).
 * @param reTrack - optional composer re-track hook (workspace auto-complete).
 */
export function createNotesSource(t: TranslateNS<'md-notes'>, reTrack?: ReTrackHook): NotesSourceBundle {
  /** Single-flight current-workspace list per session (shared by warm + candidates). */
  const fetches = new Map<SessionId, Promise<readonly WorkspaceNotes[]>>()
  /** Settled current-workspace list per session (backs the synchronous lexicon). */
  const settled = new Map<SessionId, readonly WorkspaceNotes[]>()
  /** Lexicon invalidation listeners per session. */
  const lexiconListeners = new Map<SessionId, Set<() => void>>()
  /** Latest candidate generation per session: candidate object → note identity. */
  const candidateRefs = new Map<SessionId, Map<InputTriggerCandidate, NoteRef>>()
  /** Latest candidate generation per session: workspace-row candidate → workspace name
   *  (partial-name fuzzy rows; picking one auto-completes `@工作区名/`). */
  const candidateWorkspaces = new Map<SessionId, Map<InputTriggerCandidate, string>>()

  const notifyLexicon = (sessionId: SessionId): void => {
    for (const fn of [...(lexiconListeners.get(sessionId) ?? [])]) {
      try {
        fn()
      } catch (error) {
        // Contain listener failures: settlement notifies from an ignored
        // promise chain; one faulty consumer must not starve the others.
        console.error('[dsh-md-notes] lexicon listener failed:', error)
      }
    }
  }

  /**
   * Fetch (and cache) the session workspace's notes; settles the lexicon roll.
   * Deliberately NOT bound to any per-call signal: this is a shared prewarm
   * that must outlive superseded keystroke calls (ui-skill's shared-fetch
   * pattern) — the controller aborts the previous generation's fetch each
   * keystroke, and binding that abort here would poison the shared promise
   * for every later consumer, flashing the menu empty. Callers check their
   * own `signal.aborted` after awaiting.
   */
  const fetchCurrent = (sessionId: SessionId): Promise<readonly WorkspaceNotes[]> => {
    const existing = fetches.get(sessionId)
    if (existing !== undefined) return existing
    const promise = (async () => {
      const res = await api('list', { sessionId })
      if (!res.ok) throw new Error(res.error)
      return res.workspaces ?? []
    })()
    fetches.set(sessionId, promise)
    promise.then(
      (workspaces) => {
        settled.set(sessionId, workspaces)
        notifyLexicon(sessionId)
      },
      () => {
        // A failed fetch must not poison the key: the next consumer retries.
        if (fetches.get(sessionId) === promise) fetches.delete(sessionId)
      },
    )
    return promise
  }

  /**
   * Fetch (and cache) the full cross-workspace list. Unlike `fetchCurrent`,
   * this has no session key and backs the fuzzy workspace rows + cross-workspace
   * path resolution. A short TTL stops the `@` menu from re-reading every
   * workspace's notes on each keystroke (the host `list` walks each notes dir)
   * while staying fresh across separate `@` sessions. As with `fetchCurrent`,
   * the shared promise is NOT bound to any per-call signal; callers check
   * `signal.aborted` after awaiting.
   */
  const ALL_TTL_MS = 3000
  let allFetch: Promise<ListResult> | null = null
  let allSettled: { at: number; workspaces: WorkspaceNotes[] } | null = null
  const fetchAll = (): Promise<ListResult> => {
    if (allSettled !== null && Date.now() - allSettled.at < ALL_TTL_MS) {
      return Promise.resolve({ ok: true, workspaces: allSettled.workspaces })
    }
    if (allFetch !== null) return allFetch
    const promise = api('list')
    allFetch = promise
    promise.then(
      (res) => {
        if (allFetch === promise) allFetch = null
        if (res.ok && res.workspaces !== undefined) allSettled = { at: Date.now(), workspaces: res.workspaces }
      },
      () => {
        if (allFetch === promise) allFetch = null
      },
    )
    return promise
  }

  /** Candidate rows for one workspace, filtered by title/name substring. */
  const rowsFor = (
    ws: WorkspaceNotes, query: string, crossWs: boolean,
  ): { rows: readonly InputTriggerCandidate[]; refs: Map<InputTriggerCandidate, NoteRef> } => {
    const q = query.toLowerCase()
    const rows: InputTriggerCandidate[] = []
    const refs = new Map<InputTriggerCandidate, NoteRef>()
    for (const note of ws.notes) {
      const hay = `${note.title} ${note.name}`.toLowerCase()
      if (q !== '' && !hay.includes(q)) continue
      const candidate: InputTriggerCandidate = {
        name: note.title,
        description: crossWs ? `${ws.name} · ${note.name.replace(/\.md$/i, '')}` : note.name.replace(/\.md$/i, ''),
        icon: NOTE_ICON,
      }
      rows.push(candidate)
      refs.set(candidate, { ws, note, crossWs })
    }
    return { rows, refs }
  }

  const source: InputTriggerSource = {
    trigger: '@',
    name: NOTES_SOURCE,
    // Notes above the core subagent group in the '@' menu.
    order: -10,
    async candidates(session, { query, signal }) {
      // Workspace context = query contains `/` (or is an exact workspace name).
      // Partial bare names show BOTH fuzzy workspace rows and the current
      // workspace's notes; picking a workspace row auto-completes `@工作区名/`
      // and the note list of that workspace pops up (filtered from then on).
      const slash = query.indexOf('/')
      const prefix = slash === -1 ? query : query.slice(0, slash)
      const rest = slash === -1 ? '' : query.slice(slash + 1)

      // Workspace entered (slash, or exact bare workspace name): only that
      // workspace's notes, filtered by `rest`.
      if (slash !== -1 || prefix !== '') {
        // Warm the session's own workspace list in parallel so a pick can
        // compute the session-relative path (settled backs onPick).
        const [all, _sessionWs] = await Promise.all([
          fetchAll(),
          fetchCurrent(session.sessionId),
        ])
        if (signal.aborted) return []
        if (!all.ok || all.workspaces === undefined) return []
        if (all.workspaces.some((w) => typeof w.notesDir !== 'string' || w.notesDir === '')) {
          warnStaleHost()
          return []
        }
        const ws = all.workspaces.find((w) => w.name === prefix)
        if (ws !== undefined) {
          const { rows, refs } = rowsFor(ws, rest, true)
          candidateRefs.set(session.sessionId, refs)
          candidateWorkspaces.set(session.sessionId, new Map())
          return rows
        }
        // A `@工作区名/` prefix matching no workspace yields nothing.
        if (slash !== -1) return []
      }

      // Bare partial name (or just `@`): fuzzy workspace rows + current notes.
      const all = await fetchAll()
      if (signal.aborted) return []
      if (!all.ok || all.workspaces === undefined) return []
      if (all.workspaces.some((w) => typeof w.notesDir !== 'string' || w.notesDir === '')) {
        warnStaleHost()
        return []
      }
      const wsRows: InputTriggerCandidate[] = []
      const wsMap = new Map<InputTriggerCandidate, string>()
      if (query !== '') {
        const q = query.toLowerCase()
        for (const w of all.workspaces) {
          if (!w.name.toLowerCase().includes(q)) continue
          // Trailing slash on the row shows the completion target and keeps
          // the row distinct from note titles.
          const candidate: InputTriggerCandidate = {
            name: `${w.name}/`,
            description: t('context.workspaceRow'),
            icon: 'folder',
          }
          wsRows.push(candidate)
          wsMap.set(candidate, w.name)
        }
      }
      candidateWorkspaces.set(session.sessionId, wsMap)
      try {
        const workspaces = await fetchCurrent(session.sessionId)
        if (signal.aborted) return []
        const ws = workspaces[0]
        if (ws === undefined) return wsRows
        // Stale host (pre-`notesDir`): candidates still list fine, but a pick
        // cannot build the reference — surface the restart need early.
        if (typeof ws.notesDir !== 'string' || ws.notesDir === '') {
          warnStaleHost()
          return wsRows
        }
        const { rows: noteRows, refs } = rowsFor(ws, query, false)
        candidateRefs.set(session.sessionId, refs)
        return [...wsRows, ...noteRows]
      } catch {
        return wsRows
      }
    },
    onPick({ candidate, session, span }) {
      // Workspace fuzzy row: auto-complete `@工作区名/` (the trigger span is
      // replaced; re-detection pops that workspace's note list). Machine-driven
      // draft changes never pass through onChange, so re-track explicitly.
      const wsName = candidateWorkspaces.get(session.sessionId)?.get(candidate)
      if (wsName !== undefined) {
        const text = `@${wsName}/`
        reTrack?.(session.sessionId, span.start + text.length)
        return { text }
      }
      const ref = candidateRefs.get(session.sessionId)?.get(candidate)
      if (ref === undefined) return undefined // stale generation → miss (nothing inserted)
      // Guard the stale-host window: without notesDir there is no path
      // identity — report it instead of crashing on `undefined`.
      if (typeof ref.ws.notesDir !== 'string' || ref.ws.notesDir === '') {
        warnStaleHost()
        return undefined
      }
      // Serialized path: RELATIVE to the session workspace root — the model's
      // `read` resolves against its session cwd (the workspace root). Same
      // workspace → `.dsh-notes/<name>`; other workspaces → `../<dir>/.dsh-notes/<name>`.
      // A `<工作区名>/…` prefix can NEVER resolve (the workspace is not nested
      // inside itself), so the workspace title is omitted from the path.
      const sessionWs = settled.get(session.sessionId)?.[0]
      const sessionRoot = sessionWs !== undefined && typeof sessionWs.notesDir === 'string'
        ? parentDir(sessionWs.notesDir)
        : undefined
      // Fallback when the session workspace is unknown (its list fetch never
      // settled): use the ABSOLUTE note path (directory name, never the title
      // — a workspace title can be renamed while its directory stays fixed, so
      // a title-derived path would point at a nonexistent location).
      const path = sessionRoot !== undefined
        ? relFrom(sessionRoot, refPath(ref.ws, ref.note))
        : refPath(ref.ws, ref.note)
      const insert: ReferenceInsert = {
        source: NOTES_SOURCE,
        ref: path,
        label: chipLabel(candidate.name),
        // Reserved out-of-band `appearance`: dsh renders the chip's domain
        // glyph through ReferenceIcon, which only knows the three built-in
        // kinds. A custom value keeps `data-reference-appearance="notes"` on
        // the chip — the exact scope our global stylesheet uses to paint the
        // plugin logo — while ReferenceIcon renders nothing for it (no default
        // arm). The `as unknown as 'file'` satisfies the closed union type.
        appearance: 'notes' as unknown as 'file',
        clipboardText: ref.crossWs ? `@${ref.ws.name}/${candidate.name}` : `@${candidate.name}`,
      }
      return { insert }
    },
    codec: {
      // The pipeline copies chips from the insert-time clipboardText, so this
      // ref-only projection is a fallback for other consumers.
      clipboardText: (ref) => ref,
      async serialize(ref, signal) {
        // Revalidate at submit time: the note may have been deleted/moved
        // since the pick. A failure blocks the send (dsh contract) — surface
        // the missing note by name instead of silently dropping it.
        const list = await api('list', undefined, signal)
        if (!list.ok || list.workspaces === undefined) {
          throw new Error(t('context.errCheck'))
        }
        // Stale host: no notesDir means no path identity — surface it.
        if (list.workspaces.some((w) => typeof w.notesDir !== 'string' || w.notesDir === '')) {
          warnStaleHost()
          throw new Error(t('context.errCheck'))
        }
        const workspaces = list.workspaces
        // Resolve the ref to its owning workspace + note (three-branch logic:
        // absolute prefix / dot-relative / wsName fallback — resolve.ts).
        const found = resolveNoteRef(workspaces, ref)
        const note = found?.owner.notes.find((n) => n.name === found.name)
        if (found === undefined || note === undefined) {
          const basename = ref.slice(ref.lastIndexOf('/') + 1).replace(/\.md$/i, '')
          throw new Error(t('context.noteMissing', { name: basename }))
        }
        // Standard markdown file-reference syntax: `[标题](路径)` binds the
        // title and the path as one structured token — the model extracts the
        // path reliably, and any markdown renderer (including a future note
        // jump feature) recognizes it as a link. The title is escaped for
        // markdown link syntax (brackets/parens); the path is the same
        // workspace-relative reference as before.
        const title = note.title.replace(/]/g, '\\]').replace(/\(/g, '\\(')
        return t('context.reference', { title, path: ref })
      },
    },
    warm(session) {
      // Fire-and-forget scope-birth prewarm; the shared fetch reports
      // through candidates.
      void fetchCurrent(session.sessionId).catch(() => {})
      void fetchAll().catch(() => {})
    },
    lexicon(session) {
      const ws = settled.get(session.sessionId)?.[0]
      if (ws === undefined) return undefined
      return ws.notes.map((n) => n.title)
    },
    subscribeLexicon(session, listener) {
      const key = session.sessionId
      const listeners = lexiconListeners.get(key) ?? new Set()
      listeners.add(listener)
      lexiconListeners.set(key, listeners)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) lexiconListeners.delete(key)
      }
    },
  }

  return {
    source,
    dispose: () => {
      fetches.clear()
      settled.clear()
      lexiconListeners.clear()
      candidateRefs.clear()
      candidateWorkspaces.clear()
      allFetch = null
      allSettled = null
    },
  }
}
