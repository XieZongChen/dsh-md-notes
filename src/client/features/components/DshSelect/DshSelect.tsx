/**
 * DshSelect — a native <select> styled identically to dsh's settings selects
 * (`ui-settings-models` ModelsSection): token-based colors, custom chevron
 * replacing the OS arrow. Local copy so the settings panel matches dsh forms.
 * @module dsh-md-notes/client/DshSelect
 */

import * as React from 'react'
import type { SelectHTMLAttributes } from 'react'
import styles from './dsh-select.module.css'

export interface DshSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  className?: string
}

/** The settings-panel enum select. */
export function DshSelect(props: DshSelectProps): React.ReactElement {
  const { className, ...rest } = props
  return <select className={`${styles.select} ${className ?? ''}`} {...rest} />
}
