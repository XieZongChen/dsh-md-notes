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
import { IconFolderClose16, IconFolderOpen16, IconPlusOutline16, IconTriangleRightFill14, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceNotes } from '../api.ts'
import { api, ICON_URL } from '../api.ts'
import type { NotesUiStore } from '../store.ts'
import { noteKey, type BusyTracker } from '../busy.ts'
import type { MdNotesKey } from '../locales/index.ts'
import { fmtTime } from '../markdown.ts'
import { LoadingIndicator } from '../components/LoadingIndicator/LoadingIndicator.tsx'
import shared from '../styles.module.css'
import styles from './note-picker.module.css'

/** Status line state: a locale key plus optional template params. */
type Status = '' | { key: MdNotesKey; params?: Record<string, unknown> }

/** A selected note, identified by workspace + name. */
interface Selection { workspaceId: string; name: string }

export interface NotePickerProps {
  /** Captured question text (client-side; the host no longer reads the session log). */
  questionText: string
  /** Captured answer text (client-side). */
  answerText: string
  /** Session title for the append heading (client-side; '' → timestamp only). */
  sessionTitle: string
  /** Shared store; closing the picker clears `picker`. */
  store: NotesUiStore
  /** In-flight write tracker: busy notes are not selectable (docs/write-lock.md §7.2). */
  tracker: BusyTracker
  /** Framework-injected locale seat (`md-notes` namespace). */
  t: TranslateNS<'md-notes'>
}

/**
 * The note-selection popup.
 */
export function NotePicker(props: NotePickerProps): React.ReactElement {
  const { questionText, answerText, sessionTitle, store, tracker, t } = props
  const [workspaces, setWorkspaces] = React.useState<WorkspaceNotes[]>([])
  const [noWorkspaces, setNoWorkspaces] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [selected, setSelected] = React.useState<Selection | null>(null)
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState<Status>('')

  React.useEffect(() => {
    // No sessionId → list every workspace, enabling cross-workspace capture.
    void api('list').then((res) => {
      setLoading(false)
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

  const reload = (): void => {
    void api('list').then((res) => {
      setNoWorkspaces(res.ok === true && res.noWorkspaces === true)
      if (res.ok && res.workspaces) {
        setWorkspaces(res.workspaces)
      }
    })
  }

  const createIn = (workspaceId: string): void => {
    const title = t('manager.untitled', { date: new Date().toLocaleDateString() })
    setStatus({ key: 'picker.creating' })
    void api('create', { title, workspaceId }).then((res) => {
      if (res.ok && res.name) {
        setSelected({ workspaceId, name: res.name })
        reload()
        setStatus({ key: 'picker.created' })
        window.setTimeout(() => setStatus(''), 1200)
      } else {
        setStatus({ key: 'picker.createFailed' })
      }
    })
  }

  const send = (): void => {
    if (noWorkspaces) { setStatus({ key: 'picker.noWorkspaces' }); return }
    if (selected === null) { setStatus({ key: 'picker.needSelect' }); return }
    const key = noteKey(selected.workspaceId, selected.name)
    setBusy(true)
    setStatus({ key: 'picker.writing' })
    // tracker.run marks the note busy (docs/write-lock.md §6.3) so the entry,
    // this picker and the manager all reflect it; finally clears on any path.
    void tracker.run(key, () => api('appendConversation', {
      noteName: selected.name,
      workspaceId: selected.workspaceId,
      questionText,
      answerText,
      sessionTitle,
      labels: {
        user: t('picker.labelUser'),
        assistant: t('picker.labelAssistant'),
        empty: t('picker.labelEmpty'),
        image: t('picker.labelImage'),
      },
    })).then((res) => {
      if (res.ok) {
        setStatus({ key: 'picker.written' })
        window.setTimeout(() => store.update((d) => { d.picker = null }), 900)
      } else {
        setStatus({ key: 'picker.writeFailed', params: { error: res.error } })
      }
    }).finally(() => setBusy(false))
  }

  const close = (): void => store.update((d) => { d.picker = null })

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
        {loading
          ? <div className={styles.pickerLoading}><LoadingIndicator label={t('picker.loading')} /></div>
          : noWorkspaces
            ? <div className={shared.empty}>{t('picker.noWorkspaces')}</div>
            : workspaces.length === 0
              ? <div className={shared.empty}>{t('picker.empty')}</div>
              : (
              <div className={styles.noteList}>
                {workspaces.map((ws) => (
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
                  <button
                    type="button"
                    className={styles.wsNewBtn}
                    title={t('manager.new')}
                    onClick={(e) => { e.stopPropagation(); createIn(ws.workspaceId) }}
                  >
                    <IconPlusOutline16 />
                  </button>
                </div>
                {!collapsed[ws.workspaceId] && (
                  ws.notes.length === 0
                    ? <div className={`${shared.empty} ${styles.wsEmpty}`}>{t('picker.empty')}</div>
                    : ws.notes.map((n) => {
                      const writing = tracker.isBusy(noteKey(ws.workspaceId, n.name))
                      return (
                        <div
                          key={n.name}
                          className={
                            writing
                              ? `${styles.noteItem} ${styles.noteItemDisabled}`
                              : selected !== null && selected.workspaceId === ws.workspaceId && selected.name === n.name
                                ? `${styles.noteItem} ${styles.noteItemActive}`
                                : styles.noteItem
                          }
                          onClick={() => { if (!writing) setSelected({ workspaceId: ws.workspaceId, name: n.name }) }}
                        >
                          <div className={styles.noteMain}>
                            <div className={styles.noteTitle}>{n.title}</div>
                            <div className={styles.noteTime}>{fmtTime(n.updatedAt)}</div>
                          </div>
                          {writing && (
                            <span className={styles.noteWriting}><LoadingIndicator size={12} /></span>
                          )}
                        </div>
                      )
                    })
                )}
              </div>
                ))}
              </div>
            )}
        {/* writing shows on the button; written shows beside the button — keep
            this line height-stable so the dialog never jumps (docs/write-lock.md). */}
        <div className={styles.status}>{status !== '' && status.key !== 'picker.writing' && status.key !== 'picker.written' ? t(status.key, status.params) : ''}</div>
      </div>
      <div className={styles.dialogFoot}>
        {status !== '' && status.key === 'picker.written' && (
          <span className={styles.writeOk}>{t('picker.written')}</span>
        )}
        <button type="button" className={`${shared.btn} ${shared.btnPrimary}`} onClick={send} disabled={busy || selected === null || noWorkspaces}>
          {busy ? t('picker.writing') : t('picker.write')}
        </button>
      </div>
    </Modal>
  )
}
