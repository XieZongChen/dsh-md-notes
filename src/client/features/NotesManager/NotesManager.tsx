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
import { IconFolderClose16, IconFolderOpen16, IconPlusOutline16, IconTriangleRightFill14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { LoadingIndicator } from '../components/LoadingIndicator/LoadingIndicator.tsx'
import type { GitStatusData, WorkspaceNotes } from '../api.ts'
import { api, gitPullApi, gitPushApi, gitSettingsApi, gitStatusApi, gitSyncApi, ICON_URL } from '../api.ts'
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
  const [noWorkspaces, setNoWorkspaces] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [contentLoading, setContentLoading] = React.useState(false)
  const [selectedWsId, setSelectedWsId] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [content, setContent] = React.useState('')
  const [mode, setMode] = React.useState<'edit' | 'preview'>('edit')
  const [saving, setSaving] = React.useState(false)
  const [flash, setFlash] = React.useState<'' | MdNotesKey>('')
  const [statusByWs, setStatusByWs] = React.useState<Record<string, GitStatusData | null>>({})
  const [central, setCentral] = React.useState<GitStatusData | null>(null)
  const [gitMsg, setGitMsg] = React.useState('')
  const [pushOpen, setPushOpen] = React.useState(false)
  const [pushMsg, setPushMsg] = React.useState('')
  const [updating, setUpdating] = React.useState(false)
  const [pushing, setPushing] = React.useState(false)
  const [pushConflict, setPushConflict] = React.useState<{ wsId: string | null; message: string; error: string } | null>(null)
  const [autoPull, setAutoPull] = React.useState(true)
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})
  const selectionRef = React.useRef<{ wsId: string; name: string } | null>(null)
  const isCurrent = (wsId: string, name: string): boolean =>
    selectionRef.current !== null && selectionRef.current.wsId === wsId && selectionRef.current.name === name

  const refreshStatus = (wsId: string | null): void => {
    if (wsId === null) return
    void gitStatusApi(wsId).then((res) => {
      // Per-workspace storage: each workspace keeps its own status, so a
      // stale response can never clobber the current workspace's buttons.
      setStatusByWs((prev) => ({ ...prev, [wsId]: res.ok && res.status ? res.status : null }))
    })
  }

  const refreshCentral = (): void => {
    void gitStatusApi().then((res) => {
      setCentral(res.ok && res.status ? res.status : null)
    })
  }

  const refresh = (): void => {
    void gitSettingsApi().then((res) => {
      if (res.ok && res.settings) setAutoPull(res.settings.gitAutoPull !== false)
    })
    void api('list').then((res) => {
      setLoading(false)
      setNoWorkspaces(res.ok === true && res.noWorkspaces === true)
      if (res.ok && res.workspaces) {
        setWorkspaces(res.workspaces)
        // Refresh the status of the CURRENT workspace context (the note being
        // edited), not always the first — refreshing [0] would clobber the
        // buttons when saving a note in another workspace.
        const target = selectedWsId ?? res.workspaces[0]?.workspaceId
        if (target !== undefined) {
          setSelectedWsId((prev) => prev ?? target)
          refreshStatus(target)
        }
      }
    })
    refreshCentral()
  }

  React.useEffect(() => { refresh() }, [])

  const toggleWorkspace = (wsId: string): void => {
    selectionRef.current = null
    setSelectedWsId(wsId)
    setSelected(null)
    setContent('')
    setCollapsed((prev) => ({ ...prev, [wsId]: !prev[wsId] }))
    setGitMsg('')
    refreshStatus(wsId)
  }

  const currentWsId = (): string | null => selectedWsId ?? workspaces[0]?.workspaceId ?? null
  const status = currentWsId() === null ? null : (statusByWs[currentWsId()!] ?? null)
  const showEditorGit = !!status?.repoDir
  const showGlobalGit = !!central?.repoDir

  const open = (name: string, wsId: string): void => {
    selectionRef.current = { wsId, name }
    setSelectedWsId(wsId)
    setSelected(name)
    setMode('edit')
    setContent('') // clear the previous note's content so switching never flashes it
    setGitMsg('')
    setContentLoading(true)
    refreshStatus(wsId)
    void api('read', { name, workspaceId: wsId }).then((res) => {
      if (res.ok && isCurrent(wsId, name)) setContent(res.content ?? '')
      setContentLoading(false)
    })
    // Auto-pull on open (honors gitAutoPull, best effort): refresh, then re-read.
    if (!autoPull) return
    void gitPullApi(wsId).then((res) => {
      refreshStatus(wsId)
      if (res.ok) {
        void api('read', { name, workspaceId: wsId }).then((r2) => {
          if (r2.ok && isCurrent(wsId, name)) setContent(r2.content ?? '')
          setContentLoading(false)
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

  const createIn = (wsId: string): void => {
    const title = t('manager.untitled', { date: new Date().toLocaleDateString() })
    setFlash('manager.creating')
    void api('create', { title, workspaceId: wsId }).then((res) => {
      if (res.ok && res.name) {
        setFlash('manager.created')
        refresh()
        open(res.name, wsId)
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
          if (selected === name && selectedWsId === wsId) { setSelected(null); setContent('') }
          refresh()
        }
      })
    }
  }

  const doUpdate = (wsId: string | null): void => {
    setUpdating(true)
    setGitMsg('')
    void gitPullApi(wsId ?? undefined).then((res) => {
      setUpdating(false)
      if (res.ok) {
        if (wsId !== null) {
          refreshStatus(wsId)
          if (selected && isCurrent(wsId, selected)) {
            void api('read', { name: selected, workspaceId: wsId }).then((r) => {
              if (r.ok && isCurrent(wsId, selected)) setContent(r.content ?? '')
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
    setPushing(true)
    setGitMsg('')
    void gitPushApi(wsId ?? undefined, message).then((res) => {
      setPushing(false)
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
    setPushing(true)
    setGitMsg('')
    void gitSyncApi(pushConflict.wsId ?? undefined).then((res) => {
      if (res.ok) {
        setPushConflict(null)
        runPush(pushConflict.wsId, pushConflict.message)
      } else {
        setPushing(false)
        setGitMsg(res.error ?? t('git.failed', { error: '' }))
      }
    })
  }

  const busy = updating || saving || pushing

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
              <button type="button" className={styles.gitBtn} disabled={busy} onClick={() => updateClick(null)}>
                {updating && <LoadingIndicator size={12} />}{t('git.update')}
              </button>
              <button type="button" className={styles.gitBtn} disabled={busy} onClick={() => setPushOpen(true)}>
                {pushing && <LoadingIndicator size={12} />}{t('git.push')}
              </button>
            </span>
          )}
          <button type="button" className={shared.iconBtn} onClick={close} title={t('manager.close')}>✕</button>
        </div>
        <div className={styles.managerBody}>
          <div className={styles.list}>
            <div className={styles.listItems}>
              {loading
                ? <div className={styles.listLoading}><LoadingIndicator /></div>
                : noWorkspaces
                ? <div className={styles.noWsPrompt}>{t('manager.noWorkspaces')}</div>
                : workspaces.length === 0
                ? <div className={shared.empty}>{t('manager.empty')}</div>
                : workspaces.map((ws) => (
                  <div key={ws.workspaceId} className={styles.wsGroup}>
                    {(grouped || ws.workspaceId !== 'default') && (
                      <div
                        className={selectedWsId === ws.workspaceId && selected === null ? `${styles.wsGroupHead} ${styles.wsGroupHeadActive}` : styles.wsGroupHead}
                        onClick={() => toggleWorkspace(ws.workspaceId)}
                        title={ws.name}
                        aria-expanded={!collapsed[ws.workspaceId]}
                      >
                        <span className={selectedWsId === ws.workspaceId ? `${styles.wsFolder} ${styles.wsFolderActive}` : styles.wsFolder}>
                          {collapsed[ws.workspaceId] ? <IconFolderClose16 /> : <IconFolderOpen16 />}
                        </span>
                        <span className={styles.wsChevron}>
                          <IconTriangleRightFill14 className={collapsed[ws.workspaceId] ? styles.wsArrow : `${styles.wsArrow} ${styles.wsArrowOpen}`} />
                        </span>
                        <span className={styles.wsGroupTitle}>{ws.name}</span>
                        {selectedWsId === ws.workspaceId && (
                          <span
                            className={styles.wsNewBtn}
                            role="button"
                            title={t('manager.new')}
                            onClick={(e) => { e.stopPropagation(); createIn(ws.workspaceId) }}
                          >
                            <IconPlusOutline16 />
                          </span>
                        )}
                      </div>
                    )}
                    {!collapsed[ws.workspaceId] && (ws.notes.length === 0 && grouped
                      ? <div className={`${shared.empty} ${styles.wsEmpty}`}>{t('manager.empty')}</div>
                      : ws.notes.map((n) => (
                        <div
                          key={n.name}
                          className={selected === n.name && selectedWsId === ws.workspaceId ? `${styles.noteItem} ${styles.noteItemActive}` : styles.noteItem}
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
                      )))}
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
                      <button type="button" className={styles.gitBtn} disabled={busy} onClick={() => updateClick(currentWsId())}>
                        {updating && <LoadingIndicator size={12} />}{t('git.update')}
                      </button>
                    )}
                    <button type="button" className={styles.saveBtn} disabled={busy} onClick={save}>
                      {saving && <LoadingIndicator size={12} />}{t('manager.save')}
                    </button>
                    {showEditorGit && (
                      <button type="button" className={styles.gitBtn} disabled={busy} onClick={() => setPushOpen(true)}>
                        {pushing && <LoadingIndicator size={12} />}{t('git.push')}
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
                        className={styles.saveBtn}
                        disabled={busy}
                        onClick={() => doPush(currentWsId())}
                      >{pushing && <LoadingIndicator size={12} />}{t('git.confirmPush')}</button>
                      <button type="button" className={shared.btn} disabled={busy} onClick={() => setPushOpen(false)}>
                        {t('git.cancel')}
                      </button>
                    </div>
                  )}
                  {contentLoading
                    ? <div className={styles.editorLoading}><LoadingIndicator label={t('git.loading')} /></div>
                    : mode === 'edit'
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
          {busy && <LoadingIndicator size={10} />}
          {pushConflict !== null && (
            <span className={styles.gitError}>
              {pushConflict.error}
              <button type="button" className={styles.gitRetry} disabled={busy} onClick={resolveAndRetry}>
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
