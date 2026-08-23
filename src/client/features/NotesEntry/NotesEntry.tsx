/**
 * Sidebar footer entry: notes icon opens the notes manager. Rendered in
 * `sidebar.footer.action`; mirrors the Settings trigger geometry (34px compact
 * row / 36px rail circle, 12px radius, interactive hover fill, 14/22 text on
 * primary ink) so the footer reads as one row. Owns its full-width top row via
 * a `data-md-notes-entry` marker + an injected `:has()` rule — no inline styles
 * are ever written onto any ancestor.
 * @module dsh-md-notes/client/NotesEntry
 */

import * as React from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NotesUiStore } from '../store.ts'
import { busyCount } from '../busy.ts'
import { ICON_URL } from '../api.ts'
import { useUpdateAvailable } from '../update.ts'
import { LoadingIndicator } from '../components/LoadingIndicator/LoadingIndicator.tsx'
import styles from './notes-entry.module.css'

export interface NotesEntryProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
  /** Shared store; opening the manager sets `managerOpen`. */
  store: NotesUiStore
  /** Framework-injected locale seat (`md-notes` namespace). */
  t: TranslateNS<'md-notes'>
}

/**
 * The sidebar entry button.
 */
export function NotesEntry(props: NotesEntryProps): React.ReactElement {
  const { wide, store, t } = props
  const update = useUpdateAvailable()
  // Any in-flight write shows here (busy slice counts all domains; note
  // writes are the only domain today — see docs/write-lock.md §7.1).
  const writingCount = React.useSyncExternalStore(
    store.subscribe,
    () => busyCount(store.getSnapshot()),
  )
  return (
    <div className={styles.notesRow} data-md-notes-entry="">
      <button
        type="button"
        className={wide ? styles.entry : `${styles.entry} ${styles.entryRail}`}
        title={t('sidebar.entry')}
        aria-label={t('sidebar.entry')}
        onClick={() => store.update((d) => { d.managerOpen = true })}
      >
        <span className={styles.entryMain}>
          <img
            src={ICON_URL}
            width={wide ? 16 : 18}
            height={wide ? 16 : 18}
            alt=""
            className={styles.entrySvg}
          />
          {wide ? <span className={styles.entryLabel}>{t('sidebar.label')}</span> : null}
        </span>
        {wide && writingCount > 0 && (
          <Tooltip label={t('sidebar.writingTitle', { count: writingCount })} side="bottom">
            <span className={styles.writingIndicator}><LoadingIndicator size={12} /></span>
          </Tooltip>
        )}
        {wide && update !== null && (
          <span className={styles.updateTag} title={t('sidebar.updateTitle', { latest: update.latest })}>
            {t('sidebar.updateTag')}
          </span>
        )}
      </button>
    </div>
  )
}
