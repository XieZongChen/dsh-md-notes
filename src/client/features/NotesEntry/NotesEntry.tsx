/**
 * Sidebar footer entry: notes icon opens the notes manager. Rendered in
 * `sidebar.footer.action`; mirrors the Settings trigger geometry (34px compact
 * row / 36px rail circle, 12px radius, interactive hover fill, 14/22 text on
 * primary ink) so the footer reads as one row. Forces the footer flex
 * container to wrap so this entry occupies its own full-width top row.
 * @module dsh-md-notes/client/NotesEntry
 */

import * as React from 'react'
import type { NotesStore } from '../store.ts'
import { ICON_URL } from '../api.ts'
import styles from './notes-entry.module.css'

export interface NotesEntryProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
  /** Shared store; opening the manager sets `managerOpen`. */
  store: NotesStore
}

/**
 * The sidebar entry button.
 */
export function NotesEntry(props: NotesEntryProps): React.ReactElement {
  const { wide, store } = props
  const rowRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    const el = rowRef.current
    if (!el) return
    const patched: Array<[HTMLElement, string]> = []
    let node = el.parentElement
    let hops = 0
    while (node && hops < 4) {
      const prev = node.style.flexWrap
      if (prev !== 'wrap') {
        node.style.flexWrap = 'wrap'
        patched.push([node, prev])
      }
      node = node.parentElement
      hops++
    }
    return () => { for (const [n, prev] of patched) n.style.flexWrap = prev }
  }, [])

  return (
    <div ref={rowRef} className={styles.notesRow}>
      <button
        type="button"
        className={wide ? styles.entry : `${styles.entry} ${styles.entryRail}`}
        title="MD 笔记"
        aria-label="MD 笔记"
        onClick={() => store.set({ managerOpen: true })}
      >
        <img
          src={ICON_URL}
          width={wide ? 16 : 18}
          height={wide ? 16 : 18}
          alt=""
          className={styles.entrySvg}
        />
        {wide ? <span className={styles.entryLabel}>笔记</span> : null}
      </button>
    </div>
  )
}
