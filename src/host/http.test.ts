/**
 * Dispatch-layer tests for `notesApiHandler` / `iconHandler`: the trust
 * fence, method routing, the `gitConfig` write whitelist, the credential
 * redaction on `gitStatus`, and the write-lock rejection — the pieces with
 * security or protocol semantics that pure domain tests do not cover.
 * @module dsh-md-notes/http.test
 */

import { Readable } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { iconHandler, notesApiHandler, redactRemote, type NotesApiDeps } from './http.ts'
import { createKeyedLock } from './keyed-lock.ts'
import type { ResolvedRepo } from './git.ts'

/** Per-test scratch dirs so no domain call ever touches the real /tmp/ws paths. */
const scratchDirs: string[] = []
function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'md-notes-http-'))
  scratchDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true })
  scratchDirs.length = 0
})

/** A POST request carrying one JSON body (strings pass through raw — malformed-JSON cases). */
function makeReq(method: string, body?: unknown, headers?: Record<string, string>): IncomingMessage {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  const chunks = body === undefined ? [] : [Buffer.from(payload)]
  const stream = Readable.from(chunks) as Readable & { method?: string; headers?: Record<string, string> }
  stream.method = method
  stream.headers = headers ?? {}
  return stream as unknown as IncomingMessage
}

/** A response capturing status + body; `done` resolves on end(). */
function makeRes(): {
  status: number
  body: string
  done: Promise<string>
  writeHead(status: number, headers?: unknown): void
  end(data?: unknown): void
} {
  let resolveDone!: (body: string) => void
  const done = new Promise<string>((resolve) => { resolveDone = resolve })
  const res = {
    status: 0,
    body: '',
    done,
    writeHead(status: number): void { res.status = status },
    end(data?: unknown): void {
      res.body = typeof data === 'string' ? data : ''
      resolveDone(res.body)
    },
  }
  return res
}

/** Drive one request through the handler and parse the JSON body. */
async function call(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  method: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; json: Record<string, unknown>; raw: string }> {
  const res = makeRes()
  await handler(makeReq(method, body, headers), res as unknown as ServerResponse)
  const raw = await res.done
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(raw) as Record<string, unknown>
  } catch {
    /* non-JSON body stays {} */
  }
  return { status: res.status, json, raw }
}

const REPO: ResolvedRepo = {
  kind: 'own', repoDir: '/tmp/repo', subdir: '', branch: 'main', remote: 'https://example.com/r.git',
}

/** Deps with every domain call spied; tests override what they exercise. */
function makeDeps(overrides: Partial<NotesApiDeps> = {}): NotesApiDeps {
  const notesDir = join(scratchDir(), '.dsh-notes')
  return {
    resolveDir: () => notesDir,
    resolveRepo: () => REPO,
    listWorkspaces: () => [],
    workspaceIdForSession: () => undefined,
    updateSettings: vi.fn(async () => {}),
    readSettings: () => ({}),
    hasWorkspaces: () => true,
    checkUpdate: vi.fn(async () => ({ ok: false as const, error: 'x' })),
    git: {
      status: vi.fn(async () => ({ ok: true, remote: 'https://example.com/r.git' })),
      init: vi.fn(async () => false),
      push: vi.fn(async () => ({ ok: true })),
      pull: vi.fn(async () => ({ ok: true })),
      sync: vi.fn(async () => ({ ok: true })),
    },
    lock: createKeyedLock(),
    ...overrides,
  }
}

/** The default deps' notes dir (gitPush/gitPull passthrough assertions compare it). */
function defaultNotesDir(deps: NotesApiDeps): string {
  return deps.resolveDir() ?? ''
}

