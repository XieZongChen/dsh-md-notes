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
import { IconCloseOutline16, IconFolderClose16, IconFolderOpen16, IconPlusOutline16, IconSendOutline16, IconSettingsOutline16, IconTriangleRightFill14, MarkdownText, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { LoadingIndicator } from '../components/LoadingIndicator/LoadingIndicator.tsx'
import type { GitStatusData, NoteSummary, WorkspaceNotes } from '../api.ts'
import { api, gitErrorText, gitPullApi, gitPushApi, gitSettingsApi, gitStatusApi, gitSyncApi, ICON_URL } from '../api.ts'
import { useUpdateAvailable } from '../update.ts'
import { fmtTime } from '../markdown.ts'
import type { NotesUiStore } from '../store.ts'
import { noteKey, type BusyTracker } from '../busy.ts'
import type { MdNotesKey } from '../locales/index.ts'
import shared from '../styles.module.css'
import styles from './notes-manager.module.css'

/** Per-workspace Git sync card: status + update/push actions (workspace scope). */
interface GitSyncCardProps {
  status: GitStatusData | null | undefined
  busy: boolean
  updating: boolean
  pushing: boolean
  pushOpen: boolean
  pushMsg: string
  remoteChanged: string[] | null
  onUpdate: () => void
  onPush: () => void
  onPushMsgChange: (value: string) => void
  onConfirmPush: () => void
  onCancelPush: () => void
  t: TranslateNS<'md-notes'>
}

function GitSyncCard({ status, busy, updating, pushing, pushOpen, pushMsg, remoteChanged, onUpdate, onPush, onPushMsgChange, onConfirmPush, onCancelPush, t }: GitSyncCardProps): React.ReactElement | null {
  if (status === null || status === undefined || !status.repoDir) return null
  const unpushed = status.unpushed ?? 0
  return (
    <div className={styles.gitCard}>
      <div className={styles.gitCardHead}>
        <span className={styles.gitCardTitle}>{t('git.cardTitle')}</span>
        {unpushed === 0
          ? <span className={styles.gitPillSynced}>{t('git.synced')}</span>
          : <span className={styles.gitPillUnpushed}>{t('git.unpushed', { count: unpushed })}</span>}
      </div>
      <div className={styles.gitCardRows}>
        <div className={styles.gitCardRow}>{t('git.branch')}: {status.branch ?? 'main'}{status.subdir ? ` · ${t('git.subpath')}: ${status.subdir}` : ''}</div>
        {status.lastCommit ? <div className={styles.gitCardRow}>{t('git.lastCommit', { time: status.lastCommit })}</div> : null}
      </div>
      {(status.remoteAhead ?? 0) > 0 && (
        <div className={styles.gitCardHint}>{t('git.remoteAhead')}</div>
      )}
      {remoteChanged !== null && remoteChanged.length > 0 && (
        <div className={styles.gitCardHint}>{t('git.remoteUpdated')}</div>
      )}
      {pushOpen && (
        <div className={styles.gitCardPush}>
          <input
            className={shared.input}
            placeholder={t('git.commitPlaceholder')}
            value={pushMsg}
            onChange={(e) => onPushMsgChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onConfirmPush() }}
          />
          <button type="button" className={styles.gitCardPushBtn} disabled={busy} onClick={onConfirmPush} title={t('git.confirmPush')}>
            {pushing ? <LoadingIndicator size={14} /> : <IconSendOutline16 />}
          </button>
          <button type="button" className={styles.gitCardPushBtn} disabled={busy} onClick={onCancelPush} title={t('git.cancel')}>
            <IconCloseOutline16 />
          </button>
        </div>
      )}
      <div className={styles.gitCardActions}>
        <button type="button" className={styles.gitBtn} disabled={busy} onClick={onUpdate}>
          {updating && <LoadingIndicator size={12} />}{t('git.update')}
        </button>
        <button type="button" className={styles.gitPushBtn} disabled={busy} onClick={onPush}>
          {pushing && <LoadingIndicator size={12} />}{t('git.push')}
        </button>
      </div>
    </div>
  )
}

