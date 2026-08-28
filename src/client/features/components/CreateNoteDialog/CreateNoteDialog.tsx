/**
 * CreateNoteDialog — the shared "new note" form used by both the notes
 * manager and the note picker. It lets the user choose a title and an
 * optional file name at creation time (the file name defaults to a slug of
 * the title when left empty), so the file name and the display title are
 * decoupled from the start instead of freezing the first default title.
 *
 * The file name must be unique within the target workspace (it is the note's
 * on-disk identity); the dialog predicts the resulting file name and rejects
 * duplicates before submitting. Titles may repeat freely (they are only the
 * `# heading` / display label). All UI copy comes from the `md-notes` locale
 * namespace via `t`.
 * @module dsh-md-notes/client/CreateNoteDialog
 */

import * as React from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { DshInput } from '../DshInput/DshInput.tsx'
import { LoadingIndicator } from '../LoadingIndicator/LoadingIndicator.tsx'
import { fileNameKey, sanitizeFileName } from '../../sanitize.ts'
import shared from '../../styles.module.css'
import styles from './create-note-dialog.module.css'

export interface CreateNoteDialogProps {
  /** Pre-filled title (typically a localized "Untitled note <date>"). */
  defaultTitle: string
  /** Existing file names in the target workspace (for duplicate validation). */
  existingNames: readonly string[]
  /** True while the create request is in flight (disables the confirm button). */
  busy: boolean
  /** Framework-injected locale seat (`md-notes` namespace). */
  t: TranslateNS<'md-notes'>
  /** Close the dialog without creating. */
  onCancel: () => void
  /** Create with the finalized title and file name (name may be '' → derive). */
  onSubmit: (title: string, name: string) => void
}

/** The shared new-note form. */
export function CreateNoteDialog(props: CreateNoteDialogProps): React.ReactElement {
  const { defaultTitle, existingNames, busy, t, onCancel, onSubmit } = props
  const [title, setTitle] = React.useState(defaultTitle)
  const [name, setName] = React.useState('')

  const effectiveTitle = title.trim() !== '' ? title.trim() : defaultTitle
  const effectiveName = name.trim() !== '' ? sanitizeFileName(name) : sanitizeFileName(effectiveTitle)
  const duplicate = existingNames.some((n) => fileNameKey(n) === fileNameKey(effectiveName))
  const blocked = busy || duplicate

  const submit = (): void => {
    if (blocked) return
    onSubmit(effectiveTitle, name.trim())
  }

  return (
    <Modal
      open
      title={t('create.title')}
      closeLabel={t('create.cancel')}
      onClose={onCancel}
      footer={(
        <>
          <button type="button" className={shared.btn} onClick={onCancel}>
            {t('create.cancel')}
          </button>
          <button type="button" className={`${shared.btn} ${shared.btnPrimary}`} disabled={blocked} onClick={submit}>
            {busy && <LoadingIndicator size={12} />}{t('create.confirm')}
          </button>
        </>
      )}
    >
      <div className={styles.body}>
        <label className={styles.field}>
          <span className={styles.label}>{t('create.titleLabel')}</span>
          <DshInput
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('create.nameLabel')}</span>
          <DshInput
            value={name}
            placeholder={t('create.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          />
        </label>
        <div className={styles.hint}>{t('create.nameHint')}</div>
        <div className={styles.predict}>{t('create.willCreate', { name: effectiveName })}</div>
        {duplicate && <div className={styles.error}>{t('create.duplicate')}</div>}
      </div>
    </Modal>
  )
}
