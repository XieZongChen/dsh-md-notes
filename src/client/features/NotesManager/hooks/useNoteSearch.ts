/**
 * Debounced search driver for the manager search box (docs/search.md §5):
 * 250ms debounce + an AbortController per keystroke generation. The exposed
 * results always belong to the newest SETTLED query — while typing, previous
 * results stay visible under a `searching` phase instead of flashing empty.
 * @module dsh-md-notes/client/NotesManager/hooks/useNoteSearch
 */

import * as React from 'react'
import type { NoteHits } from '../../api.ts'
import { api } from '../../api.ts'

export type SearchPhase = 'idle' | 'searching' | 'done' | 'error'

/** The search box's view state for the current query. */
export interface SearchView {
  phase: SearchPhase
  results: NoteHits[]
  truncated: boolean
}

const IDLE: SearchView = { phase: 'idle', results: [], truncated: false }
const DEBOUNCE_MS = 250

export function useNoteSearch(query: string): SearchView {
  const trimmed = query.trim()
  /** The last settled response, keyed by the query it answers. */
  const [settled, setSettled] = React.useState<{ query: string; view: SearchView }>({ query: '', view: IDLE })

  React.useEffect(() => {
    if (trimmed === '') {
      setSettled((prev) => (prev.query === '' ? prev : { query: '', view: IDLE }))
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      // api() never rejects (transport failures become its ApiError branch);
      // an aborted call is a superseded generation — its response is dropped.
      void api('search', { query: trimmed }, controller.signal).then((res) => {
        if (controller.signal.aborted) return
        setSettled(res.ok
          ? { query: trimmed, view: { phase: 'done', results: res.results ?? [], truncated: res.truncated === true } }
          : { query: trimmed, view: { phase: 'error', results: [], truncated: false } })
      })
    }, DEBOUNCE_MS)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [trimmed])

  if (trimmed === '') return settled.view.phase === 'idle' ? settled.view : IDLE
  if (settled.query === trimmed) return settled.view
  return { phase: 'searching', results: settled.view.results, truncated: settled.view.truncated }
}
