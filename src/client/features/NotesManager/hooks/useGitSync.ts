/**
 * Git sync state + update/push/conflict flows (depends on the list + editor hooks).
 * @module dsh-md-notes/client/NotesManager/hooks/useGitSync
 */

import * as React from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { gitErrorText, gitPullApi, gitPushApi, gitSyncApi } from '../../api.ts'
import type { MdNotesKey } from '../../locales/index.ts'
import type { ConfirmState } from './types.ts'

export function useGitSync(deps: {
  refreshStatus: (wsId: string | null) => void
  refreshAndRereadSelected: (wsId: string) => void
  setFlash: (key: '' | MdNotesKey) => void
  setRemoteChanged: (names: string[] | null) => void
  setGitMsg: (msg: string) => void
  setConfirmState: React.Dispatch<React.SetStateAction<ConfirmState | null>>
  t: TranslateNS<'md-notes'>
}) {
  const { refreshStatus, refreshAndRereadSelected, setFlash, setRemoteChanged, setGitMsg, setConfirmState, t } = deps
  /** Workspace whose commit popover is open (null = none). */
  const [pushTargetWsId, setPushTargetWsId] = React.useState<string | null>(null)
  const [pushMsg, setPushMsg] = React.useState('')
  /** Workspace currently updating / pushing (null = none) — card spinners key off these. */
  const [updatingWsId, setUpdatingWsId] = React.useState<string | null>(null)
  const [pushingWsId, setPushingWsId] = React.useState<string | null>(null)
  const [pushConflict, setPushConflict] = React.useState<{ wsId: string; message: string; error: string } | null>(null)

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
        // keep the commit row open (a failure must not switch it back) and
        // offer an in-app merge-and-retry instead of a bare error.
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
    // The ok branch hands the pushing lifecycle to runPush (it re-sets
    // pushing and resets it in its own finally); here we only reset on the
    // failure path, to avoid racing with runPush.
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

  return {
    pushTargetWsId, pushMsg, updatingWsId, pushingWsId, pushConflict,
    updateClick, pushForWs, doPush, resolveAndRetry, setPushMsg, setPushTargetWsId,
  }
}
