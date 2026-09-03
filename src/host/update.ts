/**
 * npm update check: the latest published dsh-md-notes version vs the
 * installed one (10-minute result cache). Extracted from the plugin entry so
 * the comparison and the caching window are pure/injectable and unit-tested;
 * the entry only wires the defaults together.
 * @module dsh-md-notes/host/update
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ApiResult, UpdateInfo } from '../contract.ts'

/** Compare two semver-ish version strings; returns >0 when `a` is newer. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Injectable seams — tests stub these instead of the network/filesystem. */
export interface UpdateCheckerDeps {
  /** Reads the installed plugin version ('' when unavailable). */
  readCurrentVersion(): Promise<string>
  /** Fetches the latest published version (undefined when unobtainable). */
  fetchLatestVersion(): Promise<string | undefined>
  /** Clock for the cache TTL. */
  now(): number
}

const CACHE_TTL_MS = 10 * 60 * 1000
const REGISTRY_URL = 'https://registry.npmjs.org/dsh-md-notes/latest'

/** Default seam: read the package.json next to the built lib dir. */
async function readInstalledVersion(): Promise<string> {
  try {
    const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    const pkg = JSON.parse(await import('node:fs/promises').then((m) => m.readFile(pkgPath, 'utf8'))) as { version?: string }
    return pkg.version ?? ''
  } catch {
    return ''
  }
}

/** Default seam: query the npm registry with a 10s timeout. */
async function fetchRegistryLatest(): Promise<string | undefined> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 10_000)
  try {
    const res = await fetch(REGISTRY_URL, { signal: ac.signal })
    if (!res.ok) return undefined
    const data = await res.json() as { version?: string }
    return data.version ?? undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Create the cached update checker behind the `checkUpdate` API method.
 * @param enabled - `false` (config `checkUpdate: false`) short-circuits to a
 * failure with NO I/O — offline/managed deployments never touch the network.
 */
export function createUpdateChecker(enabled: boolean, deps: Partial<UpdateCheckerDeps> = {}): () => Promise<ApiResult<UpdateInfo>> {
  const readCurrentVersion = deps.readCurrentVersion ?? readInstalledVersion
  const fetchLatestVersion = deps.fetchLatestVersion ?? fetchRegistryLatest
  const now = deps.now ?? Date.now
  let cache: { at: number; latest: string; hasUpdate: boolean } | null = null
  return async () => {
    if (!enabled) return { ok: false, error: 'update check disabled by config' }
    const current = await readCurrentVersion()
    if (current === '') return { ok: false, error: 'plugin version unavailable' }
    if (cache !== null && now() - cache.at < CACHE_TTL_MS) {
      return { ok: true, current, latest: cache.latest, hasUpdate: cache.hasUpdate }
    }
    const latest = await fetchLatestVersion()
    if (latest === undefined || latest === '') return { ok: false, error: 'registry unavailable' }
    const hasUpdate = compareVersions(latest, current) > 0
    cache = { at: now(), latest, hasUpdate }
    return { ok: true, current, latest, hasUpdate }
  }
}
