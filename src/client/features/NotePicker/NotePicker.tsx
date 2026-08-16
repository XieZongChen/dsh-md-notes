/**
 * Note picker popup (记入笔记): choose or create a note, then append the
 * addressed answer's conversation to it. All UI copy comes from the
 * `md-notes` locale namespace via `t`.
 * @module dsh-md-notes/client/NotePicker
 */

import * as React from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NoteSummary } from '../api.ts'
import { api, ICON_URL } from '../api.ts'
import type { NotesStore } from '../store.ts'
import type { MdNotesKey } from '../locales/index.ts'
import shared from '../styles.module.css'
import styles from './note-picker.module.css'

/** Status line state: a locale key plus optional template params. */
type Status = '' | { key: MdNotesKey; params?: Record<string, unknown> }

export interface NotePickerProps {
  sessionId: string
  messageId: string
  /** Shared store; closing the picker clears `picker`. */
  store: NotesStore
  /** Framework-injected locale seat (`md-notes` namespace). */
  t: TranslateNS<'md-notes'>
}

/**
 * The note-selection popup.
 */
export function NotePicker(props: NotePickerProps): React.ReactElement {
  const { sessionId, messageId, store, t } = props
  const [notes, setNotes] = React.useState<NoteSummary[]>([])
  const [noWorkspaces, setNoWorkspaces] = React.useState(false)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [newTitle, setNewTitle] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState<Status>('')

  React.useEffect(() => {
    void api('list', { sessionId }).then((res) => {
      setNoWorkspaces(res.ok === true && res.noWorkspaces === true)
      if (res.ok && res.workspaces) {
        const notes = res.workspaces.flatMap((w) => w.notes)
        setNotes(notes)
        if (notes.length > 0) setSelected(notes[0]!.name)
      }
    })
  }, [sessionId])

  const createAndPick = (): void => {
    if (noWorkspaces) { setStatus({ key: 'picker.noWorkspaces' }); return }
    const title = newTitle.trim()
    setBusy(true)
    void api('create', { title, sessionId }).then((res) => {
      setBusy(false)
      if (res.ok && res.name) {
        setSelected(res.name)
        setNewTitle('')
        return api('list', { sessionId })
      }
      setStatus({ key: 'picker.createFailed' })
      return null
    }).then((res) => { if (res?.ok && res.workspaces) setNotes(res.workspaces.flatMap((w) => w.notes)) })
  }

  const send = (): void => {
    if (noWorkspaces) { setStatus({ key: 'picker.noWorkspaces' }); return }
    if (!selected) { setStatus({ key: 'picker.needSelect' }); return }
    setBusy(true)
    setStatus({ key: 'picker.writing' })
    void api('appendConversation', { noteName: selected, sessionId, messageId }).then((res) => {
      setBusy(false)
      if (res.ok) {
        setStatus({ key: 'picker.written' })
        window.setTimeout(() => store.set({ picker: null }), 900)
      } else {
        setStatus({ key: 'picker.writeFailed', params: { error: res.error } })
      }
    })
  }

  const close = (): void => store.set({ picker: null })

  return (
    <div className={shared.mask} onClick={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className={styles.dialog}>
        <div className={styles.dialogHead}>
          <img src={ICON_URL} width={16} height={16} alt="" className={styles.dialogIcon} />
          <span className={styles.dialogTitle}>{t('picker.title')}</span>
          <button type="button" className={shared.iconBtn} onClick={close} title={t('picker.close')}>✕</button>
        </div>
        <div className={styles.dialogBody}>
          {noWorkspaces
            ? <div className={shared.empty}>{t('picker.noWorkspaces')}</div>
            : notes.length === 0
              ? <div className={shared.empty}>{t('picker.empty')}</div>
              : <div className={styles.pickList}>
                {notes.map((n) => (
                  <div
                    key={n.name}
                    className={selected === n.name ? `${styles.pickItem} ${styles.pickItemActive}` : styles.pickItem}
                    onClick={() => setSelected(n.name)}
                  >
                    <span className={styles.pickRadio}>{selected === n.name ? '●' : '○'}</span>
                    <span>{n.title}</span>
                  </div>
                ))}
              </div>}
          <div className={styles.newRow}>
            <input
              className={shared.input}
              placeholder={t('picker.newPlaceholder')}
              value={newTitle}
              disabled={noWorkspaces}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createAndPick() }}
            />
            <button type="button" className={shared.btn} onClick={createAndPick} disabled={busy || noWorkspaces}>{t('picker.new')}</button>
          </div>
          <div className={styles.status}>{status === '' ? '' : t(status.key, status.params)}</div>
        </div>
        <div className={styles.dialogFoot}>
          <button type="button" className={`${shared.btn} ${shared.btnPrimary}`} onClick={send} disabled={busy || !selected || noWorkspaces}>
            {busy ? t('picker.writing') : t('picker.write')}
          </button>
        </div>
      </div>
    </div>
  )
}
