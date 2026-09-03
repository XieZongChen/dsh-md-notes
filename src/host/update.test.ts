/**
 * Tests for the extracted update checker: the semver-ish comparison and the
 * cached check flow with all I/O seams injected (version source, registry,
 * clock) — no network, no filesystem.
 * @module dsh-md-notes/host/update.test
 */

import { describe, expect, it, vi } from 'vitest'
import { compareVersions, createUpdateChecker } from './update.ts'

describe('compareVersions', () => {
  it('equal versions compare 0', () => {
    expect(compareVersions('0.10.1', '0.10.1')).toBe(0)
  })

  it('numerically compares segments, not lexically (0.10.x > 0.9.x)', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('0.9.9', '0.10.0')).toBeLessThan(0)
  })

  it('strips a leading v prefix', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('v2.0.0', '1.99.99')).toBeGreaterThan(0)
  })

  it('pads missing segments with zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.1', '1.2')).toBeGreaterThan(0)
  })

  it('treats a non-numeric segment as 0', () => {
    expect(compareVersions('1.2.beta', '1.2.0')).toBe(0)
  })
})

describe('createUpdateChecker', () => {
  const seams = (current: string, latest: string | undefined) => {
    let clock = 0
    const reads = vi.fn(async () => current)
    const fetches = vi.fn(async () => latest)
    const checker = createUpdateChecker(true, {
      readCurrentVersion: reads,
      fetchLatestVersion: fetches,
      now: () => clock,
    })
    return { checker, reads, fetches, advance: (ms: number) => { clock += ms } }
  }

  it('disabled short-circuits with no I/O at all', async () => {
    const reads = vi.fn(async () => '1.0.0')
    const fetches = vi.fn(async () => '2.0.0')
    const checker = createUpdateChecker(false, { readCurrentVersion: reads, fetchLatestVersion: fetches })
    const res = await checker()
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/disabled/u)
    expect(reads).not.toHaveBeenCalled()
    expect(fetches).not.toHaveBeenCalled()
  })

  it('an unreadable installed version fails without fetching', async () => {
    const { checker, fetches } = seams('', '2.0.0')
    const res = await checker()
    expect(res.ok).toBe(false)
    expect(fetches).not.toHaveBeenCalled()
  })

  it('reports hasUpdate in both directions', async () => {
    const older = seams('0.10.1', '0.20.0')
    const up = await older.checker()
    expect(up).toEqual({ ok: true, current: '0.10.1', latest: '0.20.0', hasUpdate: true })

    const same = seams('0.20.0', '0.20.0')
    const flat = await same.checker()
    expect(flat).toEqual({ ok: true, current: '0.20.0', latest: '0.20.0', hasUpdate: false })
  })

  it('an unobtainable registry result fails and does NOT poison the cache', async () => {
    const { checker, fetches } = seams('1.0.0', undefined)
    expect((await checker()).ok).toBe(false)
    expect(fetches).toHaveBeenCalledTimes(1)
    // A retry after the failure fetches again (no cache entry was written).
    expect((await checker()).ok).toBe(false)
    expect(fetches).toHaveBeenCalledTimes(2)
  })

  it('caches the registry result for the 10-minute TTL (injected clock)', async () => {
    const { checker, fetches, advance } = seams('1.0.0', '1.1.0')
    await checker()
    advance(5 * 60 * 1000)
    await checker()
    expect(fetches).toHaveBeenCalledTimes(1) // within TTL → cached
    advance(6 * 60 * 1000) // 11 minutes since the fetch → past TTL
    await checker()
    expect(fetches).toHaveBeenCalledTimes(2)
  })
})
