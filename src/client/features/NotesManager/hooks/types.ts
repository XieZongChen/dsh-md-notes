/**
 * Shared types for the notes-manager hooks and renderer.
 * @module dsh-md-notes/client/NotesManager/hooks/types
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NotesUiStore } from '../../store.ts'
import type { BusyTracker } from '../../busy.ts'
import type { SessionsLike } from '../../ai-conflict.ts'

/** In-page confirmation dialog state (replaces window.confirm, reliable in overlay). */
export interface ConfirmState {
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
  onConfirm: () => void
  /**
   * Optional tertiary "AI resolve" action (the AI conflict-resolution flow,
   * docs/ai-conflict.md): `hint` backs the trailing question-mark icon's
   * hover tooltip, `run` launches the flow (closing this dialog is the
   * caller's job — it should also close the manager and jump to the session).
   */
  ai?: {
    label: string
    hint: string
    run: () => void
  }
}

export interface NotesManagerProps {
  /** Shared store; closing the manager clears `managerOpen`. */
  store: NotesUiStore
  /** In-flight write tracker: busy note rows/actions lock (docs/write-lock.md §7.3). */
  tracker: BusyTracker
  /** Framework-injected locale seat (`md-notes` namespace). */
  t: TranslateNS<'md-notes'>
  /** Session services for the AI conflict flow (optional — flow degrades to manual). */
  sessions?: SessionsLike
}
