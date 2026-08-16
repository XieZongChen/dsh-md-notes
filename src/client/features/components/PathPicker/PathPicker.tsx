/**
 * PathPicker: a click-to-choose directory field. Empty state shows the
 * placeholder as the whole button; once a path is chosen it displays the path
 * with a trailing edit glyph. Clicking anywhere in the region re-opens the
 * picker (the caller owns the actual directory-picker call).
 * @module dsh-md-notes/client/PathPicker
 */

import * as React from 'react'
import { IconEditOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import styles from './path-picker.module.css'

export interface PathPickerProps {
  /** The chosen path ('' = not chosen yet). */
  value: string
  /** Text shown when no path is chosen. */
  placeholder: string
  /** Opens the directory picker. */
  onPick: () => void
  /** Disables the region while another operation runs. */
  disabled?: boolean | undefined
}

/**
 * The click-to-choose directory field.
 * @param props - value, placeholder, onPick, disabled.
 * @returns the picker region element.
 */
export function PathPicker(props: PathPickerProps): React.ReactElement {
  const { value, placeholder, onPick, disabled } = props
  return (
    <Tooltip label={value} side="bottom" disabled={value === ''} maxWidth={480}>
      <button
        type="button"
        className={styles.pathPicker}
        onClick={onPick}
        disabled={disabled === true}
        title={value === '' ? placeholder : undefined}
      >
        {value === ''
          ? <span className={styles.pathPlaceholder}>{placeholder}</span>
          : (
            <>
              <span className={styles.pathText}>{value}</span>
              <IconEditOutline16 className={styles.editIcon} />
            </>
          )}
      </button>
    </Tooltip>
  )
}
