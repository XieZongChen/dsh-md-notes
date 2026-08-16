/**
 * DshInput — a text input styled identically to dsh's Input atom
 * (`@deepseek-ai/dsh-client-ui-primitives`): token-based colors that adapt
 * to light/dark themes, focus ring on the brand color, dimmed placeholder.
 * Local copy so the settings panel matches dsh's forms exactly without a
 * shared-package dependency.
 * @module dsh-md-notes/client/DshInput
 */

import * as React from 'react'
import type { InputHTMLAttributes } from 'react'
import styles from './dsh-input.module.css'

export interface DshInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  className?: string
}

/** The settings-panel text input. */
export function DshInput(props: DshInputProps): React.ReactElement {
  const { className, ...rest } = props
  return <input className={`${styles.input} ${className ?? ''}`} {...rest} />
}
