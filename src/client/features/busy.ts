/**
 * Generic async-task tracker over the store's `busy` slice (docs/state.md §4):
 * resource-level "in progress" mirror with idempotent begin/release, a
 * finally-guaranteed `run` wrapper, and aggregate reads. Domain-agnostic —
 * the notes domain contributes `noteKey`; future domains (git tasks, exports,
 * image uploads) reuse the same tracker with their own key prefixes and the
 * store slice needs no change.
 * @module dsh-md-notes/client/busy
 */

import type { NotesUiState, NotesUiStore } from './store.ts'

/** Write-path helper for one resource's in-flight tracking. */
export interface BusyTracker {
  /** Mark `key` busy (idempotent per key); returns the paired release. */
  begin(key: string): () => void
  /** Run a task under `key`'s busy mark: begin → task → finally release. */
  run<T>(key: string, task: () => Promise<T>): Promise<T>
  /** Whether `key` is currently busy. */
  isBusy(key: string): boolean
  /** Number of busy resources (all domains). */
  count(): number
}

/** Create a busy tracker bound to the shared store (one per plugin apply). */
export function createBusyTracker(store: NotesUiStore): BusyTracker {
  // Reference counts make begin/release nestable per key (state.md 铁律 2:
  // nested begin counts once, release pairs down before clearing).
  const refs = new Map<string, number>()
  const release = (key: string): void => {
    const n = refs.get(key) ?? 0
    if (n <= 1) {
      refs.delete(key)
      store.update((d) => { delete d.busy[key] })
    } else {
      refs.set(key, n - 1)
    }
  }
  const begin = (key: string): (() => void) => {
    const n = refs.get(key) ?? 0
    if (n === 0) store.update((d) => { d.busy[key] = true })
    refs.set(key, n + 1)
    return () => { release(key) }
  }
  return {
    begin,
    async run(key, task) {
      const done = begin(key)
      try {
        return await task()
      } finally {
        done()
      }
    },
    isBusy: (key) => store.getSnapshot().busy[key] === true,
    count: () => Object.keys(store.getSnapshot().busy).length,
  }
}

/** Notes-domain resource key: `note/<workspaceId>/<name>` (cross-session unique). */
export function noteKey(workspaceId: string, name: string): string {
  return `note/${workspaceId}/${name}`
}

/** Selector: total busy resources (stable primitive, uSES-safe). */
export function busyCount(s: NotesUiState): number {
  return Object.keys(s.busy).length
}
