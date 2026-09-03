/**
 * Tests for the HTTP API client envelope: `parseResult` keeps the structured
 * failure body on non-2xx (error codes reach `gitErrorText` instead of being
 * flattened to `http NNN`), non-JSON bodies fall back to the bare status, and
 * transport failures/aborts land on the ApiError branch. `api.ts` has zero
 * runtime imports, so stubbing global fetch is all the harness needed.
 * @module dsh-md-notes/client/api.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api.ts'

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => { vi.unstubAllGlobals() })

describe('api envelope', () => {
  it('passes a 200 result through', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { ok: true, name: 'a.md' })))
    const res = await api('read', { name: 'a.md' })
    expect(res).toEqual({ ok: true, name: 'a.md' })
  })

  it('parses the structured error body on 500 — the code survives (regression)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse(500, { ok: false, code: 'git-failed', error: 'boom' })))
    const res = await api('gitPush', { message: 'm' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('git-failed')
    expect(res.error).toBe('boom')
  })

  it('parses the 401 fence rejection body too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse(401, { ok: false, code: 'unauthorized', error: 'unauthorized' })))
    const res = await api('list')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.code).toBe('unauthorized')
  })

  it('falls back to http NNN for a non-JSON body (proxy 502 page)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } })))
    const res = await api('list')
    expect(res).toEqual({ ok: false, error: 'http 502' })
  })

  it('a transport failure lands on the ApiError branch with the message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const res = await api('list')
    expect(res).toEqual({ ok: false, error: 'fetch failed' })
  })

  it('an aborted fetch reports as a failure branch, not a throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      init?.signal?.throwIfAborted()
      throw new Error('unreachable')
    }))
    const ac = new AbortController()
    ac.abort()
    const res = await api('list', {}, ac.signal)
    expect(res.ok).toBe(false)
  })
})
