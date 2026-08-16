/**
 * LoadingIndicator: dsh's ongoing session-state dot (the blue pixel-chase
 * loader, ui-primitives StateDot `ongoing`) wrapped as a standalone loading
 * indicator with an optional label. Used wherever the plugin has a pending
 * operation — list load, note content load, git busy.
 * @module dsh-md-notes/client/LoadingIndicator
 */

import * as React from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import styles from './loading-indicator.module.css'

export interface LoadingIndicatorProps {
  /** Outer diameter in px (StateDot default 10). */
  size?: number | undefined
  /** Optional label rendered next to the dot. */
  label?: string | undefined
  /** Extra class for layout placement. */
  className?: string | undefined
}

/**
 * The pixel-chase loading indicator.
 * @param props - size, optional label, extra class.
 * @returns the indicator element.
 */
export function LoadingIndicator(props: LoadingIndicatorProps): React.ReactElement {
  const { size = 12, label, className } = props
  return (
    <span className={className === undefined ? styles.indicator : `${styles.indicator} ${className}`}>
      <StateDot state="ongoing" size={size} />
      {label !== undefined && <span className={styles.label}>{label}</span>}
    </span>
  )
}
