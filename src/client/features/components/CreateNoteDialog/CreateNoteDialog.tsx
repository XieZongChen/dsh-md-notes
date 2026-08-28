/**
 * CreateNoteDialog — the shared "new note" form used by both the notes
 * manager and the note picker. It lets the user choose a title and an
 * optional file name at creation time (the file name defaults to a slug of
 * the title when left empty), so the file name and the display title are
 * decoupled from the start instead of freezing the first default title.
 * All UI copy comes from the `md-notes` locale namespace via `t`.
 * @module dsh-md-notes/client/CreateNoteDialog
 */

import * as React from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { DshInput } from '../DshInput/DshInput.tsx'
import { LoadingIndicator } from '../LoadingIndicator/LoadingIndicator.tsx'
import shared from '../../styles.module.css'
import styles from './create-note-dialog.module.css'

export interface CreateNoteDialogProps {
  /** Pre-filled title (typically a localized "Untitled note <date>"). */
  defaultTitle: string
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
  const { defaultTitle, busy, t, onCancel, onSubmit } = props
  const [title, setTitle] = React.useState(defaultTitle)
  const [name, setName] = React.useState('')

  const submit = (): void => {
    const trimmedTitle = title.trim()
    onSubmit(trimmedTitle !== '' ? trimmedTitle : defaultTitle, name.trim())
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
          <button type="button" className={`${shared.btn} ${shared.btnPrimary}`} disabled={busy} onClick={submit}>
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
      </div>
    </Modal>
  )
}
