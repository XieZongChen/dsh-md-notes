/**
 * Browser-local store sharing overlay state between the three slots.
 * Immutable snapshots + listeners; components subscribe via useStore.
 * @module dsh-md-notes/client/store
 */

export interface NotesStoreState {
  managerOpen: boolean
  picker: { sessionId: string; messageId: string } | null
}

export class NotesStore {
  private state: NotesStoreState = { managerOpen: false, picker: null }
  private readonly listeners = new Set<() => void>()

  get(): NotesStoreState {
    return this.state
  }

  set(patch: Partial<NotesStoreState>): void {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
}
