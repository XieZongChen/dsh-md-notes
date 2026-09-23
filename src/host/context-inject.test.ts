/**
 * Tests for the note-content injection (`registerNoteContextInjection`): the
 * pure extraction/dedup/folding logic driven through a captured `agent/pre-step`
 * handler with REAL note files under a temp dir. `createUserMessage` is
 * stubbed (vi.mock) — its real module has workspace-external runtime imports
 * (dsh-typert-protocol) the test node_modules does not resolve, and the stub's
 * plain object keeps assertions on shape/order direct.
 * @module dsh-md-notes/context-inject.test
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { NOTE_CONTEXT_KIND, registerNoteContextInjection, type NoteToolTier } from './context-inject.ts'

vi.mock('@deepseek-ai/dsh-llm', () => ({
  createUserMessage: (init: { content: Array<{ type: string; text: string }>; source?: unknown }) =>
    ({ content: init.content, source: init.source }) as unknown as UserMessage,
}))

/** Minimal user message: only the text blocks (+ optional source) the handler reads. */
function msg(text: string, source?: unknown): UserMessage {
  return { content: [{ type: 'text', text }], source } as unknown as UserMessage
}

/** The captured pre-step handler + the fake ctx that captured it. */
interface Captured {
  handler: (payload: {
    agent: { id?: string; session: { header: { cwd?: string } } }
    messages: UserMessage[]
    signal: AbortSignal
  }, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>
}

/**
 * Register with a tool tier. The default is `'off'` so the reference-injection
 * cases below isolate their own behavior; the discovery notice has its own
 * describe block.
 */
function register(tools: NoteToolTier = 'off'): Captured {
  let captured!: Captured['handler']
  const fakeCtx = {
    on(event: string, handler: Captured['handler']): () => void {
      if (event === 'agent/pre-step') captured = handler
      return () => {}
    },
  } as unknown as Context
  registerNoteContextInjection(fakeCtx, { tools })
  return { handler: captured }
}

const ENTER: PreStepDecision = { kind: 'enter' } as unknown as PreStepDecision

/** Drive the handler: history + claimed batch, decision from next(). */
async function run(
  captured: Captured,
  cwd: string | undefined,
  messages: UserMessage[],
  decision: PreStepDecision = { ...ENTER, messages: [...messages] } as PreStepDecision,
  signal: AbortSignal = new AbortController().signal,
  agentId = 'session-1',
): Promise<PreStepDecision> {
  return captured.handler(
    { agent: { id: agentId, session: { header: { cwd } } }, messages, signal },
    () => Promise.resolve(decision),
  )
}

/** An injected context message's text (stubbed createUserMessage shape). */
function injectedText(message: UserMessage): string {
  const block = (message.content as Array<{ type: string; text?: string }>)[0]
  return block?.text ?? ''
}

let tempDir = ''

afterEach(async () => {
  if (tempDir !== '') { await rm(tempDir, { recursive: true, force: true }); tempDir = '' }
})

/** A temp workspace with one note file; returns { cwd, path }. */
async function workspaceWithNote(name: string, content: string): Promise<{ cwd: string; path: string }> {
  tempDir = await mkdtemp(join(tmpdir(), 'md-notes-inject-'))
  const notesDir = join(tempDir, '.dsh-notes')
  await mkdir(notesDir, { recursive: true })
  const path = join(notesDir, name)
  await writeFile(path, content, 'utf8')
  return { cwd: tempDir, path }
}

describe('note context injection', () => {
  it('injects the note content right after the last claimed message', async () => {
    const { cwd, path } = await workspaceWithNote('plan.md', '# Plan\nSecret details')
    const captured = register()
    const history = [msg('earlier')]
    const claimed = [msg('引用笔记「plan」：.dsh-notes/plan.md')]
    const decision = { kind: 'enter', messages: [...history, ...claimed] } as unknown as PreStepDecision

    const result = await run(captured, cwd, claimed, decision)
    if (result.kind !== 'enter') throw new Error('expected enter')
    expect(result.messages).toHaveLength(3)
    // The injection lands right AFTER the last claimed message (index 2 here,
    // since the claimed message is the array's last element at index 1).
    expect(result.messages[1]).toBe(claimed[0])
    expect(injectedText(result.messages[2] as UserMessage)).toContain('Secret details')
    expect((result.messages[2] as UserMessage).source).toEqual({ kind: NOTE_CONTEXT_KIND, path })
  })

  it('injects AFTER trailing history: content lands behind the last claimed message', async () => {
    const { cwd } = await workspaceWithNote('a.md', 'A-content')
    const captured = register()
    const claimed = [msg('see .dsh-notes/a.md')]
    const later = [msg('system row after')]
    const decision = { kind: 'enter', messages: [...claimed, ...later] } as unknown as PreStepDecision

    const result = await run(captured, cwd, claimed, decision)
    if (result.kind !== 'enter') throw new Error('expected enter')
    expect(result.messages).toEqual([claimed[0], expect.anything(), later[0]])
    expect(injectedText(result.messages[1] as UserMessage)).toContain('A-content')
  })

  it('extracts CJK and spaced names, and ../ cross-workspace refs (Set-deduped)', async () => {
    // Two SIBLING workspaces under one temp base: refs from ws-a reach ws-b
    // via `../ws-b/…` exactly like real cross-workspace references.
    const base = await mkdtemp(join(tmpdir(), 'md-notes-inject-'))
    tempDir = base
    const wsA = join(base, 'ws-a')
    const wsB = join(base, 'ws-b')
    await mkdir(join(wsA, '.dsh-notes'), { recursive: true })
    await mkdir(join(wsB, '.dsh-notes'), { recursive: true })
    await writeFile(join(wsA, '.dsh-notes', '我的 笔记.md'), 'CJK content', 'utf8')
    await writeFile(join(wsB, '.dsh-notes', 'b.md'), 'cross-ws content', 'utf8')

    const captured = register()
    // Same CJK ref twice (one message) + one cross-workspace ref → TWO injections.
    const claimed = [msg('看 .dsh-notes/我的 笔记.md 与 .dsh-notes/我的 笔记.md，再看 ../ws-b/.dsh-notes/b.md')]
    const decision = { kind: 'enter', messages: [...claimed] } as unknown as PreStepDecision

    const result = await run(captured, wsA, claimed, decision)
    if (result.kind !== 'enter') throw new Error('expected enter')
    expect(result.messages).toHaveLength(3) // claimed + 2 injections
    expect(injectedText(result.messages[1] as UserMessage)).toContain('CJK content')
    expect(injectedText(result.messages[2] as UserMessage)).toContain('cross-ws content')
  })

  it('skips a deleted note and returns the decision unchanged', async () => {
    const { cwd } = await workspaceWithNote('gone.md', 'x')
    const captured = register()
    const claimed = [msg('ref .dsh-notes/missing.md')]
    const decision = { kind: 'enter', messages: [...claimed] } as unknown as PreStepDecision

    const result = await run(captured, cwd, claimed, decision)
    expect(result).toBe(decision)
  })

  it('passes a non-enter decision through untouched', async () => {
    const { cwd } = await workspaceWithNote('a.md', 'A')
    const captured = register()
    const defer = { kind: 'defer' } as unknown as PreStepDecision
    const result = await run(captured, cwd, [msg('ref .dsh-notes/a.md')], defer)
    expect(result).toBe(defer)
  })

  it('passes through when the session has no cwd', async () => {
    const { cwd } = await workspaceWithNote('a.md', 'A')
    void cwd
    const captured = register()
    const claimed = [msg('ref .dsh-notes/a.md')]
    const decision = { kind: 'enter', messages: [...claimed] } as unknown as PreStepDecision
    const result = await run(captured, undefined, claimed, decision)
    expect(result).toBe(decision)
  })

  it('does not re-inject a note already injected in this batch (source identity)', async () => {
    const { cwd, path } = await workspaceWithNote('dup.md', 'D')
    const captured = register()
    // The claimed batch already carries an injected message for this path
    // (our producer-owned kind; V3→V4-migrated history reads back the same).
    const alreadyInjected = msg('injected earlier', { kind: NOTE_CONTEXT_KIND, path })
    const claimed = [msg('ref .dsh-notes/dup.md'), alreadyInjected]
    const decision = { kind: 'enter', messages: [...claimed] } as unknown as PreStepDecision

    const result = await run(captured, cwd, claimed, decision)
    expect(result).toBe(decision)
  })

  it('does not re-inject over a legacy bare-md-notes record from plugin ≤0.12.0', async () => {
    const { cwd, path } = await workspaceWithNote('legacy.md', 'L')
    const captured = register()
    // V3-native logs written by plugin ≤0.12.0 carry the bare kind; V4's
    // direct-kind retention passes them through unchanged, so the dedupe
    // guard must still recognize them.
    const legacyInjected = msg('injected long ago', { kind: 'md-notes', path })
    const claimed = [msg('ref .dsh-notes/legacy.md'), legacyInjected]
    const decision = { kind: 'enter', messages: [...claimed] } as unknown as PreStepDecision

    const result = await run(captured, cwd, claimed, decision)
    expect(result).toBe(decision)
  })

  it('throws when the signal is already aborted before injection', async () => {
    const { cwd } = await workspaceWithNote('a.md', 'A')
    const captured = register()
    const claimed = [msg('ref .dsh-notes/a.md')]
    const decision = { kind: 'enter', messages: [...claimed] } as unknown as PreStepDecision
    const ac = new AbortController()
    ac.abort()
    await expect(run(captured, cwd, claimed, decision, ac.signal)).rejects.toThrow()
  })
})

/**
 * The discovery notice (docs/memory.md step 2). Its job is that a model which
 * never reads the tool list still learns the note library exists — so its
 * contract is: once per session, only when notes exist, and only naming tools
 * this deployment actually registered.
 */
describe('note discovery notice', () => {
  it('injects the notice once, before any referenced content', async () => {
    const { cwd, path } = await workspaceWithNote('plan.md', '# Plan\nSecret details')
    const captured = register('write')
    const claimed = [msg('引用笔记「plan」：.dsh-notes/plan.md')]
    const decision = { kind: 'enter', messages: [...claimed] } as unknown as PreStepDecision

    const result = await run(captured, cwd, claimed, decision)
    if (result.kind !== 'enter') throw new Error('expected enter')
    expect(result.messages).toHaveLength(3)
    const notice = injectedText(result.messages[1] as UserMessage)
    expect(notice).toContain('[笔记库 / Notes]')
    expect(notice).toContain('1 note(s)')
    expect(notice).toContain('note_search')
    expect(notice).toContain('note_write')
    expect((result.messages[1] as UserMessage).source).toEqual({ kind: NOTE_CONTEXT_KIND })
    // The referenced note still lands AFTER the notice.
    expect(injectedText(result.messages[2] as UserMessage)).toContain('Secret details')
    expect((result.messages[2] as UserMessage).source).toEqual({ kind: NOTE_CONTEXT_KIND, path })
  })

  it('injects the notice even when the step references nothing', async () => {
    const { cwd } = await workspaceWithNote('a.md', 'A')
    const captured = register('read')
    const claimed = [msg('no reference here')]
    const decision = { kind: 'enter', messages: [...claimed] } as unknown as PreStepDecision

    const result = await run(captured, cwd, claimed, decision)
    if (result.kind !== 'enter') throw new Error('expected enter')
    expect(result.messages).toHaveLength(2)
    const notice = injectedText(result.messages[1] as UserMessage)
    expect(notice).toContain('note_read')
    // The read tier must not advertise a tool that was never registered.
    expect(notice).not.toContain('note_write')
    expect(notice).toContain('只读笔记')
  })

  it('sends the notice at most once per session', async () => {
    const { cwd } = await workspaceWithNote('a.md', 'A')
    const captured = register('write')
    const claimed = [msg('first')]
    const decision = { kind: 'enter', messages: [...claimed] } as unknown as PreStepDecision

    const first = await run(captured, cwd, claimed, decision, undefined, 'session-a')
    expect(first.kind === 'enter' && first.messages).toHaveLength(2)
    const second = await run(captured, cwd, claimed, decision, undefined, 'session-a')
    expect(second).toBe(decision)
    // A different session gets its own notice.
    const other = await run(captured, cwd, claimed, decision, undefined, 'session-b')
    expect(other.kind === 'enter' && other.messages).toHaveLength(2)
  })

  it('stays silent for an empty workspace and for the off tier', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'md-notes-inject-'))
    const captured = register('write')
    const claimed = [msg('hi')]
    const decision = { kind: 'enter', messages: [...claimed] } as unknown as PreStepDecision
    expect(await run(captured, tempDir, claimed, decision)).toBe(decision)

    const { cwd } = await workspaceWithNote('a.md', 'A')
    const off = register('off')
    expect(await run(off, cwd, claimed, decision)).toBe(decision)
  })

  it('defaults to off — no notice unless the deployment opts in (docs/memory-eval.md)', async () => {
    // The agent-accessible surface ships OFF: its benefit was never established,
    // so a default install must behave exactly like the pre-memory plugin. This
    // registers with NO options, exercising the module's own default.
    const { cwd } = await workspaceWithNote('a.md', 'A')
    let captured!: Captured['handler']
    const fakeCtx = {
      on(event: string, handler: Captured['handler']): () => void {
        if (event === 'agent/pre-step') captured = handler
        return () => {}
      },
    } as unknown as Context
    registerNoteContextInjection(fakeCtx)
    const claimed = [msg('hi')]
    const decision = { kind: 'enter', messages: [...claimed] } as unknown as PreStepDecision
    expect(await run({ handler: captured }, cwd, claimed, decision)).toBe(decision)
  })
})
