/**
 * Note picker popup (记入笔记): choose a note, then append the addressed
 * answer's conversation to it. The note list mirrors the notes manager's left
 * panel — grouped by workspace with collapsible rows and folder glyphs — but
 * without create/delete, and workspace rows only fold (not selectable).
 * Cross-workspace capture is supported: any workspace's note can be chosen.
 * All UI copy comes from the `md-notes` locale namespace via `t`.
 * @module dsh-md-notes/client/NotePicker
 */

import * as React from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { IconFolderClose16, IconFolderOpen16, IconTriangleRightFill14, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceNotes } from '../api.ts'
import { api, ICON_URL } from '../api.ts'
import type { NotesStore } from '../store.ts'
import type { MdNotesKey } from '../locales/index.ts'
import { fmtTime } from '../markdown.ts'
import shared from '../styles.module.css'
import styles from './note-picker.module.css'

/** Status line state: a locale key plus optional template params. */
type Status = '' | { key: MdNotesKey; params?: Record<string, unknown> }

/** A selected note, identified by workspace + name. */
interface Selection { workspaceId: string; name: string }

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
  const [workspaces, setWorkspaces] = React.useState<WorkspaceNotes[]>([])
  const [noWorkspaces, setNoWorkspaces] = React.useState(false)
  const [selected, setSelected] = React.useState<Selection | null>(null)
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState<Status>('')

  React.useEffect(() => {
    // No sessionId → list every workspace, enabling cross-workspace capture.
    void api('list').then((res) => {
      setNoWorkspaces(res.ok === true && res.noWorkspaces === true)
      if (res.ok && res.workspaces) {
        setWorkspaces(res.workspaces)
        const first = res.workspaces.find((w) => w.notes.length > 0)
        const firstNote = first?.notes[0]
        if (firstNote !== undefined && first !== undefined) {
          setSelected({ workspaceId: first.workspaceId, name: firstNote.name })
        }
      }
    })
  }, [])

  const toggleWorkspace = (workspaceId: string): void => {
    setCollapsed((prev) => ({ ...prev, [workspaceId]: !prev[workspaceId] }))
  }

  const send = (): void => {
    if (noWorkspaces) { setStatus({ key: 'picker.noWorkspaces' }); return }
    if (selected === null) { setStatus({ key: 'picker.needSelect' }); return }
    setBusy(true)
    setStatus({ key: 'picker.writing' })
    void api('appendConversation', {
      noteName: selected.name,
      workspaceId: selected.workspaceId,
      sessionId,
      messageId,
      labels: {
        user: t('picker.labelUser'),
        assistant: t('picker.labelAssistant'),
        empty: t('picker.labelEmpty'),
        image: t('picker.labelImage'),
      },
    }).then((res) => {
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
    <Modal
      open
      headless
      title={t('picker.title')}
      closeLabel={t('picker.close')}
      onClose={close}
      className={styles.dialog}
    >
      <div className={styles.dialogHead}>
        <img src={ICON_URL} width={16} height={16} alt="" className={styles.dialogIcon} />
        <span className={styles.dialogTitle}>{t('picker.title')}</span>
        <button type="button" className={shared.iconBtn} onClick={close} title={t('picker.close')}>✕</button>
      </div>
      <div className={styles.dialogBody}>
        {noWorkspaces
          ? <div className={shared.empty}>{t('picker.noWorkspaces')}</div>
          : workspaces.length === 0
            ? <div className={shared.empty}>{t('picker.empty')}</div>
            : workspaces.map((ws) => (
              <div key={ws.workspaceId} className={styles.wsGroup}>
                <div
                  className={styles.wsGroupHead}
                  onClick={() => toggleWorkspace(ws.workspaceId)}
                  title={ws.name}
                  aria-expanded={!collapsed[ws.workspaceId]}
                >
                  <span className={styles.wsFolder}>
                    {collapsed[ws.workspaceId] ? <IconFolderClose16 /> : <IconFolderOpen16 />}
                  </span>
                  <span className={styles.wsChevron}>
                    <IconTriangleRightFill14 className={collapsed[ws.workspaceId] ? styles.wsArrow : `${styles.wsArrow} ${styles.wsArrowOpen}`} />
                  </span>
                  <span className={styles.wsGroupTitle}>{ws.name}</span>
                </div>
                {!collapsed[ws.workspaceId] && (
                  ws.notes.length === 0
                    ? <div className={`${shared.empty} ${styles.wsEmpty}`}>{t('picker.empty')}</div>
                    : ws.notes.map((n) => (
                      <div
                        key={n.name}
                        className={selected !== null && selected.workspaceId === ws.workspaceId && selected.name === n.name
                          ? `${styles.noteItem} ${styles.noteItemActive}`
                          : styles.noteItem}
                        onClick={() => setSelected({ workspaceId: ws.workspaceId, name: n.name })}
                      >
                        <div className={styles.noteMain}>
                          <div className={styles.noteTitle}>{n.title}</div>
                          <div className={styles.noteTime}>{fmtTime(n.updatedAt)}</div>
                        </div>
                      </div>
                    ))
                )}
              </div>
            ))}
        <div className={styles.status}>{status === '' ? '' : t(status.key, status.params)}</div>
      </div>
      <div className={styles.dialogFoot}>
        <button type="button" className={`${shared.btn} ${shared.btnPrimary}`} onClick={send} disabled={busy || selected === null || noWorkspaces}>
          {busy ? t('picker.writing') : t('picker.write')}
        </button>
      </div>
    </Modal>
  )
}
