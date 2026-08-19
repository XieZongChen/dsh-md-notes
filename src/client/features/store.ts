/**
 * Root-scope UI store shared by the three slots (sidebar entry, assistant
 * action, overlay host): which overlay is open and which conversation a note
 * picker belongs to. Built on dsh's snapshot-store engine
 * (`createSnapshotStore`, zustand/imber based) — immutable snapshots,
 * immer-draft writes, uSES-compatible subscribe.
 *
 * Why NOT the register `store:` seat: slot-scoped store instances are
 * deliberately isolated per scope — the sidebar/overlay slots are root-scoped
 * while the assistant action is session-scoped, and the framework rejects a
 * handle registered across scopes. Cross-scope shared UI state therefore uses
 * a root singleton + props injection (same pattern as the official
 * session-log-export controller).
 * @module dsh-md-notes/client/store
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Which overlay is open, and the conversation a note picker was opened for. */
export interface NotesUiState {
  managerOpen: boolean
  picker: { sessionId: string; messageId: string } | null
  /**
   * In-flight async tasks, keyed by `<domain>/<resource>` (generic busy
   * slice — see docs/state.md §4; notes domain: `note/<workspaceId>/<name>`).
   * Future domains (git worktrees, exports) add keys here without store
   * changes. Transient by design: never persisted.
   */
  busy: Record<string, true>
}

/** The shared store: immutable snapshot source + immer-draft writes. */
export type NotesUiStore = SnapshotStore<NotesUiState>

const INITIAL: NotesUiState = { managerOpen: false, picker: null, busy: {} }

/** Create the root-scope notes UI store (one instance per plugin apply). */
export function createNotesUiStore(): NotesUiStore {
  return createSnapshotStore(INITIAL)
}
