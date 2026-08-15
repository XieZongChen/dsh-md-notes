/**
 * Notes manager panel: left note list + right editor/preview.
 * @module dsh-md-notes/client/NotesManager
 */

import * as React from 'react'
import type { NoteSummary } from '../api.ts'
import { api, ICON_URL } from '../api.ts'
import { fmtTime, renderMd } from '../markdown.ts'
import type { NotesStore } from '../store.ts'
import shared from '../styles.module.css'
import styles from './notes-manager.module.css'

export interface NotesManagerProps {
  /** Shared store; closing the manager clears `managerOpen`. */
  store: NotesStore
}

/**
 * The full-screen notes manager.
 */
export function NotesManager(props: NotesManagerProps): React.ReactElement {
  const { store } = props
  const [notes, setNotes] = React.useState<NoteSummary[]>([])
  const [selected, setSelected] = React.useState<string | null>(null)
  const [content, setContent] = React.useState('')
  const [mode, setMode] = React.useState<'edit' | 'preview'>('edit')
  const [newTitle, setNewTitle] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [flash, setFlash] = React.useState('')

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
      if (res.ok) { setFlash('已保存'); refresh(); window.setTimeout(() => setFlash(''), 1200) }
      else setFlash('保存失败')
    })
  }

  const create = (): void => {
    const title = newTitle.trim() || `未命名笔记 ${new Date().toLocaleDateString()}`
    setBusy(true)
    setFlash('创建中…')
    void api('create', { title }).then((res) => {
      setBusy(false)
      if (res.ok && res.name) {
        setNewTitle('')
        setFlash('已创建 ✓')
        refresh()
        open(res.name)
        window.setTimeout(() => setFlash(''), 1500)
      } else {
        setFlash('创建失败')
      }
    })
  }

  const remove = (name: string): void => {
    if (window.confirm(`删除笔记 ${name} ？`)) {
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
          <span className={styles.managerTitle}>MD 笔记</span>
          <span className={styles.managerSub}>保存于工作区 .dsh-notes/</span>
          <button type="button" className={shared.iconBtn} onClick={close} title="关闭">✕</button>
        </div>
        <div className={styles.managerBody}>
          <div className={styles.list}>
            <div className={styles.listHead}>
              <input
                className={shared.input}
                placeholder="新笔记标题…"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') create() }}
              />
              <button type="button" className={shared.btn} onClick={create} disabled={busy}>
                {busy ? '创建中…' : '新建'}
              </button>
            </div>
            <div className={styles.listItems}>
              {notes.length === 0
                ? <div className={shared.empty}>还没有笔记，输入标题后点“新建”</div>
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
                      title="删除"
                      onClick={(e) => { e.stopPropagation(); remove(n.name) }}
                    >🗑</button>
                  </div>
                ))}
            </div>
          </div>
          <div className={styles.editor}>
            {!selected
              ? <div className={`${shared.empty} ${styles.editorEmpty}`}>← 选择左侧笔记，或新建一篇</div>
              : (
                <>
                  <div className={styles.editorHead}>
                    <button
                      type="button"
                      className={mode === 'edit' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                      onClick={() => setMode('edit')}
                    >编辑</button>
                    <button
                      type="button"
                      className={mode === 'preview' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                      onClick={() => setMode('preview')}
                    >预览</button>
                    <span className={styles.editorName}>{selected}</span>
                    <span className={styles.flash}>{flash}</span>
                    <button type="button" className={`${shared.btn} ${shared.btnPrimary}`} onClick={save} disabled={busy}>保存</button>
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
