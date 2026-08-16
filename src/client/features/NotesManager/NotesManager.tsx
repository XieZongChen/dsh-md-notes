/**
 * Notes manager panel: left note list (grouped by workspace) + right
 * editor/preview, plus the git sync surface — per-workspace update/push on the
 * editor header, global update/push on the manager head when a central repo is
 * in use, a commit popover, and best-effort auto-pull when opening a note.
 * All UI copy comes from the `md-notes` locale namespace via `t`.
 * @module dsh-md-notes/client/NotesManager
 */

import * as React from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { GitStatusData, WorkspaceNotes } from '../api.ts'
import { api, gitPullApi, gitPushApi, gitStatusApi, gitSyncApi, ICON_URL } from '../api.ts'
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
  const [workspaces, setWorkspaces] = React.useState<WorkspaceNotes[]>([])
  const [selectedWsId, setSelectedWsId] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [content, setContent] = React.useState('')
  const [mode, setMode] = React.useState<'edit' | 'preview'>('edit')
  const [newTitle, setNewTitle] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [flash, setFlash] = React.useState<'' | MdNotesKey>('')
  const [status, setStatus] = React.useState<GitStatusData | null>(null)
  const [central, setCentral] = React.useState<GitStatusData | null>(null)
  const [gitMsg, setGitMsg] = React.useState('')
  const [pushOpen, setPushOpen] = React.useState(false)
  const [pushMsg, setPushMsg] = React.useState('')
  const [gitBusy, setGitBusy] = React.useState(false)
  const [pushConflict, setPushConflict] = React.useState<{ wsId: string | null; message: string; error: string } | null>(null)

  const refreshStatus = (wsId: string | null): void => {
    if (wsId === null) return
    void gitStatusApi(wsId).then((res) => {
      setStatus(res.ok && res.status ? res.status : null)
    })
  }

  const refreshCentral = (): void => {
    void gitStatusApi().then((res) => {
      setCentral(res.ok && res.status ? res.status : null)
    })
  }

  const refresh = (): void => {
    void api('list').then((res) => {
      if (res.ok && res.workspaces) {
        setWorkspaces(res.workspaces)
        const first = res.workspaces[0]
        if (first !== undefined) {
          setSelectedWsId((prev) => prev ?? first.workspaceId)
          refreshStatus(first.workspaceId)
        }
      }
    })
    refreshCentral()
  }

  React.useEffect(() => { refresh() }, [])

  const currentWsId = (): string | null => selectedWsId ?? workspaces[0]?.workspaceId ?? null
  const showEditorGit = !!status?.repoDir
  const showGlobalGit = !!central?.repoDir

  const open = (name: string, wsId: string): void => {
    setSelectedWsId(wsId)
    setSelected(name)
    setMode('edit')
    setGitMsg('')
    void api('read', { name, workspaceId: wsId }).then((res) => {
      if (res.ok) setContent(res.content ?? '')
    })
    // Auto-pull on open (best effort): refresh the repo, then re-read the note.
    void gitPullApi(wsId).then((res) => {
      refreshStatus(wsId)
      if (res.ok) {
        void api('read', { name, workspaceId: wsId }).then((r2) => {
          if (r2.ok) setContent(r2.content ?? '')
        })
      }
    })
  }

  const save = (): void => {
    const wsId = currentWsId()
    if (!selected || wsId === null) return
    setSaving(true)
    void api('write', { name: selected, content, workspaceId: wsId }).then((res) => {
      setSaving(false)
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
    const wsId = currentWsId()
    const title = newTitle.trim()
      || t('manager.untitled', { date: new Date().toLocaleDateString() })
    setCreating(true)
    setFlash('manager.creating')
    void api('create', { title, workspaceId: wsId ?? undefined }).then((res) => {
      setCreating(false)
      if (res.ok && res.name) {
        setNewTitle('')
        setFlash('manager.created')
        refresh()
        open(res.name, wsId ?? workspaces[0]!.workspaceId)
        window.setTimeout(() => setFlash(''), 1500)
      } else {
        setFlash('manager.createFailed')
      }
    })
  }

  const remove = (name: string, wsId: string): void => {
    if (window.confirm(t('manager.deleteConfirm', { name }))) {
      void api('delete', { name, workspaceId: wsId }).then((res) => {
        if (res.ok) {
          if (selected === name) { setSelected(null); setContent('') }
          refresh()
        }
      })
    }
  }

  const doUpdate = (wsId: string | null): void => {
    setGitBusy(true)
    setGitMsg('')
    void gitPullApi(wsId ?? undefined).then((res) => {
      setGitBusy(false)
      if (res.ok) {
        if (wsId !== null) {
          refreshStatus(wsId)
          if (selected) {
            void api('read', { name: selected, workspaceId: wsId }).then((r) => {
              if (r.ok) setContent(r.content ?? '')
            })
          }
        } else {
          refreshCentral()
          refresh()
        }
      } else {
        setGitMsg(res.error)
      }
    })
  }

  const updateClick = (wsId: string | null): void => {
    if (wsId === null) {
      doUpdate(null)
      return
    }
    refreshStatus(wsId)
    if (status && (status.uncommitted ?? 0) > 0 && !window.confirm(t('git.updateConfirm'))) return
    doUpdate(wsId)
  }

  const runPush = (wsId: string | null, message: string): void => {
    setGitBusy(true)
    setGitMsg('')
    void gitPushApi(wsId ?? undefined, message).then((res) => {
      setGitBusy(false)
      if (res.ok) {
        setPushOpen(false)
        setPushMsg('')
        setPushConflict(null)
        if (wsId !== null) refreshStatus(wsId)
        else { refreshCentral(); refresh() }
      } else if (res.code === 'non-fast-forward') {
        // Rejected because the remote is ahead / histories are unrelated:
        // offer an in-app merge-and-retry instead of a bare error.
        setPushOpen(false)
        setPushMsg('')
        setPushConflict({ wsId, message, error: res.error ?? '' })
      } else {
        setGitMsg(res.error ?? t('git.failed', { error: '' }))
      }
    })
  }

  const doPush = (wsId: string | null): void => {
    runPush(wsId, pushMsg.trim() || '')
  }

  const resolveAndRetry = (): void => {
    if (pushConflict === null) return
    setGitBusy(true)
    setGitMsg('')
    void gitSyncApi(pushConflict.wsId ?? undefined).then((res) => {
      if (res.ok) {
        setPushConflict(null)
        runPush(pushConflict.wsId, pushConflict.message)
      } else {
        setGitBusy(false)
        setGitMsg(res.error ?? t('git.failed', { error: '' }))
      }
    })
  }

  const close = (): void => store.set({ managerOpen: false })
  const previewHtml = mode === 'preview' ? renderMd(content) : ''
  const grouped = workspaces.length > 1

  return (
    <div className={shared.mask} onClick={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className={styles.manager}>
        <div className={styles.managerHead}>
          <img src={ICON_URL} width={16} height={16} alt="" className={styles.managerIcon} />
          <span className={styles.managerTitle}>{t('manager.title')}</span>
          <span className={styles.managerSub}>{t('manager.subtitle')}</span>
          {showGlobalGit && (
            <span className={styles.headGit}>
              <button type="button" className={styles.gitBtn} disabled={gitBusy} onClick={() => updateClick(null)}>
                {t('git.update')}
              </button>
              <button type="button" className={styles.gitBtn} disabled={gitBusy} onClick={() => setPushOpen(true)}>
                {t('git.push')}
              </button>
            </span>
          )}
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
              <button type="button" className={shared.btn} onClick={create} disabled={creating}>
                {creating ? t('manager.creating') : t('manager.new')}
              </button>
            </div>
            <div className={styles.listItems}>
              {workspaces.length === 0
                ? <div className={shared.empty}>{t('manager.empty')}</div>
                : workspaces.map((ws) => (
                  <div key={ws.workspaceId} className={styles.wsGroup}>
                    {grouped && <div className={styles.wsGroupHead}>{ws.name}</div>}
                    {ws.notes.length === 0 && grouped
                      ? <div className={`${shared.empty} ${styles.wsEmpty}`}>{t('manager.empty')}</div>
                      : ws.notes.map((n) => (
                        <div
                          key={n.name}
                          className={selected === n.name ? `${styles.noteItem} ${styles.noteItemActive}` : styles.noteItem}
                          onClick={() => open(n.name, ws.workspaceId)}
                        >
                          <div className={styles.noteMain}>
                            <div className={styles.noteTitle}>{n.title}</div>
                            <div className={styles.noteTime}>{fmtTime(n.updatedAt)}</div>
                          </div>
                          <button
                            type="button"
                            className={styles.noteDel}
                            title={t('manager.delete')}
                            onClick={(e) => { e.stopPropagation(); remove(n.name, ws.workspaceId) }}
                          >🗑</button>
                        </div>
                      ))}
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
                    {showEditorGit && (
                      <button type="button" className={styles.gitBtn} disabled={gitBusy} onClick={() => updateClick(currentWsId())}>
                        {t('git.update')}
                      </button>
                    )}
                    <button type="button" className={`${shared.btn} ${shared.btnPrimary}`} onClick={save} disabled={saving}>{t('manager.save')}</button>
                    {showEditorGit && (
                      <button type="button" className={styles.gitBtn} disabled={gitBusy} onClick={() => setPushOpen(true)}>
                        {gitBusy ? t('git.pushing') : t('git.push')}
                      </button>
                    )}
                  </div>
                  {pushOpen && (
                    <div className={styles.pushPanel}>
                      <input
                        className={shared.input}
                        placeholder={t('git.commitPlaceholder')}
                        value={pushMsg}
                        onChange={(e) => setPushMsg(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') doPush(currentWsId()) }}
                      />
                      <button
                        type="button"
                        className={`${shared.btn} ${shared.btnPrimary}`}
                        disabled={gitBusy}
                        onClick={() => doPush(currentWsId())}
                      >{t('git.confirmPush')}</button>
                      <button type="button" className={shared.btn} disabled={gitBusy} onClick={() => setPushOpen(false)}>
                        {t('git.cancel')}
                      </button>
                    </div>
                  )}
                  {mode === 'edit'
                    ? <textarea className={styles.textarea} value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} />
                    : <div className={styles.preview} dangerouslySetInnerHTML={{ __html: previewHtml }} />}
                </>
              )}
          </div>
        </div>
        <div className={styles.syncLine}>
          {(!!status?.repoDir) && (
            <span>
              {t('git.title')} · {t('git.branch')}: {status.branch} · {t('git.uncommitted', { count: status.uncommitted ?? 0 })}
              {status.lastCommit ? ` · ${t('git.lastCommit', { time: status.lastCommit })}` : ''}
            </span>
          )}
          {pushConflict !== null && (
            <span className={styles.gitError}>
              {pushConflict.error}
              <button type="button" className={styles.gitRetry} disabled={gitBusy} onClick={resolveAndRetry}>
                {t('git.mergeRetry')}
              </button>
            </span>
          )}
          {gitMsg !== '' && pushConflict === null && <span className={styles.gitError}>{gitMsg}</span>}
        </div>
      </div>
    </div>
  )
}
