/**
 * The notes manager's left pane: workspace groups with their notes and
 * per-workspace git cards. Pure renderer — all state/handlers come in as props.
 * @module dsh-md-notes/client/NotesManager/WorkspaceList
 */

import * as React from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { IconFolderClose16, IconFolderOpen16, IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { LoadingIndicator } from '../components/LoadingIndicator/LoadingIndicator.tsx'
import type { GitStatusData, WorkspaceNotes } from '../api.ts'
import { noteKey, type BusyTracker } from '../busy.ts'
import shared from '../styles.module.css'
import styles from './notes-manager.module.css'
import { GitSyncCard } from './GitSyncCard.tsx'
import { GitStatusIcon } from './GitStatusIcon.tsx'
import { NoteItem } from './NoteItem.tsx'

interface WorkspaceListProps {
  workspaces: WorkspaceNotes[]
  loading: boolean
  noWorkspaces: boolean
  selectedWsId: string | null
  selected: string | null
  collapsed: Record<string, boolean>
  gitOpen: Record<string, boolean>
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
  onToggleGit: (wsId: string) => void
  onCreate: (wsId: string) => void
  onOpen: (name: string, wsId: string) => void
  onRemove: (name: string, wsId: string) => void
  onUpdate: (wsId: string) => void
  onPush: (wsId: string) => void
  onPushMsgChange: (value: string) => void
  onConfirmPush: (wsId: string) => void
  onCancelPush: () => void
}

export function WorkspaceList(props: WorkspaceListProps): React.ReactElement {
  const {
    workspaces, loading, noWorkspaces, selectedWsId, selected, collapsed, gitOpen, statusByWs, busy,
    updatingWsId, pushingWsId, pushTargetWsId, pushMsg, remoteChanged, currentWsId, tracker, t,
    onToggleWorkspace, onToggleGit, onCreate, onOpen, onRemove, onUpdate, onPush, onPushMsgChange,
    onConfirmPush, onCancelPush,
  } = props
  const grouped = workspaces.length > 1
  return (
    <div className={styles.list}>
      <div className={`${styles.listItems} ${shared.scrollNarrow}`}>
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
                      <span className={styles.wsGroupTitle}>{ws.name}</span>
                      <span className={styles.wsCount}>{ws.notes.length}</span>
                      <GitStatusIcon
                        status={statusByWs[ws.workspaceId]}
                        open={gitOpen[ws.workspaceId] === true}
                        t={t}
                        onToggle={() => onToggleGit(ws.workspaceId)}
                      />
                      <span className={styles.wsNewBtn} role="button" title={t('manager.new')} onClick={(e) => { e.stopPropagation(); onCreate(ws.workspaceId) }}>
                        <IconPlusOutline16 />
                      </span>
                    </div>
                  )}
                  {!collapsed[ws.workspaceId] && gitOpen[ws.workspaceId] === true && (
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