/** One note row in the workspace list. */
interface NoteItemProps {
  note: NoteSummary
  active: boolean
  writing: boolean
  onOpen: () => void
  onRemove: () => void
  t: TranslateNS<'md-notes'>
}

function NoteItem({ note, active, writing, onOpen, onRemove, t }: NoteItemProps): React.ReactElement {
  return (
    <div className={active ? `${styles.noteItem} ${styles.noteItemActive}` : styles.noteItem} onClick={onOpen}>
      <div className={styles.noteMain}>
        <div className={styles.noteTitle}>{note.title}</div>
        <div className={styles.noteTime}>{fmtTime(note.updatedAt)}</div>
      </div>
      {writing
        ? <span className={styles.noteWriting}><LoadingIndicator size={12} /></span>
        : (
          <button type="button" className={styles.noteDel} title={t('manager.delete')} onClick={(e) => { e.stopPropagation(); onRemove() }}>
            🗑
          </button>
        )}
    </div>
  )
}

/** The left pane: workspace groups with their notes and per-workspace git cards. */
interface WorkspaceListProps {
  workspaces: WorkspaceNotes[]
  loading: boolean
  noWorkspaces: boolean
  selectedWsId: string | null
  selected: string | null
  collapsed: Record<string, boolean>
  statusByWs: Record<string, GitStatusData | null>
  busy: boolean
  updatingWsId: string | null
  pushingWsId: string | null
  pushTargetWsId: string | null
  pushMsg: string
  remoteChanged: string[] | null
  currentWsId: string | null
  tracker: BusyTracker
  t: TranslateNS<'md-notes'>
  onToggleWorkspace: (wsId: string) => void
  onCreate: (wsId: string) => void
  onOpen: (name: string, wsId: string) => void
  onRemove: (name: string, wsId: string) => void
  onUpdate: (wsId: string) => void
  onPush: (wsId: string) => void
  onPushMsgChange: (value: string) => void
  onConfirmPush: (wsId: string) => void
  onCancelPush: () => void
}

function WorkspaceList(props: WorkspaceListProps): React.ReactElement {
  const {
    workspaces, loading, noWorkspaces, selectedWsId, selected, collapsed, statusByWs, busy,
    updatingWsId, pushingWsId, pushTargetWsId, pushMsg, remoteChanged, currentWsId, tracker, t,
    onToggleWorkspace, onCreate, onOpen, onRemove, onUpdate, onPush, onPushMsgChange,
    onConfirmPush, onCancelPush,
  } = props
  const grouped = workspaces.length > 1
  return (
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
                      onClick={() => onToggleWorkspace(ws.workspaceId)}
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
                      <span className={styles.wsCount}>{ws.notes.length}</span>
                      <span className={styles.wsNewBtn} role="button" title={t('manager.new')} onClick={(e) => { e.stopPropagation(); onCreate(ws.workspaceId) }}>
                        <IconPlusOutline16 />
                      </span>
                    </div>
                  )}
                  {!collapsed[ws.workspaceId] && (
                    <GitSyncCard
                      status={statusByWs[ws.workspaceId]}
                      busy={busy}
                      updating={updatingWsId === ws.workspaceId}
                      pushing={pushingWsId === ws.workspaceId}
                      pushOpen={pushTargetWsId === ws.workspaceId}
                      pushMsg={pushMsg}
                      remoteChanged={currentWsId === ws.workspaceId ? remoteChanged : null}
                      onUpdate={() => onUpdate(ws.workspaceId)}
                      onPush={() => onPush(ws.workspaceId)}
                      onPushMsgChange={onPushMsgChange}
                      onConfirmPush={() => onConfirmPush(ws.workspaceId)}
                      onCancelPush={onCancelPush}
                      t={t}
                    />
                  )}
                  {!collapsed[ws.workspaceId] && (ws.notes.length === 0 && grouped
                    ? <div className={`${shared.empty} ${styles.wsEmpty}`}>{t('manager.empty')}</div>
                    : ws.notes.map((n) => (
                      <NoteItem
                        key={n.name}
                        note={n}
                        active={selected === n.name && selectedWsId === ws.workspaceId}
                        writing={tracker.isBusy(noteKey(ws.workspaceId, n.name))}
                        onOpen={() => onOpen(n.name, ws.workspaceId)}
                        onRemove={() => onRemove(n.name, ws.workspaceId)}
                        t={t}
                      />
                    )))}
                </div>
              ))}
      </div>
    </div>
  )
}

