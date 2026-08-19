/**
 * Process-scoped keyed mutex: at most one held lock per string key.
 * Generic over resource keys — the notes domain uses `<workspaceId>/<name>`
 * (see docs/write-lock.md §4); future domains (git worktrees, exports) can
 * reuse it with their own key conventions without changing this module.
 * @module dsh-md-notes/host/keyed-lock
 */

/** Result of a `with` attempt: either the task's value or "already held". */
export type KeyedLockResult<T> = { acquired: true; value: T } | { acquired: false }

export interface KeyedLock {
  /** Run `task` under `key`'s lock; busy (already held) → `{ acquired: false }` without running. */
  with<T>(key: string, task: () => Promise<T>): Promise<KeyedLockResult<T>>
  /** Whether `key` is currently held. */
  isHeld(key: string): boolean
}

/** Create a keyed lock (one instance per plugin apply, dies with the process). */
export function createKeyedLock(): KeyedLock {
  const held = new Set<string>()
  return {
    isHeld: (key) => held.has(key),
    async with(key, task) {
      if (held.has(key)) return { acquired: false }
      held.add(key)
      try {
        return { acquired: true, value: await task() }
      } finally {
        held.delete(key)
      }
    },
  }
}
