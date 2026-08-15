/**
 * Note picker popup (记入笔记): choose or create a note, then append the
 * addressed answer's conversation to it.
 * @module dsh-md-notes/client/NotePicker
 */

import * as React from 'react'
import type { NoteSummary } from '../api.ts'
import { api, ICON_URL } from '../api.ts'
import type { NotesStore } from '../store.ts'
import shared from '../styles.module.css'
import styles from './note-picker.module.css'

export interface NotePickerProps {
  sessionId: string
  messageId: string
  /** Shared store; closing the picker clears `picker`. */
  store: NotesStore
}

/**
 * The note-selection popup.
 */
export function NotePicker(props: NotePickerProps): React.ReactElement {
  const { sessionId, messageId, store } = props
  const [notes, setNotes] = React.useState<NoteSummary[]>([])
  const [selected, setSelected] = React.useState<string | null>(null)
  const [newTitle, setNewTitle] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState('')

  React.useEffect(() => {
    void api('list').then((res) => {
      if (res.ok && res.notes) {
        setNotes(res.notes)
        if (res.notes.length > 0) setSelected(res.notes[0]!.name)
      }
    })
  }, [])

  const createAndPick = (): void => {
    const title = newTitle.trim()
    setBusy(true)
    void api('create', { title }).then((res) => {
      setBusy(false)
      if (res.ok && res.name) {
        setSelected(res.name)
        setNewTitle('')
        return api('list')
      }
      setStatus('创建失败')
      return null
    }).then((res) => { if (res?.ok && res.notes) setNotes(res.notes) })
  }

  const send = (): void => {
    if (!selected) { setStatus('请先选择或新建一篇笔记'); return }
    setBusy(true)
    setStatus('写入中…')
    void api('appendConversation', { noteName: selected, sessionId, messageId }).then((res) => {
      setBusy(false)
      if (res.ok) {
        setStatus('已写入 ✓')
        window.setTimeout(() => store.set({ picker: null }), 900)
      } else {
        setStatus(`写入失败: ${res.error}`)
      }
    })
  }

  const close = (): void => store.set({ picker: null })

  return (
    <div className={shared.mask} onClick={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className={styles.dialog}>
        <div className={styles.dialogHead}>
          <img src={ICON_URL} width={16} height={16} alt="" className={styles.dialogIcon} />
          <span className={styles.dialogTitle}>记入笔记</span>
          <button type="button" className={shared.iconBtn} onClick={close} title="关闭">✕</button>
        </div>
        <div className={styles.dialogBody}>
          {notes.length === 0
            ? <div className={shared.empty}>还没有笔记，先在下方新建一篇</div>
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
              placeholder="新建笔记标题…"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createAndPick() }}
            />
            <button type="button" className={shared.btn} onClick={createAndPick} disabled={busy}>新建</button>
          </div>
          <div className={styles.status}>{status}</div>
        </div>
        <div className={styles.dialogFoot}>
          <button type="button" className={`${shared.btn} ${shared.btnPrimary}`} onClick={send} disabled={busy || !selected}>
            {busy ? '写入中…' : '写入笔记'}
          </button>
        </div>
      </div>
    </div>
  )
}
