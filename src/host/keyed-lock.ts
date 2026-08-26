/**
 * Process-scoped keyed concurrency primitives, generic over resource keys.
 *
 * Two semantics, two primitives:
 * - `KeyedLock` — busy ⇒ **reject immediately** (`acquired: false`). Right for
 *   note writes, where the UI already disables the action and rejection is a
 *   safety net (see docs/write-lock.md).
 * - `KeyedMutex` — busy ⇒ **queue** behind the holder (FIFO). Right for git
 *   operations on a shared clone, where a concurrent push should wait for the
 *   in-flight one rather than fail (see `src/index.ts` GitApi wiring).
 *
 * The notes domain uses `<workspaceId>/<name>`; git uses `repo/<repoDir>`.
 * Future domains reuse the primitives with their own key conventions.
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

/**
 * A queueing keyed mutex: tasks under the same key run strictly one at a time,
 * in FIFO order. A task's rejection never breaks the queue — the next task
 * still runs. The per-key chain is dropped once its queue drains, so the map
 * does not grow unboundedly with stale keys.
 */
export interface KeyedMutex {
  runExclusive<T>(key: string, task: () => Promise<T>): Promise<T>
}

/** Create a keyed mutex (one instance per plugin apply, dies with the process). */
export function createKeyedMutex(): KeyedMutex {
  const tails = new Map<string, Promise<void>>()
  const runExclusive = async <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const prev = tails.get(key) ?? Promise.resolve()
    const result = prev.then(() => task())
    // Store a never-rejecting tail so a failed task does not poison the queue.
    const settled = result.then(() => undefined, () => undefined)
    tails.set(key, settled)
    void settled.then(() => {
      // Drop the key once its queue drains (no newer caller queued behind it).
      if (tails.get(key) === settled) tails.delete(key)
    })
    return result
  }
  return { runExclusive }
}
