/**
 * One note row in the workspace list.
 * @module dsh-md-notes/client/NotesManager/components/NoteItem
 */

import * as React from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { LoadingIndicator } from '../../components/LoadingIndicator/LoadingIndicator.tsx'
import type { NoteSummary } from '../../api.ts'
import { fmtTime } from '../../markdown.ts'
import styles from './notes-manager.module.css'

interface NoteItemProps {
  note: NoteSummary
  active: boolean
  writing: boolean
  onOpen: () => void
  onRemove: () => void
  t: TranslateNS<'md-notes'>
}

export function NoteItem({ note, active, writing, onOpen, onRemove, t }: NoteItemProps): React.ReactElement {
  return (
    <div className={active ? `${styles.noteItem} ${styles.noteItemActive}` : styles.noteItem} onClick={onOpen}>
      <div className={styles.noteMain}>
        <div className={styles.noteTitle}>{note.title}</div>
        <div className={styles.noteTime}>{fmtTime(note.updatedAt)}</div>
      </div>
      {writing
        ? <span className={styles.noteWriting}><LoadingIndicator size={12} /></span>
        : (
          <button type="button" className={styles.noteDel} title={t('manager.delete')} onClick={(e) => { e.stopPropagation(); onRemove() }}>
            🗑
          </button>
        )}
    </div>
  )
}
