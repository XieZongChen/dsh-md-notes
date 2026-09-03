/**
 * Editor selection + content + note write/delete (depends on the list hook).
 * @module dsh-md-notes/client/NotesManager/hooks/useNotesEditor
 */

import * as React from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceNotes } from '../../api.ts'
import { api, gitPullApi } from '../../api.ts'
import { noteKey, type BusyTracker } from '../../busy.ts'
import type { MdNotesKey } from '../../locales/index.ts'
import type { ConfirmState } from './types.ts'

export function useNotesEditor(deps: {
  workspaces: WorkspaceNotes[]
  autoPull: boolean
  refresh: () => void
  refreshList: () => void
  refreshStatus: (wsId: string | null) => void
  setRemoteChanged: (names: string[] | null) => void
  setGitMsg: (msg: string) => void
  setConfirmState: React.Dispatch<React.SetStateAction<ConfirmState | null>>
  tracker: BusyTracker
  t: TranslateNS<'md-notes'>
}) {
  const { workspaces, autoPull, refresh, refreshList, refreshStatus, setRemoteChanged, setGitMsg, setConfirmState, tracker, t } = deps
  const [selectedWsId, setSelectedWsId] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [content, setContent] = React.useState('')
  /** Content as of the last open/save — the "dirty" baseline. */
  const [savedContent, setSavedContent] = React.useState('')
  const [mode, setMode] = React.useState<'edit' | 'preview'>('preview')
  const [saving, setSaving] = React.useState(false)
  const [flash, setFlash] = React.useState<'' | MdNotesKey>('')
  const [contentLoading, setContentLoading] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})
  /** Workspaces whose Git card is expanded (default: all collapsed). */
  const [gitOpen, setGitOpen] = React.useState<Record<string, boolean>>({})
  const [createWsId, setCreateWsId] = React.useState<string | null>(null)
  const [createBusy, setCreateBusy] = React.useState(false)
  /**
   * The current selection plus its read generation. Every `readInto` takes the
   * next ticket; a response applies only when it is still the NEWEST read of
   * the still-current selection — `open()` fires a pre-pull read and a
   * post-pull re-read for the same note, and the first (slower) response must
   * never land after the second (it would restore pre-pull content and pin
   * `savedContent` to it, so a subsequent save would overwrite the pull).
   */
  const selectionRef = React.useRef<{ wsId: string; name: string; reads: number } | null>(null)

  // Default the selected workspace to the first one once the list arrives
  // (moved out of `refresh` so the list hook stays independent of selection).
  React.useEffect(() => {
    setSelectedWsId((prev) => prev ?? workspaces[0]?.workspaceId ?? null)
  }, [workspaces])

  const isCurrent = (wsId: string, name: string): boolean =>
    selectionRef.current !== null && selectionRef.current.wsId === wsId && selectionRef.current.name === name

  /** Re-read one note's content into the editor; superseded responses never land. */
  const readInto = (wsId: string, name: string, onDone?: () => void): void => {
    const sel = selectionRef.current
    const ticket = sel === null ? -1 : (sel.reads += 1)
    void api('read', { name, workspaceId: wsId }).then((res) => {
      const latest = sel !== null && sel.reads === ticket && selectionRef.current === sel
      if (res.ok && latest) { setContent(res.content ?? ''); setSavedContent(res.content ?? '') }
      // The loading state belongs to the newest read: a superseded read must
      // not clear it early. A selection that moved on already started its own
      // open() cycle (which re-arms the loading flag), so its onDone is moot.
      if (sel === null || sel.reads === ticket) onDone?.()
    })
  }

  /** Re-list workspaces, then re-read the selected note (if it is the one just synced). */
  const refreshAndRereadSelected = (wsId: string): void => {
    refresh()
    if (selected !== null && isCurrent(wsId, selected)) readInto(wsId, selected)
  }

  const toggleWorkspace = (wsId: string): void => {
    selectionRef.current = null
    setSelectedWsId(wsId)
    setSelected(null)
    setContent('')
    // Collapsing the workspace also folds its Git card, so re-expanding does
    // not resurrect a previously-open card.
    if (collapsed[wsId] !== true) setGitOpen((prev) => ({ ...prev, [wsId]: false }))
    setCollapsed((prev) => ({ ...prev, [wsId]: !prev[wsId] }))
    setGitMsg('')
    setRemoteChanged(null)
    refreshStatus(wsId)
  }

  /**
   * Toggle a workspace's Git card (independent of its note-list collapse).
   * Opening the card also expands the workspace so the card is actually
   * visible under a collapsed row.
   */
  const toggleGit = (wsId: string): void => {
    if (gitOpen[wsId] !== true) setCollapsed((prev) => ({ ...prev, [wsId]: false }))
    setGitOpen((prev) => ({ ...prev, [wsId]: !prev[wsId] }))
  }

  const currentWsId = (): string | null => selectedWsId ?? workspaces[0]?.workspaceId ?? null

  const open = (name: string, wsId: string): void => {
    selectionRef.current = { wsId, name, reads: 0 }
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
        // The pull may have brought new notes down — re-list (notes only; no
        // per-workspace status sweep — the opened workspace's status was just
        // refreshed above) so the left panel shows them without reopening.
        refreshList()
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
    // Expand the workspace first so the freshly created note shows up in the list.
    setCollapsed((prev) => ({ ...prev, [wsId]: false }))
    setCreateWsId(wsId)
  }

  const submitCreate = (title: string, name: string): void => {
    if (createWsId === null) return
    setCreateBusy(true)
    setFlash('manager.creating')
    void api('create', { title, name, workspaceId: createWsId }).then((res) => {
      if (res.ok && res.name) {
        setCreateWsId(null)
        setFlash('manager.created')
        refresh()
        open(res.name, createWsId)
        setMode('edit') // newly created note opens in the editor, not preview
        window.setTimeout(() => setFlash(''), 1500)
      } else {
        setFlash('manager.createFailed')
      }
    }).finally(() => setCreateBusy(false))
  }

  const cancelCreate = (): void => {
    setCreateWsId(null)
    setCreateBusy(false)
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

  const dirty = content !== savedContent

  return {
    selectedWsId, selected, content, mode, saving, flash, contentLoading, collapsed, gitOpen, dirty,
    createWsId, createBusy, currentWsId, toggleWorkspace, toggleGit, open, save, createIn, submitCreate, cancelCreate,
    remove, setMode, setContent,
    refreshAndRereadSelected, setFlash,
  }
}
