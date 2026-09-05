/**
 * Notes manager panel: left note list (grouped by workspace) + right
 * editor/preview, plus the git sync surface — per-workspace update/push on the
 * editor header, global update/push on the manager head when a central repo is
 * in use, a commit popover, and best-effort auto-pull when opening a note.
 * All UI copy comes from the `md-notes` locale namespace via `t`.
 * The renderer is kept lean: every hook lives in `./hooks`, and the leaf
 * sub-components in `./components` (see `./hooks/useNotesManager` for the
 * orchestrator that wires them together).
 * @module dsh-md-notes/client/NotesManager
 */

import * as React from 'react'
import { IconCloseOutline16, IconSettingsOutline16, MarkdownText, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownFileMentions, MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { LoadingIndicator } from '../components/LoadingIndicator/LoadingIndicator.tsx'
import { CreateNoteDialog } from '../components/CreateNoteDialog/CreateNoteDialog.tsx'
import { ICON_URL } from '../api.ts'
import { preprocessWikiLinks, resolveNoteLink, titleMatchCount } from '../note-links.ts'
import { useUpdateAvailable } from '../update.ts'
import shared from '../styles.module.css'
import styles from './components/notes-manager.module.css'
import { WorkspaceList } from './components/WorkspaceList.tsx'
import { useNotesManager } from './hooks/useNotesManager.ts'
import type { NotesManagerProps } from './hooks/types.ts'

/**
 * The full-screen notes manager: a pure renderer. All state and handlers live in
 * `useNotesManager`; `updateInfo` is the only component-local state.
 */
export function NotesManager(props: NotesManagerProps): React.ReactElement {
  const { store, tracker, t, sessions } = props
  const updateInfo = useUpdateAvailable()
  const {
    workspaces, noWorkspaces, loading, contentLoading, selectedWsId, selected, content,
    mode, saving, flash, statusByWs, gitMsg, pushTargetWsId, pushMsg,
    updatingWsId, pushingWsId, pushConflict, remoteChanged, confirmState, collapsed, gitOpen,
    writingThis, dirty, busy, repoStatuses, unpushedTotal, pendingWsCount,
    currentWsId, toggleWorkspace, toggleGit, open, save, createIn, submitCreate, cancelCreate, remove,
    updateClick, pushForWs, doPush, resolveAndRetry, setPushMsg, setPushTargetWsId, setMode,
    setContent, setConfirmState, close, openDshSettings, createWsId, createBusy,
  } = useNotesManager({ store, tracker, t, sessions })

  // Localized Markdown chrome (code-fence copy + footnotes), memoized per
  // locale revision so the preview does not rebuild MarkdownText's cached
  // element table on every render.
  const markdownLabels = React.useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])

  // Always call the latest `open` from the resolver (its closure captures
  // autoPull etc., so a memoized resolver must not freeze an old copy).
  const openRef = React.useRef(open)
  openRef.current = open

  // Note interlinks: `[[笔记名]]` (rewritten to backticks) and `` `笔记名` ``
  // both resolve to a note and open it on click (TODO 4.3 / note-links.ts).
  const fileMentions = React.useMemo<MarkdownFileMentions>(() => ({
    resolve: (value) => {
      const link = resolveNoteLink(value, workspaces, selectedWsId)
      if (link === undefined) return undefined
      const wsName = workspaces.find((w) => w.workspaceId === link.workspaceId)?.name ?? ''
      const base = wsName === '' ? link.name : `${wsName} · ${link.name}`
      // A title-based link is ambiguous when several notes in the resolved
      // workspace share that title — surface it so the user switches to the
      // file name (which is unique per workspace).
      const dupCount = titleMatchCount(value, workspaces, link.workspaceId)
      return {
        open: () => openRef.current(link.name, link.workspaceId),
        label: link.title,
        title: dupCount > 1 ? `${base} — ${t('link.duplicateHint', { count: dupCount })}` : base,
      }
    },
  }), [workspaces, selectedWsId])

  const previewText = React.useMemo(
    () => preprocessWikiLinks(content, workspaces, selectedWsId),
    [content, workspaces, selectedWsId],
  )

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
          <button type="button" className={shared.closeBtn} aria-label={t('manager.close')} onClick={close}>
            <IconCloseOutline16 size={14} />
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
            gitOpen={gitOpen}
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
            onToggleGit={toggleGit}
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
                      : <div className={`${styles.preview} ${shared.scrollWide}`}><MarkdownText text={previewText} labels={markdownLabels} fileMentions={fileMentions} /></div>}
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
              {confirmState.ai !== undefined && (
                <span className={styles.aiCell}>
                  <Tooltip label={confirmState.ai.hint} side="top" maxWidth={280}>
                    <span
                      className={styles.aiHint}
                      role="note"
                      aria-label={confirmState.ai.hint}
                      tabIndex={0}
                    >?</span>
                  </Tooltip>
                  <button
                    type="button"
                    className={shared.btn}
                    onClick={confirmState.ai.run}
                  >{confirmState.ai.label}</button>
                </span>
              )}
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
      {createWsId !== null && (
        <CreateNoteDialog
          defaultTitle={t('manager.untitled', { date: new Date().toLocaleDateString() })}
          existingNames={workspaces.find((w) => w.workspaceId === createWsId)?.notes.map((n) => n.name) ?? []}
          busy={createBusy}
          t={t}
          onCancel={cancelCreate}
          onSubmit={submitCreate}
        />
      )}
    </div>
  )
}
