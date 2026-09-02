/**
 * Per-workspace Git sync card: status pill + info rows (branch / subpath /
 * last commit) + update/push actions. The push action swaps the button row
 * for a commit-message row; success/cancel swap it back.
 * @module dsh-md-notes/client/NotesManager/components/GitSyncCard
 */

import * as React from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { IconCloseOutline16, IconSendOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { LoadingIndicator } from '../../components/LoadingIndicator/LoadingIndicator.tsx'
import type { GitStatusData } from '../../api.ts'
import shared from '../../styles.module.css'
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

/** A single-line git-info row: no wrap, ellipsis, and a hover tooltip that
 *  shows the full text only when the row actually overflows. */
function GitInfoRow({ text }: { text: string }): React.ReactElement {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const [overflowing, setOverflowing] = React.useState(false)
  React.useLayoutEffect(() => {
    const el = ref.current
    setOverflowing(el !== null && el.scrollWidth > el.clientWidth)
  }, [text])
  const row = <div ref={ref} className={styles.gitCardRow}>{text}</div>
  if (!overflowing) return row
  return <Tooltip label={text} side="bottom">{row}</Tooltip>
}

export function GitSyncCard({ status, busy, updating, pushing, pushOpen, pushMsg, remoteChanged, onUpdate, onPush, onPushMsgChange, onConfirmPush, onCancelPush, t }: GitSyncCardProps): React.ReactElement | null {
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
        <GitInfoRow text={`${t('git.branch')}: ${status.branch ?? 'main'}`} />
        {status.subdir ? <GitInfoRow text={`${t('git.subpath')}: ${status.subdir}`} /> : null}
        {status.lastCommit ? <GitInfoRow text={t('git.lastCommit', { time: status.lastCommit })} /> : null}
      </div>
      {(status.remoteAhead ?? 0) > 0 && (
        <div className={styles.gitCardHint}>{t('git.remoteAhead')}</div>
      )}
      {remoteChanged !== null && remoteChanged.length > 0 && (
        <div className={styles.gitCardHint}>{t('git.remoteUpdated')}</div>
      )}
      {pushOpen
        ? (
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
        )
        : (
          <div className={styles.gitCardActions}>
            <button type="button" className={styles.gitBtn} disabled={busy} onClick={onUpdate}>
              {updating && <LoadingIndicator size={12} />}{t('git.update')}
            </button>
            <button type="button" className={styles.gitPushBtn} disabled={busy} onClick={onPush}>
              {pushing && <LoadingIndicator size={12} />}{t('git.push')}
            </button>
          </div>
        )}
    </div>
  )
}
