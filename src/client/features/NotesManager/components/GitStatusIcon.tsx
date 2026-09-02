/**
 * Workspace-row git toggle: a decolorized git mark plus activity dots that
 * appear only when there is something to act on — remote ahead (bottom-left,
 * warn) and local unpushed (bottom-right, danger). A two-line tooltip surfaces
 * the counts; when neither side has anything, no dot and no tooltip show.
 * Hidden entirely when the workspace has no git repo configured.
 * @module dsh-md-notes/client/NotesManager/components/GitStatusIcon
 */

import * as React from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { GitIcon } from '../../components/GitIcon.tsx'
import type { GitStatusData } from '../../api.ts'
import styles from './notes-manager.module.css'

interface GitStatusIconProps {
  status: GitStatusData | null | undefined
  open: boolean
  t: TranslateNS<'md-notes'>
  onToggle: () => void
}

export function GitStatusIcon({ status, open, t, onToggle }: GitStatusIconProps): React.ReactElement | null {
  // No git repo configured → hide the toggle entirely (mirrors GitSyncCard).
  if (status === null || status === undefined || !status.repoDir) return null
  const remoteAhead = status.remoteAhead ?? 0
  const unpushed = status.unpushed ?? 0
  const lines: string[] = []
  if (remoteAhead > 0) lines.push(t('git.remoteAheadTip', { count: remoteAhead }))
  if (unpushed > 0) lines.push(t('git.unpushedTip', { count: unpushed }))
  const tip = lines.length > 0 ? lines.join('\n') : null

  const button = (
    <button
      type="button"
      className={open ? `${styles.wsGitBtn} ${styles.wsGitBtnActive}` : styles.wsGitBtn}
      aria-label={t('git.title')}
      aria-expanded={open}
      onClick={(e) => { e.stopPropagation(); onToggle() }}
    >
      <GitIcon className={styles.gitIcon} size={14} />
      {remoteAhead > 0 && <span className={`${styles.gitDot} ${styles.gitDotRemote}`} />}
      {unpushed > 0 && <span className={`${styles.gitDot} ${styles.gitDotLocal}`} />}
    </button>
  )
  if (tip === null) return button
  return <Tooltip label={tip} side="bottom">{button}</Tooltip>
}
