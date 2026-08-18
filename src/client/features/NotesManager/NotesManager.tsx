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
import { IconCloseOutline16, IconFolderClose16, IconFolderOpen16, IconPlusOutline16, IconRefreshOutline16, IconSendOutline16, IconSettingsOutline16, IconTriangleRightFill14, MarkdownText, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import { LoadingIndicator } from '../components/LoadingIndicator/LoadingIndicator.tsx'
import type { GitStatusData, WorkspaceNotes } from '../api.ts'
import { api, gitErrorText, gitPullApi, gitPushApi, gitSettingsApi, gitStatusApi, gitSyncApi, ICON_URL } from '../api.ts'
import { useUpdateAvailable } from '../update.ts'
import { fmtTime } from '../markdown.ts'
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
  const updateInfo = useUpdateAvailable()
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
  const [gitMsg, setGitMsg] = React.useState('')
  const [pushOpen, setPushOpen] = React.useState(false)
  /** Workspace the commit popover targets (undefined = current workspace). */
  const [pushTargetWsId, setPushTargetWsId] = React.useState<string | null>(null)
  const [pushMsg, setPushMsg] = React.useState('')
  const [updating, setUpdating] = React.useState(false)
  const [pushing, setPushing] = React.useState(false)
  const [pushConflict, setPushConflict] = React.useState<{ wsId: string; message: string; error: string } | null>(null)
  const [autoPull, setAutoPull] = React.useState(true)
  /** Names of notes the remote updated but local differs — hint to manually update. */
  const [remoteChanged, setRemoteChanged] = React.useState<string[] | null>(null)
  /** In-page confirmation dialog (replaces window.confirm, reliable in overlay). */
  const [confirmState, setConfirmState] = React.useState<{
    title: string
    description: string
    confirmLabel: string
    cancelLabel: string
    danger?: boolean
    onConfirm: () => void
  } | null>(null)
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
  }

  React.useEffect(() => { refresh() }, [])

  const toggleWorkspace = (wsId: string): void => {
    selectionRef.current = null
    setSelectedWsId(wsId)
    setSelected(null)
    setContent('')
    setCollapsed((prev) => ({ ...prev, [wsId]: !prev[wsId] }))
    setGitMsg('')
    setRemoteChanged(null)
    refreshStatus(wsId)
  }

  const currentWsId = (): string | null => selectedWsId ?? workspaces[0]?.workspaceId ?? null
  const status = currentWsId() === null ? null : (statusByWs[currentWsId()!] ?? null)
  const showEditorGit = !!status?.repoDir

  const open = (name: string, wsId: string): void => {
    selectionRef.current = { wsId, name }
    setSelectedWsId(wsId)
    setSelected(name)
    setMode('edit')
    setContent('') // clear the previous note's content so switching never flashes it
    setGitMsg('')
    setRemoteChanged(null)
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
        // Conservative pull: notes differing on both sides were left as-is.
        // Surface them as a hint (a manual Update is needed) instead of
        // silently keeping the local version.
        if ((res.changed ?? []).length > 0) {
          setRemoteChanged(res.changed ?? [])
          setContentLoading(false)
          return
        }
        setRemoteChanged(null)
        // The pull may have brought new notes down — re-list so the left
        // panel shows them without reopening the manager.
        refresh()
        void api('read', { name, workspaceId: wsId }).then((r2) => {
          if (r2.ok && isCurrent(wsId, name)) setContent(r2.content ?? '')
          setContentLoading(false)
        })
      }
    })
  }

  // Markdown inline-code file mentions: a `` `笔记名` `` token that matches a
  // known note (file name or title; current workspace first) becomes a
  // clickable jump that opens that note in the editor.
  const fileMentions = React.useMemo<MarkdownFileMentions>(() => ({
    resolve(value: string) {
      const token = value.trim().replace(/\.md$/i, '')
      if (token === '') return undefined
      const hit = (wsId: string | null): { name: string; title: string; wsId: string } | undefined => {
        for (const ws of workspaces) {
          if (wsId !== null && ws.workspaceId !== wsId) continue
          const note = ws.notes.find((n) =>
            n.name.replace(/\.md$/i, '') === token || n.title === token)
          if (note !== undefined) return { name: note.name, title: note.title, wsId: ws.workspaceId }
        }
        return undefined
      }
      const found = hit(selectedWsId) ?? hit(null)
      if (found === undefined) return undefined
      return {
        open: () => open(found.name, found.wsId),
        label: t('manager.openNote', { name: found.title }),
        title: found.title,
      }
    },
  }), [workspaces, selectedWsId, t])

  const save = (): void => {    const wsId = currentWsId()
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
    setConfirmState({
      title: t('manager.deleteTitle'),
      description: t('manager.deleteConfirm', { name }),
      confirmLabel: t('manager.delete'),
      cancelLabel: t('git.cancel'),
      danger: true,
      onConfirm: () => {
        setConfirmState(null)
        void api('delete', { name, workspaceId: wsId }).then((res) => {
          if (res.ok) {
            if (selected === name && selectedWsId === wsId) { setSelected(null); setContent('') }
            refresh()
          }
        })
      },
    })
  }

  const doUpdate = (wsId: string, force: boolean): void => {
    setUpdating(true)
    setGitMsg('')
    void gitPullApi(wsId, force).then((res) => {
      setUpdating(false)
      if (res.ok) {
        setRemoteChanged(null)
        refreshStatus(wsId)
        // The pull may have brought new notes down — re-list so the left
        // panel shows them immediately.
        refresh()
        if (selected && isCurrent(wsId, selected)) {
          void api('read', { name: selected, workspaceId: wsId }).then((r) => {
            if (r.ok && isCurrent(wsId, selected)) setContent(r.content ?? '')
          })
        }
        setFlash('manager.updated')
        window.setTimeout(() => setFlash(''), 1200)
      } else {
        setGitMsg(gitErrorText(t, res.code, res.error))
      }
    })
  }

  const updateClick = (wsId: string): void => {
    // First run a conservative pull (never overwrites). If the remote has
    // files that differ from the local ones (skipped > 0), ask the user
    // whether to replace the local versions — never overwrite silently.
    setUpdating(true)
    setGitMsg('')
    void gitPullApi(wsId, false).then((res) => {
      setUpdating(false)
      if (!res.ok) {
        setGitMsg(gitErrorText(t, res.code, res.error))
        return
      }
      const skipped = res.skipped ?? 0
      if (skipped === 0) {
        // Nothing differed → the conservative pull already brought everything.
        // Re-list so newly-pulled notes appear in the left panel.
        setRemoteChanged(null)
        refresh()
        if (selected && isCurrent(wsId, selected)) {
          void api('read', { name: selected, workspaceId: wsId }).then((r) => {
            if (r.ok && isCurrent(wsId, selected)) setContent(r.content ?? '')
          })
        }
        setFlash('manager.updated')
        window.setTimeout(() => setFlash(''), 1200)
        return
      }
      setConfirmState({
        title: t('git.updateConfirmTitle'),
        description: t('git.updateConfirm', { count: skipped }),
        confirmLabel: t('git.overwriteLocal'),
        cancelLabel: t('git.cancel'),
        onConfirm: () => { setConfirmState(null); doUpdate(wsId, true) },
      })
    })
  }
  const runPush = (wsId: string, message: string, overwrite = false): void => {
    setPushing(true)
    setGitMsg('')
    void gitPushApi(wsId, message, overwrite).then((res) => {
      setPushing(false)
      if (res.ok) {
        setPushOpen(false)
        setPushMsg('')
        setPushConflict(null)
        refreshStatus(wsId)
      } else if (res.code === 'remote-changed') {
        // The remote has notes newer/different from the local ones — ask the
        // user whether to overwrite them with the local version before pushing.
        const names = (res.changed ?? []).join(', ')
        setConfirmState({
          title: t('git.pushRemoteChangedTitle'),
          description: t('git.pushRemoteChanged', { names }),
          confirmLabel: t('git.overwriteRemote'),
          cancelLabel: t('git.cancel'),
          onConfirm: () => { setConfirmState(null); runPush(wsId, message, true) },
        })
      } else if (res.code === 'non-fast-forward') {
        // Rejected because the remote is ahead / histories are unrelated:
        // offer an in-app merge-and-retry instead of a bare error.
        setPushOpen(false)
        setPushMsg('')
        setPushConflict({ wsId, message, error: gitErrorText(t, res.code, res.error) })
      } else {
        setGitMsg(gitErrorText(t, res.code, res.error))
      }
    })
  }

  const doPush = (wsId: string): void => {
    // Default commit message is localized client-side (host fallback exists
    // for direct API calls but the UI always sends an explicit message).
    const message = pushMsg.trim() !== '' ? pushMsg.trim() : t('git.commitDefault', { time: new Date().toLocaleString() })
    runPush(wsId, message)
  }

  /** Open the commit popover targeting a specific workspace. */
  const pushForWs = (wsId: string): void => {
    setPushTargetWsId(wsId)
    setPushMsg('')
    setPushOpen(true)
  }

  const resolveAndRetry = (): void => {
    if (pushConflict === null) return
    setPushing(true)
    setGitMsg('')
    void gitSyncApi(pushConflict.wsId).then((res) => {
      if (res.ok) {
        setPushConflict(null)
        runPush(pushConflict.wsId, pushConflict.message)
      } else {
        setPushing(false)
        setGitMsg(gitErrorText(t, res.code, res.error))
      }
    })
  }

  const busy = updating || saving || pushing

  const close = (): void => store.set({ managerOpen: false })
  /**
   * Open dsh's own settings panel and jump to the "MD 笔记" section. The
   * settings shell owns its open state locally and exposes no external API,
   * so this simulates the two clicks a user would make: the sidebar
   * settings trigger, then the section's nav cell. The trigger is the only
   * `button[aria-haspopup="dialog"]` without an aria-label on the page; the
   * nav cell is matched by the section's localized label. Closes the manager
   * first so its overlay cannot cover the settings modal.
   */
  const openDshSettings = (): void => {
    close()
    const trigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]:not([aria-label])')
    trigger?.click()
    // The panel mounts async; retry locating the nav cell a few times.
    let attempts = 0
    const locate = (): void => {
      attempts += 1
      const cells = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] nav button'))
      const cell = cells.find((b) => b.textContent?.trim() === t('git.settingsNav'))
      if (cell !== undefined) { cell.click(); return }
      if (attempts < 8) window.setTimeout(locate, 100)
    }
    window.setTimeout(locate, 60)
  }
  const grouped = workspaces.length > 1

  return (
    <div className={shared.mask} onClick={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className={styles.manager}>
        <div className={styles.managerHead}>
          <img src={ICON_URL} width={16} height={16} alt="" className={styles.managerIcon} />
          <span className={styles.headTitle}>
            <span className={styles.managerTitle}>{t('manager.title')}</span>
            <button type="button" className={shared.iconBtn} onClick={openDshSettings} title={t('manager.settings')}>
              <IconSettingsOutline16 />
            </button>
            {updateInfo !== null && (
              <span className={styles.updateTag} title={t('sidebar.updateTitle', { latest: updateInfo.latest })}>
                {t('sidebar.updateTag')}
              </span>
            )}
          </span>
          <button type="button" className={shared.iconBtn} onClick={close} title={t('manager.close')}>
            <IconCloseOutline16 />
          </button>
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
                        <button
                          type="button"
                          className={styles.wsIconBtn}
                          title={t('git.update')}
                          onClick={(e) => { e.stopPropagation(); updateClick(ws.workspaceId) }}
                        >
                          <IconRefreshOutline16 />
                        </button>
                        <button
                          type="button"
                          className={styles.wsIconBtn}
                          title={t('git.push')}
                          onClick={(e) => { e.stopPropagation(); pushForWs(ws.workspaceId) }}
                        >
                          <IconSendOutline16 />
                        </button>
                        <span
                          className={styles.wsNewBtn}
                          role="button"
                          title={t('manager.new')}
                          onClick={(e) => { e.stopPropagation(); createIn(ws.workspaceId) }}
                        >
                          <IconPlusOutline16 />
                        </span>
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
                    {showEditorGit && remoteChanged !== null && remoteChanged.length > 0 && (
                      <span className={styles.remoteHint} title={remoteChanged.join('、')}>
                        {t('git.remoteUpdated')}
                      </span>
                    )}
                    {showEditorGit && (
                      <button type="button" className={styles.gitBtn} disabled={busy} onClick={() => { const id = currentWsId(); if (id !== null) updateClick(id) }}>
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
                        onKeyDown={(e) => { if (e.key === 'Enter') { const id = pushTargetWsId ?? currentWsId(); if (id !== null) doPush(id) } }}
                      />
                      <button
                        type="button"
                        className={styles.saveBtn}
                        disabled={busy}
                        onClick={() => { const id = pushTargetWsId ?? currentWsId(); if (id !== null) doPush(id) }}
                      >{pushing && <LoadingIndicator size={12} />}{t('git.confirmPush')}</button>
                      <button type="button" className={shared.btn} disabled={busy} onClick={() => { setPushOpen(false); setPushTargetWsId(null) }}>
                        {t('git.cancel')}
                      </button>
                    </div>
                  )}
                  {contentLoading
                    ? <div className={styles.editorLoading}><LoadingIndicator label={t('git.loading')} /></div>
                    : mode === 'edit'
                      ? <textarea className={styles.textarea} value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} />
                      : <div className={styles.preview}><MarkdownText text={content} fileMentions={fileMentions} /></div>}
                </>
              )}
          </div>
        </div>
        <div className={styles.syncLine}>
          {(!!status?.repoDir) && (
            <span>
              {t('git.title')} · {t('git.branch')}: {status.branch}
              {status.subdir ? ` · ${t('git.subpath')}: ${status.subdir}` : ''}
              {' · '}{t('git.uncommitted', { count: status.uncommitted ?? 0 })}
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
      {confirmState !== null && (
        <Modal
          open
          title={confirmState.title}
          closeLabel={t('git.cancel')}
          onClose={() => setConfirmState(null)}
          footer={(
            <>
              <button type="button" className={shared.btn} onClick={() => setConfirmState(null)}>
                {confirmState.cancelLabel}
              </button>
              <button
                type="button"
                className={confirmState.danger === true ? styles.confirmBtnDanger : styles.confirmBtn}
                onClick={confirmState.onConfirm}
              >
                {confirmState.confirmLabel}
              </button>
            </>
          )}
        >
          <div className={styles.confirmBody}>{confirmState.description}</div>
        </Modal>
      )}
    </div>
  )
}
