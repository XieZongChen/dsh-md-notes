/**
 * Assistant-message action: notes icon opens the note picker for one answer.
 * Rendered in `conversation.chat.assistant-actions`; mirrors the shared
 * message IconActions chrome (copy / feedback): 28px circle, tertiary ink,
 * interactive hover fill, and a bottom Tooltip like the copy button.
 * @module dsh-md-notes/client/NoteAction
 */

import * as React from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NotesStore } from '../store.ts'
import { ICON_URL } from '../api.ts'
import styles from './note-action.module.css'

export interface NoteActionProps {
  sessionId: string
  messageId: string
  /** Shared store; opening the picker sets `picker`. */
  store: NotesStore
  /** Framework-injected locale seat (`md-notes` namespace). */
  t: TranslateNS<'md-notes'>
}

/**
 * The per-answer note action button.
 */
export function NoteAction(props: NoteActionProps): React.ReactElement {
  const { sessionId, messageId, store, t } = props
  return (
    <Tooltip label={t('action.tooltip')} side="bottom">
      <button
        type="button"
        className={styles.action}
        aria-label={t('action.tooltip')}
        onClick={() => store.set({ picker: { sessionId, messageId } })}
      >
        <img src={ICON_URL} width={16} height={16} alt="" className={styles.actionSvg} />
      </button>
    </Tooltip>
  )
}
