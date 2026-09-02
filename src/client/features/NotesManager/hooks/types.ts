/**
 * Shared types for the notes-manager hooks and renderer.
 * @module dsh-md-notes/client/NotesManager/hooks/types
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NotesUiStore } from '../../store.ts'
import type { BusyTracker } from '../../busy.ts'

/** In-page confirmation dialog state (replaces window.confirm, reliable in overlay). */
export interface ConfirmState {
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
  onConfirm: () => void
}

export interface NotesManagerProps {
  /** Shared store; closing the manager clears `managerOpen`. */
  store: NotesUiStore
  /** In-flight write tracker: busy note rows/actions lock (docs/write-lock.md §7.3). */
  tracker: BusyTracker
  /** Framework-injected locale seat (`md-notes` namespace). */
  t: TranslateNS<'md-notes'>
}
