/**
 * dsh-md-notes `@` reference source for the dsh input-trigger pipeline
 * (`ui-input-trigger`). Candidates are notes: by default the session's own
 * workspace; typing `@工作区名/` (ASCII names only) switches to that
 * workspace. A pick inserts a chip whose `ref` is the note's ABSOLUTE path
 * (`<ws>/.dsh-notes/<name>.md`) — workspace + name, unambiguous across
 * workspaces — and the codec serializes each chip at submit time to a
 * localized, readable path reference the model can `read` (fs sandbox reads
 * pass through, so cross-workspace paths work). A missing note at submit
 * time blocks the send with a localized notice (never a silent downgrade).
 *
 * Plain-text `@标题` is decorative only (the lexicon hot roll highlights
 * exact `[\w-]+` matches); real references always go through the chip.
 * @module dsh-md-notes/client/ContextSource
 */

import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  InputTriggerCandidate, InputTriggerSource, ReferenceInsert,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NoteSummary, WorkspaceNotes } from '../api.ts'
import { api } from '../api.ts'
// Side-effect: inject the widened DshChipCell @font-face (chip label capacity).
import './chip-cell.module.css'

/** Source identity: the menu group title and the chip `source` field. */
export const NOTES_SOURCE = 'md-notes'

/** Cross-workspace trigger prefix: `@<ascii-workspace-name>/<rest>`. */
const CROSS_WS_RE = /^([\w-]+)\/([\s\S]*)$/

/** Candidate row glyph (the pipeline renders `icon` as text — a URL cannot
 *  render an image, so a small emoji stands in for the plugin SVG). */
const NOTE_ICON = '📝'

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
  // The client bundle updates via a page refresh alone, but the host half is
  // loaded at process start — a restart of dsh web is required for the new
  // `list` response shape (`notesDir`) to take effect.
  console.error('[dsh-md-notes] stale host: the list response lacks "notesDir"; restart dsh web so the host loads the updated plugin')
}

/** Absolute path of one note (the chip ref; workspace + name, unambiguous). */
function refPath(ws: WorkspaceNotes, note: NoteSummary): string {
  return ws.notesDir.endsWith('/') ? ws.notesDir + note.name : `${ws.notesDir}/${note.name}`
}

/**
 * Chip display label. dsh renders the chip label inside a fixed-width cell
 * (10em after our DshChipCell override, ~4em upstream) centered with
 * overflow hidden — a too-long label clips BOTH ends showing an unreadable
 * middle slice. Front-truncate instead so the chip always shows the note's
 * beginning (+ '…' as a truncation marker) and stays narrow.
 */
function chipLabel(title: string): string {
  return title.length > 18 ? `${title.slice(0, 18)}…` : title
}

/** The `@` source plus its teardown (clears per-session caches). */
export interface NotesSourceBundle {
  source: InputTriggerSource
  dispose: () => void
}

/**
 * Build the `@` notes source. All state lives in the returned closure;
 * `dispose` clears it (the registering effect calls it on HMR/unmount).
 * @param t - bound `md-notes` translate (localized error copy).
 */
export function createNotesSource(t: TranslateNS<'md-notes'>): NotesSourceBundle {
  /** Single-flight current-workspace list per session (shared by warm + candidates). */
  const fetches = new Map<SessionId, Promise<readonly WorkspaceNotes[]>>()
  /** Settled current-workspace list per session (backs the synchronous lexicon). */
  const settled = new Map<SessionId, readonly WorkspaceNotes[]>()
  /** Lexicon invalidation listeners per session. */
  const lexiconListeners = new Map<SessionId, Set<() => void>>()
  /** Latest candidate generation per session: candidate object → note identity. */
  const candidateRefs = new Map<SessionId, Map<InputTriggerCandidate, NoteRef>>()

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

  /** Fetch (and cache) the session workspace's notes; settles the lexicon roll. */
  const fetchCurrent = (sessionId: SessionId, signal?: AbortSignal): Promise<readonly WorkspaceNotes[]> => {
    const existing = fetches.get(sessionId)
    if (existing !== undefined) return existing
    const promise = (async () => {
      const res = await api('list', { sessionId }, signal)
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
      // `@工作区名/…` → that workspace's notes; anything else → the session's.
      const cross = CROSS_WS_RE.exec(query)
      if (cross !== null) {
        const all = await api('list', undefined, signal)
        if (signal.aborted) return []
        if (!all.ok || all.workspaces === undefined) return []
        if (all.workspaces.some((w) => typeof w.notesDir !== 'string' || w.notesDir === '')) {
          warnStaleHost()
          return []
        }
        const ws = all.workspaces.find((w) => w.name === cross[1])
        if (ws === undefined) return []
        const { rows, refs } = rowsFor(ws, cross[2] ?? '', true)
        candidateRefs.set(session.sessionId, refs)
        return rows
      }
      try {
        const workspaces = await fetchCurrent(session.sessionId, signal)
        if (signal.aborted) return []
        const ws = workspaces[0]
        if (ws === undefined) return []
        // Stale host (pre-`notesDir`): candidates still list fine, but a pick
        // cannot build the absolute ref — surface the restart need early.
        if (typeof ws.notesDir !== 'string' || ws.notesDir === '') {
          warnStaleHost()
          return []
        }
        const { rows, refs } = rowsFor(ws, query, false)
        candidateRefs.set(session.sessionId, refs)
        return rows
      } catch {
        return []
      }
    },
    onPick({ candidate, session }) {
      const ref = candidateRefs.get(session.sessionId)?.get(candidate)
      if (ref === undefined) return undefined // stale generation → miss (nothing inserted)
      // Guard the stale-host window: without notesDir there is no absolute
      // path to reference — report it instead of crashing on `undefined`.
      if (typeof ref.ws.notesDir !== 'string' || ref.ws.notesDir === '') {
        warnStaleHost()
        return undefined
      }
      const insert: ReferenceInsert = {
        source: NOTES_SOURCE,
        ref: refPath(ref.ws, ref.note),
        label: chipLabel(candidate.name),
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
        const owner = list.workspaces.find((ws) =>
          ref.startsWith(ws.notesDir.endsWith('/') ? ws.notesDir : `${ws.notesDir}/`))
        const name = owner === undefined ? '' : ref.slice(owner.notesDir.length + (owner.notesDir.endsWith('/') ? 0 : 1))
        const note = owner?.notes.find((n) => n.name === name)
        if (owner === undefined || note === undefined) {
          const basename = ref.slice(ref.lastIndexOf('/') + 1).replace(/\.md$/i, '')
          throw new Error(t('context.noteMissing', { name: basename }))
        }
        // Localized, readable path reference: the title in 「」 and the
        // absolute path after the colon. The model reads the path with its
        // `read` tool (fs reads pass through the sandbox, cross-workspace
        // included); the line also reads naturally in the sent message.
        return t('context.reference', { title: note.title, path: ref })
      },
    },
    warm(session) {
      // Fire-and-forget scope-birth prewarm; the shared fetch reports
      // through candidates.
      void fetchCurrent(session.sessionId).catch(() => {})
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
    },
  }
}