export interface NotesManagerProps {
  /** Shared store; closing the manager clears `managerOpen`. */
  store: NotesUiStore
  /** In-flight write tracker: busy note rows/actions lock (docs/write-lock.md §7.3). */
  tracker: BusyTracker
  /** Framework-injected locale seat (`md-notes` namespace). */
  t: TranslateNS<'md-notes'>
}

/**
 * The full-screen notes manager.
 */
export function NotesManager(props: NotesManagerProps): React.ReactElement {
  const { store, tracker, t } = props
  const updateInfo = useUpdateAvailable()
  const [workspaces, setWorkspaces] = React.useState<WorkspaceNotes[]>([])
  const [noWorkspaces, setNoWorkspaces] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [contentLoading, setContentLoading] = React.useState(false)
  const [selectedWsId, setSelectedWsId] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [content, setContent] = React.useState('')
  /** Content as of the last open/save — the "dirty" baseline. */
  const [savedContent, setSavedContent] = React.useState('')
  const [mode, setMode] = React.useState<'edit' | 'preview'>('preview')
  const [saving, setSaving] = React.useState(false)
  const [flash, setFlash] = React.useState<'' | MdNotesKey>('')
  const [statusByWs, setStatusByWs] = React.useState<Record<string, GitStatusData | null>>({})
  const [gitMsg, setGitMsg] = React.useState('')
  /** Workspace whose commit popover is open (null = none). */
  const [pushTargetWsId, setPushTargetWsId] = React.useState<string | null>(null)
  const [pushMsg, setPushMsg] = React.useState('')
  /** Workspace currently updating / pushing (null = none) — card spinners key off these. */
  const [updatingWsId, setUpdatingWsId] = React.useState<string | null>(null)
  const [pushingWsId, setPushingWsId] = React.useState<string | null>(null)
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
        const target = selectedWsId ?? res.workspaces[0]?.workspaceId
        if (target !== undefined) {
          setSelectedWsId((prev) => prev ?? target)
        }
        // Every workspace's Git card needs its own status, not just the current
        // one (each card renders its own branch/uncommitted/update/push).
        for (const ws of res.workspaces) refreshStatus(ws.workspaceId)
      }
    })
  }

  /** Re-read one note's content into the editor, guarded by the current selection. */
  const readInto = (wsId: string, name: string, onDone?: () => void): void => {
    void api('read', { name, workspaceId: wsId }).then((res) => {
      if (res.ok && isCurrent(wsId, name)) { setContent(res.content ?? ''); setSavedContent(res.content ?? '') }
      onDone?.()
    })
  }

  /** Re-list workspaces, then re-read the selected note (if it is the one just synced). */
  const refreshAndRereadSelected = (wsId: string): void => {
    refresh()
    if (selected !== null && isCurrent(wsId, selected)) readInto(wsId, selected)
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

  const open = (name: string, wsId: string): void => {
    selectionRef.current = { wsId, name }
    setSelectedWsId(wsId)
    setSelected(name)
    setMode('preview')
    setContent('') // clear the previous note's content so switching never flashes it
    setSavedContent('')
    setGitMsg('')
    setRemoteChanged(null)
    setContentLoading(true)
    refreshStatus(wsId)
    readInto(wsId, name, () => setContentLoading(false))
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
        readInto(wsId, name, () => setContentLoading(false))
      }
    })
  }

  const save = (): void => {
    const wsId = currentWsId()
    if (!selected || wsId === null) return
    setSaving(true)
    void tracker.run(noteKey(wsId, selected), () => api('write', { name: selected, content, workspaceId: wsId })).then((res) => {
      if (res.ok) {
        setFlash('manager.saved')
        setSavedContent(content)
        refresh()
        window.setTimeout(() => setFlash(''), 1200)
      } else {
        setFlash('manager.saveFailed')
      }
    }).finally(() => setSaving(false))
  }

  const createIn = (wsId: string): void => {
    const title = t('manager.untitled', { date: new Date().toLocaleDateString() })
    setFlash('manager.creating')
    void api('create', { title, workspaceId: wsId }).then((res) => {
      if (res.ok && res.name) {
        setFlash('manager.created')
        refresh()
        open(res.name, wsId)
        setMode('edit') // newly created note opens in the editor, not preview
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
        void tracker.run(noteKey(wsId, name), () => api('delete', { name, workspaceId: wsId })).then((res) => {
          if (res.ok) {
            if (selected === name && selectedWsId === wsId) { setSelected(null); setContent('') }
            refresh()
          }
        })
      },
    })
  }

  const doUpdate = (wsId: string, force: boolean): void => {
    setUpdatingWsId(wsId)
    setGitMsg('')
    void gitPullApi(wsId, force, true).then((res) => {
      if (res.ok) {
        setRemoteChanged(null)
        refreshStatus(wsId)
        // The pull may have brought new notes down — re-list so the left
        // panel shows them immediately.
        refreshAndRereadSelected(wsId)
        setFlash('manager.updated')
        window.setTimeout(() => setFlash(''), 1200)
      } else {
        setGitMsg(gitErrorText(t, res.code, res.error))
      }
    }).finally(() => setUpdatingWsId(null))
  }

  const updateClick = (wsId: string): void => {
    // First run a conservative pull (never overwrites). If the remote has
    // files that differ from the local ones (skipped > 0), ask the user
    // whether to replace the local versions — never overwrite silently.
    setUpdatingWsId(wsId)
    setGitMsg('')
    void gitPullApi(wsId, false, true).then((res) => {
      if (!res.ok) {
        setGitMsg(gitErrorText(t, res.code, res.error))
        return
      }
      const skipped = res.skipped ?? 0
      if (skipped === 0) {
        // Nothing differed → the conservative pull already brought everything.
        // Re-list so newly-pulled notes appear in the left panel.
        setRemoteChanged(null)
        refreshAndRereadSelected(wsId)
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
    }).finally(() => setUpdatingWsId(null))
  }
  const runPush = (wsId: string, message: string, overwrite = false): void => {
    setPushingWsId(wsId)
    setGitMsg('')
    void gitPushApi(wsId, message, overwrite).then((res) => {
      if (res.ok) {
        setPushTargetWsId(null)
        setPushMsg('')
        setPushConflict(null)
        refreshStatus(wsId)
      } else if (res.code === 'remote-changed') {
        // The remote has notes newer/different from the local ones — ask the
        // user whether to overwrite them with the local version before pushing.
        const names = (res.changed ?? []).join(t('manager.listSep'))
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
        setPushTargetWsId(null)
        setPushMsg('')
        setPushConflict({ wsId, message, error: gitErrorText(t, res.code, res.error) })
      } else {
        setGitMsg(gitErrorText(t, res.code, res.error))
      }
    }).finally(() => setPushingWsId(null))
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
  }

  const resolveAndRetry = (): void => {
    if (pushConflict === null) return
    setPushingWsId(pushConflict.wsId)
    setGitMsg('')
    // ok 分支把 pushing 的生命周期交给 runPush（它重新 setPushing(true) 并在
    // 自己的 finally 里复位）；此处只在失败路径复位，避免与 runPush 竞争。
    let handedOff = false
    void gitSyncApi(pushConflict.wsId).then((res) => {
      if (res.ok) {
        setPushConflict(null)
        handedOff = true
        runPush(pushConflict.wsId, pushConflict.message)
      } else {
        setGitMsg(gitErrorText(t, res.code, res.error))
      }
    }).finally(() => { if (!handedOff) setPushingWsId(null) })
  }

  /** Whether the currently selected note is being written (any session — docs/write-lock.md §7.3). */
  const writingThis = selected !== null && selectedWsId !== null && tracker.isBusy(noteKey(selectedWsId, selected))

  const updating = updatingWsId !== null
  const pushing = pushingWsId !== null
  const dirty = content !== savedContent
  const busy = updating || saving || pushing || writingThis

  const close = (): void => store.update((d) => { d.managerOpen = false })
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
  /** Global git roll-up for the bottom bar (per-workspace detail lives in each Git card). */
  const repoStatuses = Object.values(statusByWs).filter((s): s is GitStatusData => s !== null && !!s.repoDir)
  const unpushedTotal = repoStatuses.reduce((sum, s) => sum + (s.unpushed ?? 0), 0)
  const pendingWsCount = repoStatuses.filter((s) => (s.unpushed ?? 0) > 0).length

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
          <WorkspaceList
            workspaces={workspaces}
            loading={loading}
            noWorkspaces={noWorkspaces}
            selectedWsId={selectedWsId}
            selected={selected}
            collapsed={collapsed}
            statusByWs={statusByWs}
            busy={busy}
            updatingWsId={updatingWsId}
            pushingWsId={pushingWsId}
            pushTargetWsId={pushTargetWsId}
            pushMsg={pushMsg}
            remoteChanged={remoteChanged}
            currentWsId={currentWsId()}
            tracker={tracker}
            t={t}
            onToggleWorkspace={toggleWorkspace}
            onCreate={createIn}
            onOpen={open}
            onRemove={remove}
            onUpdate={updateClick}
            onPush={pushForWs}
            onPushMsgChange={setPushMsg}
            onConfirmPush={doPush}
            onCancelPush={() => setPushTargetWsId(null)}
          />
          <div className={styles.editor}>
            {!selected
              ? <div className={`${shared.empty} ${styles.editorEmpty}`}>{t('manager.editorEmpty')}</div>
              : (
                <>
                  <div className={styles.editorHead}>
                    <button
                      type="button"
                      className={mode === 'preview' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                      onClick={() => setMode('preview')}
                    >{t('manager.tabPreview')}</button>
                    <button
                      type="button"
                      className={mode === 'edit' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                      disabled={writingThis}
                      onClick={() => setMode('edit')}
                    >{t('manager.tabEdit')}</button>
                    <span className={styles.editorName}>{selected}</span>
                    <span className={styles.flash}>{flash === '' ? '' : t(flash)}</span>
                    {writingThis && <span className={styles.remoteHint}>{t('manager.writingFile')}</span>}
                    {dirty && <span className={styles.dirtyPill}>{t('manager.unsaved')}</span>}
                    {mode === 'edit' && (
                      <button type="button" className={styles.saveBtn} disabled={busy} onClick={save}>
                        {saving && <LoadingIndicator size={12} />}{t('manager.save')}
                      </button>
                    )}
                  </div>
                  {contentLoading
                    ? <div className={styles.editorLoading}><LoadingIndicator label={t('git.loading')} /></div>
                    : mode === 'edit'
                      ? <textarea className={styles.textarea} value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} />
                      : <div className={styles.preview}><MarkdownText text={content} /></div>}
                </>
              )}
          </div>
        </div>
        <div className={styles.syncLine}>
          {repoStatuses.length > 0 && (
            <span className={styles.syncGlobal}>
              {t('git.globalTitle')} · {unpushedTotal > 0 ? t('git.unpushed', { count: unpushedTotal }) : t('git.synced')} · {t('git.globalSummary', { ws: repoStatuses.length, pending: pendingWsCount })}
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
