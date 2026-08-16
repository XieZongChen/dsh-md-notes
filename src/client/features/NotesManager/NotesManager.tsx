/**
 * Notes manager panel: left note list + right editor/preview.
 * All UI copy comes from the `md-notes` locale namespace via `t`.
 * @module dsh-md-notes/client/NotesManager
 */

import * as React from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NoteSummary } from '../api.ts'
import { api, ICON_URL } from '../api.ts'
import { fmtTime, renderMd } from '../markdown.ts'
import type { NotesStore } from '../store.ts'
import type { MdNotesKey } from '../locales/index.ts'
import shared from '../styles.module.css'
import styles from './notes-manager.module.css'

export interface NotesManagerProps {
  /** Shared store; closing the manager clears `managerOpen`. */
  store: NotesStore
  /** Framework-injected locale seat (`md-notes` namespace). */
  t: TranslateNS<'md-notes'>
}

/**
 * The full-screen notes manager.
 */
export function NotesManager(props: NotesManagerProps): React.ReactElement {
  const { store, t } = props
  const [notes, setNotes] = React.useState<NoteSummary[]>([])
  const [selected, setSelected] = React.useState<string | null>(null)
  const [content, setContent] = React.useState('')
  const [mode, setMode] = React.useState<'edit' | 'preview'>('edit')
  const [newTitle, setNewTitle] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [flash, setFlash] = React.useState<'' | MdNotesKey>('')

  const refresh = (): void => {
    void api('list').then((res) => { if (res.ok && res.notes) setNotes(res.notes) })
  }

  React.useEffect(() => { refresh() }, [])

  const open = (name: string): void => {
    setSelected(name)
    setMode('edit')
    void api('read', { name }).then((res) => { if (res.ok) setContent(res.content ?? '') })
  }

  const save = (): void => {
    if (!selected) return
    setBusy(true)
    void api('write', { name: selected, content }).then((res) => {
      setBusy(false)
      if (res.ok) {
        setFlash('manager.saved')
        refresh()
        window.setTimeout(() => setFlash(''), 1200)
      } else {
        setFlash('manager.saveFailed')
      }
    })
  }

  const create = (): void => {
    const title = newTitle.trim()
      || t('manager.untitled', { date: new Date().toLocaleDateString() })
    setBusy(true)
    setFlash('manager.creating')
    void api('create', { title }).then((res) => {
      setBusy(false)
      if (res.ok && res.name) {
        setNewTitle('')
        setFlash('manager.created')
        refresh()
        open(res.name)
        window.setTimeout(() => setFlash(''), 1500)
      } else {
        setFlash('manager.createFailed')
      }
    })
  }

  const remove = (name: string): void => {
    if (window.confirm(t('manager.deleteConfirm', { name }))) {
      void api('delete', { name }).then((res) => {
        if (res.ok) {
          if (selected === name) { setSelected(null); setContent('') }
          refresh()
        }
      })
    }
  }

  const close = (): void => store.set({ managerOpen: false })
  const previewHtml = mode === 'preview' ? renderMd(content) : ''

  return (
    <div className={shared.mask} onClick={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className={styles.manager}>
        <div className={styles.managerHead}>
          <img src={ICON_URL} width={16} height={16} alt="" className={styles.managerIcon} />
          <span className={styles.managerTitle}>{t('manager.title')}</span>
          <span className={styles.managerSub}>{t('manager.subtitle')}</span>
          <button type="button" className={shared.iconBtn} onClick={close} title={t('manager.close')}>✕</button>
        </div>
        <div className={styles.managerBody}>
          <div className={styles.list}>
            <div className={styles.listHead}>
              <input
                className={shared.input}
                placeholder={t('manager.newPlaceholder')}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') create() }}
              />
              <button type="button" className={shared.btn} onClick={create} disabled={busy}>
                {busy ? t('manager.creating') : t('manager.new')}
              </button>
            </div>
            <div className={styles.listItems}>
              {notes.length === 0
                ? <div className={shared.empty}>{t('manager.empty')}</div>
                : notes.map((n) => (
                  <div
                    key={n.name}
                    className={selected === n.name ? `${styles.noteItem} ${styles.noteItemActive}` : styles.noteItem}
                    onClick={() => open(n.name)}
                  >
                    <div className={styles.noteMain}>
                      <div className={styles.noteTitle}>{n.title}</div>
                      <div className={styles.noteTime}>{fmtTime(n.updatedAt)}</div>
                    </div>
                    <button
                      type="button"
                      className={styles.noteDel}
                      title={t('manager.delete')}
                      onClick={(e) => { e.stopPropagation(); remove(n.name) }}
                    >🗑</button>
                  </div>
                ))}
            </div>
          </div>
          <div className={styles.editor}>
            {!selected
              ? <div className={`${shared.empty} ${styles.editorEmpty}`}>{t('manager.editorEmpty')}</div>
              : (
                <>
                  <div className={styles.editorHead}>
                    <button
                      type="button"
                      className={mode === 'edit' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                      onClick={() => setMode('edit')}
                    >{t('manager.tabEdit')}</button>
                    <button
                      type="button"
                      className={mode === 'preview' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                      onClick={() => setMode('preview')}
                    >{t('manager.tabPreview')}</button>
                    <span className={styles.editorName}>{selected}</span>
                    <span className={styles.flash}>{flash === '' ? '' : t(flash)}</span>
                    <button type="button" className={`${shared.btn} ${shared.btnPrimary}`} onClick={save} disabled={busy}>{t('manager.save')}</button>
                  </div>
                  {mode === 'edit'
                    ? <textarea className={styles.textarea} value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} />
                    : <div className={styles.preview} dangerouslySetInnerHTML={{ __html: previewHtml }} />}
                </>
              )}
          </div>
        </div>
      </div>
    </div>
  )
}