describe('notesApiHandler — trust fence', () => {
  it('rejects with 401 before dispatch when authorize returns 401', async () => {
    const deps = makeDeps({ authorize: () => 401 })
    const updateSettings = deps.updateSettings as ReturnType<typeof vi.fn>
    const { status, json } = await call(notesApiHandler(deps), 'POST', { method: 'gitConfig', gitMode: 'own' })
    expect(status).toBe(401)
    expect(json.ok).toBe(false)
    expect(json.code).toBe('unauthorized')
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('rejects with 403 for an untrusted Host/Origin', async () => {
    const deps = makeDeps({ authorize: () => 403 })
    const { status, json } = await call(notesApiHandler(deps), 'POST', { method: 'list' })
    expect(status).toBe(403)
    expect(json.code).toBe('forbidden')
  })

  it('runs before the 405 check — an unauthenticated GET leaks no method info', async () => {
    const deps = makeDeps({ authorize: () => 401 })
    const { status } = await call(notesApiHandler(deps), 'GET')
    expect(status).toBe(401)
  })

  it('passes through to dispatch when authorize allows', async () => {
    const deps = makeDeps({ authorize: () => undefined })
    const { status, json } = await call(notesApiHandler(deps), 'POST', { method: 'gitSettings' })
    expect(status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.settings).toEqual({})
  })
})

describe('notesApiHandler — routing', () => {
  it('answers 405 for non-POST (no fence configured)', async () => {
    const { status } = await call(notesApiHandler(makeDeps()), 'GET', { method: 'list' })
    expect(status).toBe(405)
  })

  it('a malformed JSON body degrades to an unknown-method result, not a crash', async () => {
    const { status, json } = await call(notesApiHandler(makeDeps()), 'POST', '{not json')
    expect(status).toBe(200)
    expect(json.ok).toBe(false)
    expect(json.error).toBe('unknown method: ')
  })

  it('an unknown method reports the name back', async () => {
    const { json } = await call(notesApiHandler(makeDeps()), 'POST', { method: 'dropTables' })
    expect(json.ok).toBe(false)
    expect(json.error).toBe('unknown method: dropTables')
  })
})

describe('notesApiHandler — session-scoped list', () => {
  it("a session that resolves no workspace sees no workspaces (not everyone's)", async () => {
    const deps = makeDeps({
      listWorkspaces: () => [{
        workspaceId: 'ws-1', name: 'one', notesDir: '/tmp/one/.dsh-notes',
        notes: [{ name: 'a.md', title: 'A', updatedAt: 1 }],
      }],
      workspaceIdForSession: () => undefined,
      hasWorkspaces: () => true,
    })
    const { json } = await call(notesApiHandler(deps), 'POST', { method: 'list', sessionId: 's1' })
    expect(json.ok).toBe(true)
    expect(json.workspaces).toEqual([])
    expect(json.noWorkspaces).toBe(false)
  })
})

describe('notesApiHandler — write lock', () => {
  it('a busy note write rejects with code note-writing', async () => {
    let release: (() => void) | undefined
    const lock = createKeyedLock()
    const held = lock.with('ws-1/note.md', () => new Promise<void>((r) => { release = r }))
    const deps = makeDeps({ lock })
    const { json } = await call(notesApiHandler(deps), 'POST', {
      method: 'write', workspaceId: 'ws-1', name: 'note.md', content: 'x',
    })
    expect(json.ok).toBe(false)
    expect(json.code).toBe('note-writing')
    release?.()
    await held
  })

  it('delete on the same locked note also rejects', async () => {
    let release: (() => void) | undefined
    const lock = createKeyedLock()
    const held = lock.with('ws-1/note.md', () => new Promise<void>((r) => { release = r }))
    const deps = makeDeps({ lock })
    const { json } = await call(notesApiHandler(deps), 'POST', {
      method: 'delete', workspaceId: 'ws-1', name: 'note.md',
    })
    expect(json.code).toBe('note-writing')
    release?.()
    await held
  })
})

describe('notesApiHandler — gitStatus redaction', () => {
  it('redacts userinfo credentials from the remote URL', async () => {
    const deps = makeDeps()
    deps.git.status = vi.fn(async () => ({
      ok: true, repoDir: '/tmp/repo', branch: 'main', remote: 'https://user:secret@example.com/r.git',
    }))
    const { json } = await call(notesApiHandler(deps), 'POST', { method: 'gitStatus', workspaceId: 'ws-1' })
    expect(json.ok).toBe(true)
    const status = json.status as { remote?: string }
    expect(status.remote).toBe('https://***@example.com/r.git')
  })

  it('keeps a credential-free remote unchanged', async () => {
    const deps = makeDeps()
    const { json } = await call(notesApiHandler(deps), 'POST', { method: 'gitStatus' })
    expect((json.status as { remote?: string }).remote).toBe('https://example.com/r.git')
  })
})

describe('redactRemote', () => {
  it('redacts user:password and username-only tokens', () => {
    expect(redactRemote('https://user:pass@h/x.git')).toBe('https://***@h/x.git')
    expect(redactRemote('https://token@h/x.git')).toBe('https://***@h/x.git')
  })

  it('passes through clean URLs and non-URL remotes', () => {
    expect(redactRemote('https://h/x.git')).toBe('https://h/x.git')
    expect(redactRemote('git@github.com:owner/repo.git')).toBe('git@github.com:owner/repo.git')
    expect(redactRemote('/local/path')).toBe('/local/path')
  })
})

describe('notesApiHandler — gitConfig whitelist', () => {
  it('forwards only whitelisted keys to updateSettings', async () => {
    const deps = makeDeps()
    const updateSettings = deps.updateSettings as ReturnType<typeof vi.fn>
    const { json } = await call(notesApiHandler(deps), 'POST', {
      method: 'gitConfig',
      gitMode: 'shared',
      gitAutoPull: false,
      gitAuthorName: 'n',
      gitAuthorEmail: 'e',
      gitCentral: { remote: 'https://c' },
      gitRepos: { ws: { remote: 'https://w' } },
      route: '/evil', workspaceId: 'ws-1', noteName: '../../escape.md',
    })
    expect(json.ok).toBe(true)
    expect(updateSettings).toHaveBeenCalledTimes(1)
    expect(updateSettings).toHaveBeenCalledWith({
      gitMode: 'shared',
      gitAutoPull: false,
      gitAuthorName: 'n',
      gitAuthorEmail: 'e',
      gitCentral: { remote: 'https://c' },
      gitRepos: { ws: { remote: 'https://w' } },
    })
  })

  it('drops an all-unknown patch (updateSettings still called with {})', async () => {
    const deps = makeDeps()
    const updateSettings = deps.updateSettings as ReturnType<typeof vi.fn>
    await call(notesApiHandler(deps), 'POST', { method: 'gitConfig', route: '/evil' })
    expect(updateSettings).toHaveBeenCalledWith({})
  })

  it('surfaces an update failure as ok:false with the message', async () => {
    const deps = makeDeps({
      updateSettings: vi.fn(async () => { throw new Error('settings unavailable') }),
    })
    const { json } = await call(notesApiHandler(deps), 'POST', { method: 'gitConfig', gitMode: 'off' })
    expect(json.ok).toBe(false)
    expect(json.error).toBe('settings unavailable')
  })
})

describe('iconHandler', () => {
  it('answers the fence rejection before touching the file', async () => {
    const handler = iconHandler('/nonexistent/icon.svg', () => 403)
    const { status, json } = await call(handler, 'GET')
    expect(status).toBe(403)
    expect(json.ok).toBe(false)
  })

  it('answers 404 for a missing icon (no fence)', async () => {
    const { status } = await call(iconHandler('/nonexistent/icon.svg'), 'GET')
    expect(status).toBe(404)
  })
})

describe('notesApiHandler — dispatch details', () => {
  it('list with a session resolving a workspace shows ONLY that workspace', async () => {
    const entry = (id: string) => ({
      workspaceId: id, name: id, notesDir: join(scratchDir(), '.dsh-notes'),
      notes: [{ name: `${id}.md`, title: id, updatedAt: 1 }],
    })
    const deps = makeDeps({
      listWorkspaces: () => [entry('ws-1'), entry('ws-2')],
      workspaceIdForSession: (sessionId: string | undefined) => sessionId === 's1' ? 'ws-1' : undefined,
    })
    const { json } = await call(notesApiHandler(deps), 'POST', { method: 'list', sessionId: 's1' })
    const workspaces = (json.workspaces as Array<{ workspaceId: string }>)
    expect(workspaces.map((w) => w.workspaceId)).toEqual(['ws-1'])
  })

  it('gitPush builds a default commit message when none is given', async () => {
    const deps = makeDeps()
    const push = deps.git.push as ReturnType<typeof vi.fn>
    await call(notesApiHandler(deps), 'POST', { method: 'gitPush', workspaceId: 'ws-1', message: '   ' })
    const message = push.mock.calls[0]?.[2] as string
    expect(typeof message).toBe('string')
    expect(message).toMatch(/^Notes update /u)
  })

  it('gitPull passes force/manual through to the git api', async () => {
    const deps = makeDeps()
    const pull = deps.git.pull as ReturnType<typeof vi.fn>
    const notesDir = defaultNotesDir(deps)
    await call(notesApiHandler(deps), 'POST', { method: 'gitPull', workspaceId: 'ws-1', force: true, manual: true })
    expect(pull).toHaveBeenCalledWith(REPO, notesDir, true, true)
    await call(notesApiHandler(deps), 'POST', { method: 'gitPull', workspaceId: 'ws-1' })
    expect(pull).toHaveBeenLastCalledWith(REPO, notesDir, false, false)
  })

  it('appendConversation locks on the SANITIZED name (traversal input)', async () => {
    let release: (() => void) | undefined
    const lock = createKeyedLock()
    // sanitizeName('../../evil.md') → '..-..-evil.md': the lock key must equal
    // the sanitized target file, never the raw traversal input.
    const held = lock.with('ws-1/..-..-evil.md', () => new Promise<void>((r) => { release = r }))
    const deps = makeDeps({ lock })
    const { json } = await call(notesApiHandler(deps), 'POST', {
      method: 'appendConversation', workspaceId: 'ws-1', noteName: '../../evil.md',
      questionText: 'q', answerText: 'a',
    })
    expect(json.code).toBe('note-writing')
    release?.()
    await held
  })
})
