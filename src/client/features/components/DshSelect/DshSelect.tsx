/**
 * DshSelect — a dropdown whose popup is the harness's own custom menu panel,
 * not the OS-native `<select>` popup (which no CSS can restyle). Replicates
 * the General-panel language selector (`ui-theme` LanguageRow + the
 * `ui-primitives` Menu primitive): a pill trigger, a portaled menu card with
 * the check-marked selected row, outside-pointerdown/Escape dismissal, and
 * viewport-clamped placement that tracks scroll while open. Local copy so the
 * settings panel matches dsh without a shared-package dependency.
 * @module dsh-md-notes/client/DshSelect
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import styles from './dsh-select.module.css'

/** One selectable row. */
export interface DshSelectOption {
  value: string
  label: string
}

export interface DshSelectProps {
  /** Currently selected value (matches one option's `value`). */
  value: string
  /** Selectable rows, in menu order. */
  options: readonly DshSelectOption[]
  /** Called with the clicked row's value; the menu closes itself. */
  onChange: (value: string) => void
  /** Trigger's accessible name; the visible field label sits outside this component. */
  ariaLabel?: string
}

/** Unplaced portal list: hidden but laid out at a fixed origin so offsetWidth/offsetHeight are real. */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/** ic_ds_chevron_down_outline_14 — same glyph the harness selector shows. */
function ChevronDown14(): React.ReactElement {
  return (
    <svg className={styles.chevron} width={14} height={14} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** ic_ds_check_outline_16 — the harness menu's selection marker. */
function CheckOutline16(): React.ReactElement {
  return (
    <svg className={styles.check} width={16} height={16} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M15.0498 3.92579L8.49512 12.3818C8.25774 12.6881 8.04517 12.9645 7.84668 13.1689C7.63957 13.3823 7.38732 13.5841 7.04492 13.6719C6.86373 13.7183 6.6757 13.7346 6.48926 13.7197C6.13666 13.6915 5.8528 13.5355 5.6123 13.3604C5.38201 13.1926 5.12573 12.9567 4.83984 12.6953L1.03125 9.21289L1.96875 8.1875L5.77734 11.6699C6.08684 11.9529 6.27773 12.1249 6.43066 12.2363C6.50183 12.2882 6.54699 12.3135 6.57324 12.3252C6.58525 12.3305 6.59269 12.3322 6.5957 12.333C6.59802 12.3336 6.59961 12.334 6.59961 12.334C6.63317 12.3367 6.66758 12.3335 6.7002 12.3252C6.7002 12.3252 6.70211 12.3251 6.7041 12.3242C6.70698 12.3229 6.71348 12.319 6.72461 12.3115C6.74849 12.2956 6.78843 12.2642 6.84961 12.2012C6.98138 12.0654 7.13957 11.8628 7.39648 11.5313L13.9502 3.07422L15.0498 3.92579Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** The settings-panel enum dropdown with a harness-style custom popup. */
export function DshSelect(props: DshSelectProps): React.ReactElement {
  const { value, options, onChange, ariaLabel } = props
  const [open, setOpen] = React.useState(false)
  const [fixedPos, setFixedPos] = React.useState<CSSProperties | null>(null)
  const rootRef = React.useRef<HTMLSpanElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  // Fixed-position the portaled list from the trigger rect before paint;
  // track the anchor while open (capture-phase scroll catches the settings
  // panel's own scrolling column). The first run measures the hidden
  // pre-render in the same commit as `open`, so the first painted frame is
  // already at the final position. (Behavior of the harness Menu primitive.)
  React.useLayoutEffect(() => {
    if (!open) {
      setFixedPos(null)
      return
    }
    const place = (): void => {
      const rect = rootRef.current?.getBoundingClientRect() ?? null
      if (rect === null) return
      const MARGIN = 12
      const vw = window.innerWidth
      const vh = window.innerHeight
      const listEl = listRef.current
      const lw = listEl?.offsetWidth ?? 0
      const lh = listEl?.offsetHeight ?? 0
      let x = rect.left
      let y = rect.bottom + 4
      if (lw > 0) x = Math.min(Math.max(x, MARGIN), vw - lw - MARGIN)
      if (lh > 0) y = Math.min(Math.max(y, MARGIN), vh - lh - MARGIN)
      setFixedPos({ left: x, top: y })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  // Outside pointerdown or Escape closes; the portaled list sits outside the
  // trigger subtree, so both are checked.
  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      if (!(e.target instanceof Node)) return
      if (rootRef.current?.contains(e.target) === true) return
      if (listRef.current?.contains(e.target) === true) return
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const selectedLabel = options.find(o => o.value === value)?.label ?? value

  const list = open && (
    <div
      ref={listRef}
      className={styles.list}
      style={fixedPos ?? MEASURE_STYLE}
      role="menu"
      // React portals bubble synthetic events through the REACT tree: without
      // this stop, an item click re-fires the trigger's own onClick (toggle)
      // after onChange. (Same note as the harness Menu primitive.)
      onClick={(e) => { e.stopPropagation() }}
    >
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          role="menuitem"
          className={styles.item}
          onClick={() => {
            onChange(option.value)
            setOpen(false)
          }}
        >
          <span className={styles.itemLabel}>{option.label}</span>
          {option.value === value && <CheckOutline16 />}
        </button>
      ))}
    </div>
  )

  return (
    <span ref={rootRef} className={styles.root}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => { setOpen(v => !v) }}
      >
        {selectedLabel}
        <ChevronDown14 />
      </button>
      {list !== false && createPortal(list, document.body)}
    </span>
  )
}
