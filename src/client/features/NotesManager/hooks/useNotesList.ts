/**
 * List loading + per-workspace git status (the left pane's data).
 * @module dsh-md-notes/client/NotesManager/hooks/useNotesList
 */

import * as React from 'react'
import type { GitStatusData, WorkspaceNotes } from '../../api.ts'
import { api, gitSettingsApi, gitStatusApi } from '../../api.ts'

export function useNotesList() {
  const [workspaces, setWorkspaces] = React.useState<WorkspaceNotes[]>([])
  const [noWorkspaces, setNoWorkspaces] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [statusByWs, setStatusByWs] = React.useState<Record<string, GitStatusData | null>>({})
  const [autoPull, setAutoPull] = React.useState(true)

  const refreshStatus = (wsId: string | null): void => {
    if (wsId === null) return
    void gitStatusApi(wsId).then((res) => {
      // Per-workspace storage: each workspace keeps its own status, so a
      // stale response can never clobber the current workspace's buttons.
      setStatusByWs((prev) => ({ ...prev, [wsId]: res.ok && res.status ? res.status : null }))
    })
  }

  /**
   * Re-list workspaces only — no settings fetch, no per-workspace git status
   * sweep. Each status costs a git fetch plus several subprocesses against
   * that workspace's clone; the auto-pull on note open needs only the
   * refreshed note list (new notes may have come down) plus the opened
   * workspace's own status (refreshed separately), so fanning status out to
   * EVERY workspace on each open would do N-1 needless fetches.
   */
  const refreshList = (): void => {
    void api('list').then((res) => {
      setLoading(false)
      setNoWorkspaces(res.ok === true && res.noWorkspaces === true)
      if (res.ok && res.workspaces) setWorkspaces(res.workspaces)
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
        // Every workspace's Git card needs its own status, not just the current
        // one (each card renders its own branch/uncommitted/update/push).
        for (const ws of res.workspaces) refreshStatus(ws.workspaceId)
      }
    })
  }

  React.useEffect(() => { refresh() }, [])

  return { workspaces, noWorkspaces, loading, statusByWs, autoPull, refresh, refreshList, refreshStatus }
}
