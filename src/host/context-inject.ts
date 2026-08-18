/**
 * Host-side note-content injection: makes `@` note references reliable.
 *
 * The client serializes a note reference into the user message as a readable
 * path line (`引用笔记「标题」：.dsh-notes/xxx.md`). Whether the MODEL reads the
 * path on its own is model judgment — not guaranteed. This module removes the
 * dependency: at every `agent/pre-step`, it scans the claimed message batch
 * for note-reference paths (relative to the session cwd = workspace root),
 * reads the referenced notes, and folds their CONTENT into the model request
 * as durable injected-context messages — the same channel dsh's
 * agent-instructions uses, so the note content is in front of the model
 * without it needing to call `read`.
 *
 * The injected context persists in the session log (appended with the step),
 * renders in the chat as an injected-context disclosure row, and dedupes
 * across steps by its source identity — one reference costs one injection.
 * @module dsh-md-notes/context-inject
 */

import { readFile } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'

/** Durable source kind of the injected note context (renders as context row). */
export const NOTE_CONTEXT_SOURCE = 'md-notes'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'md-notes': { path?: string }
  }
}

/**
 * Matches a serialized note path: `[../][dir/]*.dsh-notes/<name>.md`.
 * `\w` with the u flag covers CJK file names; the path runs until whitespace
 * or a colon/quote, so it extracts cleanly from the readable reference line.
 */
const NOTE_PATH_RE = /(?:\.\.\/)?\/?(?:[\p{L}\p{N}_.\-]+\/)*\.dsh-notes\/[\p{L}\p{N}_.\-]+\.md/gu

/** Note paths referenced by one message's text blocks (deduped per message). */
function referencedPaths(message: UserMessage): string[] {
  const out: string[] = []
  for (const block of message.content ?? []) {
    if (block === null || typeof block !== 'object') continue
    const b = block as { type?: string; text?: string }
    if (b.type !== 'text' || typeof b.text !== 'string') continue
    NOTE_PATH_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = NOTE_PATH_RE.exec(b.text)) !== null) out.push(m[0])
  }
  return out
}

/**
 * Register the pre-step injection. The handler runs after the pipeline's own
 * decision (`next()`): it resolves every referenced note against the session
 * cwd and folds the contents in right after the referencing user message.
 * Deleted notes are skipped (the readable path stays in the message).
 * @param ctx - host root context.
 * @returns the event disposer (callers wrap it in `ctx.effect`).
 */
export function registerNoteContextInjection(ctx: Context): () => void {
  return ctx.on('agent/pre-step', async (
    { agent, messages, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const cwd = agent.session.header.cwd
    if (typeof cwd !== 'string' || cwd === '') return decision

    // Distinct note paths referenced across the claimed batch.
    const refs = new Set<string>()
    for (const message of messages) {
      for (const ref of referencedPaths(message)) refs.add(ref)
    }
    if (refs.size === 0) return decision

    const notes: Array<{ path: string; content: string }> = []
    for (const ref of refs) {
      const abs = resolvePath(cwd, ref)
      // Safety boundary: only read files inside a `.dsh-notes` directory.
      if (!/(^|[\\/])\.dsh-notes[\\/]/.test(abs)) continue
      try {
        notes.push({ path: abs, content: await readFile(abs, 'utf8') })
      } catch {
        /* deleted/moved since the pick — the readable path stays in the message */
      }
    }
    if (notes.length === 0) return decision
    signal.throwIfAborted()

    // Dedupe: a step that already carries our injected context skips re-reading.
    const fresh = notes.filter(note => !messages.some(message =>
      (message.source as { kind?: string; path?: string } | undefined)?.kind === NOTE_CONTEXT_SOURCE
      && (message.source as { path?: string } | undefined)?.path === note.path))
    if (fresh.length === 0) return decision

    // Injected context carries a one-line citation convention so the model
    // cites notes in the standard markdown link form `[标题](路径)` (the same
    // syntax the user message uses) instead of free-form prose — structured
    // citations any renderer can recognize. Instructions are best-effort
    // guidance, not a guarantee.
    const injected = fresh.map(note => createUserMessage({
      content: [{
        type: 'text',
        text: `[笔记内容]\n\n引用约定：回答中如需引用本笔记，请用 markdown 链接格式 [标题](路径)，路径沿用你看到的引用路径（如 [3333](../dsh-work/.dsh-notes/3333.md)）。\n\n${note.content}`,
      }],
      source: { kind: NOTE_CONTEXT_SOURCE, path: note.path },
    }))

    // Fold right after the referencing user message so the direct prompt
    // precedes the injected content.
    let lastClaimedIndex = -1
    for (let i = decision.messages.length - 1; i >= 0; i--) {
      const message = decision.messages[i]
      if (message !== undefined && messages.includes(message)) {
        lastClaimedIndex = i
        break
      }
    }
    const entered = [
      ...decision.messages.slice(0, lastClaimedIndex + 1),
      ...injected,
      ...decision.messages.slice(lastClaimedIndex + 1),
    ]
    return { kind: 'enter', messages: entered }
  })
}
