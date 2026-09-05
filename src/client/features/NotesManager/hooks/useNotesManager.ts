/**
 * Orchestrates the three feature hooks (list / editor / git) and owns the few
 * cross-cutting states they share (`gitMsg`, `remoteChanged`, `confirmState`).
 * @module dsh-md-notes/client/NotesManager/hooks/useNotesManager
 */

import * as React from 'react'
import type { GitStatusData } from '../../api.ts'
import { noteKey } from '../../busy.ts'
import { resolveConflictsWithAi, watchSessionCompletion, type SessionsLike } from '../../ai-conflict.ts'
import { useNotesList } from './useNotesList.ts'
import { useNotesEditor } from './useNotesEditor.ts'
import { useGitSync } from './useGitSync.ts'
import type { ConfirmState, NotesManagerProps } from './types.ts'

/** Minimal ISessions projection (ctx.get('sessions') in the client entry). */
export type { SessionsLike } from '../../ai-conflict.ts'

export function useNotesManager({ store, tracker, t, sessions }: NotesManagerProps & { sessions?: SessionsLike }) {
  const [gitMsg, setGitMsg] = React.useState('')
  const [remoteChanged, setRemoteChanged] = React.useState<string[] | null>(null)
  const [confirmState, setConfirmState] = React.useState<ConfirmState | null>(null)

  const list = useNotesList()
  const editor = useNotesEditor({
    workspaces: list.workspaces,
    autoPull: list.autoPull,
    refresh: list.refresh,
    refreshList: list.refreshList,
    refreshStatus: list.refreshStatus,
    setRemoteChanged,
    setGitMsg,
    setConfirmState,
    tracker,
    t,
  })

  /**
   * AI conflict resolution (docs/ai-conflict.md): close the manager so the
   * new session is visible, create + prompt + open it, and watch for
   * completion (running→false) to refresh the list with a hint.
   */
  const startAiResolve = (workspaceId: string, names: readonly string[], _deleted: readonly string[]): void => {
    if (sessions === undefined) {
      setGitMsg(t('conflict.aiFailed').replace('{error}', 'sessions service unavailable'))
      return
    }
    close()
    resolveConflictsWithAi(sessions, t, workspaceId, names).then((sessionId) => {
      watchSessionCompletion(sessions, sessionId, () => {
        store.update((d) => { d.managerOpen = true })
        list.refresh()
        editor.setFlash('conflict.aiDone')
        window.setTimeout(() => editor.setFlash(''), 4000)
      })
    }).catch((error: unknown) => {
      store.update((d) => { d.managerOpen = true })
      setGitMsg(t('conflict.aiFailed').replace('{error}', error instanceof Error ? error.message : String(error)))
    })
  }

  const git = useGitSync({
    refreshStatus: list.refreshStatus,
    refreshAndRereadSelected: editor.refreshAndRereadSelected,
    setFlash: editor.setFlash,
    setRemoteChanged,
    setGitMsg,
    setConfirmState,
    aiConflict: { startAiResolve },
    t,
  })

  /** Whether the currently selected note is being written (any session — docs/write-lock.md §7.3). */
  const writingThis = editor.selected !== null && editor.selectedWsId !== null && tracker.isBusy(noteKey(editor.selectedWsId, editor.selected))
  const updating = git.updatingWsId !== null
  const pushing = git.pushingWsId !== null
  const busy = updating || editor.saving || pushing || writingThis

  const close = (): void => store.update((d) => { d.managerOpen = false })

  /**
   * Open dsh's own settings panel and jump to the "MD 笔记" section. The
   * settings shell owns its open state locally and exposes no external API,
   * so this simulates the two clicks a user would make: the sidebar settings
   * trigger, then the section's nav cell. The trigger is the only
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
  const repoStatuses = Object.values(list.statusByWs).filter((s): s is GitStatusData => s !== null && !!s.repoDir)
  const unpushedTotal = repoStatuses.reduce((sum, s) => sum + (s.unpushed ?? 0), 0)
  const pendingWsCount = repoStatuses.filter((s) => (s.unpushed ?? 0) > 0).length

  return {
    workspaces: list.workspaces,
    noWorkspaces: list.noWorkspaces,
    loading: list.loading,
    statusByWs: list.statusByWs,
    contentLoading: editor.contentLoading,
    selectedWsId: editor.selectedWsId,
    selected: editor.selected,
    content: editor.content,
    mode: editor.mode,
    saving: editor.saving,
    flash: editor.flash,
    collapsed: editor.collapsed,
    gitOpen: editor.gitOpen,
    dirty: editor.dirty,
    createWsId: editor.createWsId,
    createBusy: editor.createBusy,
    currentWsId: editor.currentWsId,
    toggleWorkspace: editor.toggleWorkspace,
    toggleGit: editor.toggleGit,
    open: editor.open,
    save: editor.save,
    createIn: editor.createIn,
    submitCreate: editor.submitCreate,
    cancelCreate: editor.cancelCreate,
    remove: editor.remove,
    setMode: editor.setMode,
    setContent: editor.setContent,
    gitMsg,
    remoteChanged,
    confirmState,
    setConfirmState,
    pushTargetWsId: git.pushTargetWsId,
    pushMsg: git.pushMsg,
    updatingWsId: git.updatingWsId,
    pushingWsId: git.pushingWsId,
    pushConflict: git.pushConflict,
    updateClick: git.updateClick,
    pushForWs: git.pushForWs,
    doPush: git.doPush,
    resolveAndRetry: git.resolveAndRetry,
    setPushMsg: git.setPushMsg,
    setPushTargetWsId: git.setPushTargetWsId,
    writingThis,
    busy,
    repoStatuses,
    unpushedTotal,
    pendingWsCount,
    close,
    openDshSettings,
  }
}
