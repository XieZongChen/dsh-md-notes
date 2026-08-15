/**
 * Assistant-message action: notes icon opens the note picker for one answer.
 * Rendered in `conversation.chat.assistant-actions`; mirrors the shared
 * message IconActions chrome (copy / feedback): 28px circle, tertiary ink,
 * interactive hover fill, and a bottom Tooltip like the copy button.
 * @module dsh-md-notes/client/NoteAction
 */

import * as React from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NotesStore } from '../store.ts'
import { ICON_URL } from '../api.ts'
import styles from './note-action.module.css'

export interface NoteActionProps {
  sessionId: string
  messageId: string
  /** Shared store; opening the picker sets `picker`. */
  store: NotesStore
}

/**
 * The per-answer note action button.
 */
export function NoteAction(props: NoteActionProps): React.ReactElement {
  const { sessionId, messageId, store } = props
  return (
    <Tooltip label="发送到笔记" side="bottom">
      <button
        type="button"
        className={styles.action}
        aria-label="发送到笔记"
        onClick={() => store.set({ picker: { sessionId, messageId } })}
      >
        <img src={ICON_URL} width={16} height={16} alt="" className={styles.actionSvg} />
      </button>
    </Tooltip>
  )
}
