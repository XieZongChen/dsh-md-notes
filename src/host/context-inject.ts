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
import { join, resolve as resolvePath } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { listNotes } from './notes.ts'

/**
 * Durable source of the injected note context: this plugin's own
 * producer-owned kind. dsh 0.1.7 (Session V4) removed the shared `plugin`
 * wrapper kind — every producer now declares its own `MessageSourceMap` key —
 * and the V3→V4 log migration rewrites historical
 * `{ kind: 'plugin', plugin: 'md-notes', … }` events to exactly this
 * `plugin:`-prefixed kind (every other field, the dedupe `path` included, is
 * preserved), so new writes and migrated history share one identity. ui-chat
 * renders a non-`user` source as an injected-context row labeled by the bare
 * kind. The `plugin:` prefix is the V4 convention for third-party producers
 * and keeps our kind from colliding with dsh's first-party vocabulary.
 */
export const NOTE_CONTEXT_KIND = 'plugin:md-notes'

/** What the injection writes: our producer kind plus the dedupe key. */
export interface NoteContextSource {
  readonly kind: typeof NOTE_CONTEXT_KIND
  /** Workspace-absolute note path; the cross-step dedupe key. */
  readonly path?: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'plugin:md-notes': NoteContextSource
  }
}

/**
 * Any durable record the injection may have written, current or legacy:
 * `plugin:md-notes` covers new writes and V3→V4-migrated history; bare
 * `md-notes` covers plugin ≤0.12.0 records that V4's direct-kind retention
 * passes through unchanged (V3-native logs).
 */
type NoteContextRecord = NoteContextSource | { readonly kind: 'md-notes'; readonly path?: string }

/** Whether a message source is one of our injected note-context rows. */
function isNoteContextSource(source: unknown): source is NoteContextRecord {
  const s = source as { kind?: string } | undefined
  return s?.kind === NOTE_CONTEXT_KIND || s?.kind === 'md-notes'
}

/**
 * Matches a serialized note path: `[../][dir/]*.dsh-notes/<name>.md`.
 * `\p{L}\p{N}` with the u flag covers CJK file names, and the space class in
 * the name keeps names with spaces intact; the match stops at whitespace
 * beyond the name or a colon/quote, so it extracts cleanly from the readable
 * reference line.
 */
const NOTE_PATH_RE = /(?:\.\.\/)?\/?(?:[\p{L}\p{N}_.\-]+\/)*\.dsh-notes\/[\p{L}\p{N}_.\- ]+\.md/gu

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

/** Which agent-facing note tools this deployment exposes (mirrors `Config.agentTools`). */
export type NoteToolTier = 'off' | 'read' | 'write'

/** The one-time discovery notice, worded for the tool tier actually registered. */
function notesNotice(count: number, tier: Exclude<NoteToolTier, 'off'>): string {
  const record = tier === 'write'
    ? '需要长期记住的持久事实可用 note_write 追加。\nRecord durable facts with note_write.'
    : '（本部署的 agent 只读笔记，不做写入。）\n(This deployment lets the agent read notes, not write them.)'
  return '[笔记库 / Notes]\n'
    + `本工作区有 ${String(count)} 篇 dsh 笔记（.dsh-notes）。任务依赖项目背景、约定、历史决策或环境事实时，`
    + '先用 note_search 查、note_read 读全文再回答，不要凭记忆猜。\n'
    + `This workspace keeps ${String(count)} note(s) under .dsh-notes. When a task depends on project background, `
    + 'conventions, past decisions or environment facts, consult them with note_search / note_read before answering '
    + 'instead of guessing.\n'
    + record
}

/**
 * Register the pre-step injection. The handler runs after the pipeline's own
 * decision (`next()`): it resolves every referenced note against the session
 * cwd and folds the contents in right after the referencing user message.
 * Deleted notes are skipped (the readable path stays in the message).
 *
 * It also emits ONE discovery notice per session whenever agent note tools are
 * exposed: a model that never reads the tool list never calls `note_search`, so
 * otherwise the library stays invisible to it. Deliberately once per SESSION,
 * not per step, and only when the workspace actually has notes.
 * @param ctx - host root context.
 * @param options - the agent tool tier this deployment registers.
 * @returns the event disposer (callers wrap it in `ctx.effect`).
 */
export function registerNoteContextInjection(
  ctx: Context,
  options: { tools?: NoteToolTier } = {},
): () => void {
  const tier = options.tools ?? 'off'
  // Sessions that already got the notice. Scoped to this registration, so a
  // plugin reload re-sends it once per active session — one extra durable row,
  // never a repeated per-step cost.
  const noticed = new Set<string>()
  return ctx.on('agent/pre-step', async (
    { agent, messages, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const cwd = agent.session.header.cwd
    if (typeof cwd !== 'string' || cwd === '') return decision

    // Discovery notice: once per session, only when the workspace has notes.
    let notice: UserMessage | undefined
    if (tier !== 'off' && !noticed.has(String(agent.id))) {
      const listed = await listNotes(join(cwd, '.dsh-notes'))
      if (listed.ok && listed.notes.length > 0) {
        noticed.add(String(agent.id))
        notice = createUserMessage({
          content: [{ type: 'text', text: notesNotice(listed.notes.length, tier) }],
          source: { kind: NOTE_CONTEXT_KIND },
        })
      }
    }

    // Distinct note paths referenced across the claimed batch.
    const refs = new Set<string>()
    for (const message of messages) {
      for (const ref of referencedPaths(message)) refs.add(ref)
    }

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
    signal.throwIfAborted()

    // Dedupe: a step that already carries our injected context skips re-reading.
    const fresh = notes.filter(note => !messages.some(message =>
      isNoteContextSource(message.source) && message.source.path === note.path))
    if (notice === undefined && fresh.length === 0) return decision

    // Injected context carries a one-line citation convention so the model
    // cites notes in the standard markdown link form `[标题](路径)` (the same
    // syntax the user message uses) instead of free-form prose — structured
    // citations any renderer can recognize. Instructions are best-effort
    // guidance, not a guarantee. The discovery notice comes first so the policy
    // reads before the content.
    const injected: UserMessage[] = notice === undefined ? [] : [notice]
    for (const note of fresh) {
      const source: NoteContextSource = { kind: NOTE_CONTEXT_KIND, path: note.path }
      injected.push(createUserMessage({
        content: [{
          type: 'text',
          text: `[笔记内容 / Note content]\n\n引用约定：回答中如需引用本笔记，请用 markdown 链接格式 [标题](路径)，路径沿用你看到的引用路径（如 [<笔记名>](../<工作区>/.dsh-notes/<笔记名>.md)）。\nCitation convention: when citing this note in your answer, use the markdown link form [title](path), reusing the reference path you see (e.g. [<note-name>](../<workspace>/.dsh-notes/<note-name>.md)).\n\n${note.content}`,
        }],
        source,
      }))
    }

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
