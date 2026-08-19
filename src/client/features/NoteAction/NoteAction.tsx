/**
 * Assistant-message action: notes icon opens the note picker for one answer.
 * Rendered in `conversation.chat.assistant-actions`; mirrors the shared
 * message IconActions chrome (copy / feedback): 28px circle, tertiary ink,
 * interactive hover fill, and a bottom Tooltip like the copy button.
 *
 * The click captures the answer text + the preceding question from the
 * client-side conversation snapshot (`useSession`) and stores them in the
 * picker state — the host appends the text to the note file directly, so no
 * session-log re-read happens on the host (docs/context.md).
 * @module dsh-md-notes/client/NoteAction
 */

import * as React from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { NotesUiStore } from '../store.ts'
import { captureMessageText } from '../note-text.ts'
import { ICON_URL } from '../api.ts'
import styles from './note-action.module.css'

export interface NoteActionProps {
  sessionId: string
  messageId: string
  /** Framework-injected conversation snapshot selector (session-scope kit). */
  useSession: SnapshotSelectorHook<ConversationSnapshot>
  /** Resolve the session's durable title (client-side sessions list). */
  getSessionTitle: (sessionId: string) => string
  /** Shared store; opening the picker sets `picker`. */
  store: NotesUiStore
  /** Framework-injected locale seat (`md-notes` namespace). */
  t: TranslateNS<'md-notes'>
}

/**
 * The per-answer note action button.
 */
export function NoteAction(props: NoteActionProps): React.ReactElement {
  const { sessionId, messageId, useSession, getSessionTitle, store, t } = props
  const snap = useSession((s) => s)
  const openPicker = (): void => {
    // Capture the text in the browser (like the copy button) — the host
    // append then only writes the file, no session query (docs/context.md).
    // Image placeholder follows the UI language ([图片] / [image]).
    const captured = captureMessageText(snap.chat.legacy.nodes, messageId, t('picker.labelImage'))
    if (captured === null) return
    store.update((d) => {
      d.picker = {
        questionText: captured.questionText,
        answerText: captured.answerText,
        sessionTitle: getSessionTitle(sessionId),
      }
    })
  }
  return (
    <Tooltip label={t('action.tooltip')} side="bottom">
      <button
        type="button"
        className={styles.action}
        aria-label={t('action.tooltip')}
        onClick={openPicker}
      >
        <img src={ICON_URL} width={16} height={16} alt="" className={styles.actionSvg} />
      </button>
    </Tooltip>
  )
}
