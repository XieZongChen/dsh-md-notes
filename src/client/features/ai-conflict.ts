/**
 * AI conflict resolution (docs/ai-conflict.md): create a workspace-bound
 * session, hand the conflict's three-way context to the model, and let it
 * merge + push (via the host-registered `push_notes` tool, which goes through
 * dsh's native approval panel). Pure prompt assembly is separated for tests;
 * the session orchestration goes through the public ISessions contract.
 * @module dsh-md-notes/client/ai-conflict
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Assemble the conflict-resolution prompt (pure; i18n via t). The three-level
 * methodology mirrors docs/ai-conflict.md §4: semantic merge first, ask_user
 * for undecidable trade-offs, then report + push via the push_notes tool.
 * The host already wrote the base/remote sidecars (and a `.local-deleted`
 * marker for delete-vs-change conflicts) under `.dsh-notes/.conflicts/`.
 */
export function buildConflictPrompt(
  t: TranslateNS<'md-notes'>,
  names: readonly string[],
  workspaceId: string,
): string {
  const lines = names.map((name) => {
    const stem = name.replace(/\.md$/i, '')
    return `- ${t('conflict.fileEntry', {
      name,
      base: `.dsh-notes/.conflicts/${stem}.base.md`,
      remote: `.dsh-notes/.conflicts/${stem}.remote.md`,
    })}`
  })
  return [
    t('conflict.promptIntro'),
    lines.join('\n'),
    t('conflict.promptMethod'),
    t('conflict.promptReport'),
    t('conflict.promptPush', { workspaceId }),
  ].join('\n\n')
}

/** Minimal ISessions surface used here (public contract; structural for tests). */
export interface SessionsLike {
  create(opts?: { workspaceId?: string }): Promise<string>
  open(id: string): void
  binding(id: string): {
    session: {
      rename(title: string): Promise<unknown> | void
      prompt(content: Array<{ type: 'text'; text: string }>, mode: 'queue'): Promise<unknown>
    } | undefined
  } | undefined
  /** Snapshot store of the session list (running flags drive completion). */
  list: {
    getSnapshot(): { byId?: Record<string, { running?: boolean }> }
    subscribe(fn: () => void): () => void
  }
}

/**
 * Run the AI conflict-resolution flow: create the session, rename it, send
 * the conflict prompt, and open it in the UI. Returns the session id so the
 * caller can pass it to {@link watchSessionCompletion}.
 * @throws propagates session-create failures (caller shows a manual hint).
 */
export async function resolveConflictsWithAi(
  sessions: SessionsLike,
  t: TranslateNS<'md-notes'>,
  workspaceId: string,
  names: readonly string[],
): Promise<string> {
  const sessionId = await sessions.create({ workspaceId })
  const session = sessions.binding(sessionId)?.session
  if (session === undefined) throw new Error('session binding unavailable after create')
  void session.rename(t('conflict.sessionTitle'))
  await session.prompt([{ type: 'text', text: buildConflictPrompt(t, names, workspaceId) }], 'queue')
  sessions.open(sessionId)
  return sessionId
}

/**
 * Watch one session for completion and invoke `onDone` once: wait until the
 * session is observed RUNNING, then until it stops running (the list flips
 * `running` back to false when the turn finishes). A session that disappears
 * from the list (closed) also ends the watch. Returns the unsubscribe
 * function. The watcher is stateful on purpose — a just-created session
 * reports running=false while queued, which must NOT count as done.
 */
export function watchSessionCompletion(
  sessions: SessionsLike,
  sessionId: string,
  onDone: () => void,
): () => void {
  let sawRunning = false
  let finished = false
  const finish = (): void => {
    if (finished) return
    finished = true
    onDone()
    unsubscribe()
  }
  const check = (): void => {
    if (finished) return
    const entry = sessions.list.getSnapshot().byId?.[sessionId]
    if (entry === undefined) { finish(); return } // session gone (closed) → stop watching
    if (entry.running === true) sawRunning = true
    else if (sawRunning) finish()
  }
  const unsubscribe = sessions.list.subscribe(check)
  check()
  return unsubscribe
}
