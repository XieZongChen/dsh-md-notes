/**
 * One-shot repair for legacy session logs that dsh ≥0.1.5 refuses to open
 * (`cannot safely transform unclassified message source`): plugin versions
 * ≤0.12.0 on dsh ≤0.1.3 injected note context as `user/message` events with
 * `source: { kind: 'md-notes', path }`, and the V0→V3 session-log migration
 * whitelists `source.kind` — `md-notes` is not on the list, so the WHOLE log
 * is rejected. New plugin versions write the official `{ kind: 'plugin',
 * plugin: 'md-notes', path }` form; this sweep rewrites the legacy form in
 * old logs to the same official shape.
 *
 * Safety: files without a legacy source are left byte-untouched; every
 * rewritten file is backed up beside the original (`…jsonl.zstd.dsh-md-notes-repair.bak`)
 * and replaced atomically (temp file + rename); repacked frames are complete,
 * checksummed Zstandard frames over complete JSONL lines — the exact shape
 * dsh's reader consumes (`session-persistence-jsonl/src/zstd.ts`). The
 * `stillBlocked` report lists OTHER source kinds the migration may still
 * refuse (dsh's own legacy kinds, e.g. `fallback`/`provider`) — those are
 * upstream's to fix, not ours to rewrite.
 * @module dsh-md-notes/sessions-repair
 */

import { copyFile, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { constants as zc, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import type { SessionRepairReport } from '../contract.ts'

/** Frame options mirroring dsh's writer (checksummed, independently decodable). */
const FRAME_OPTIONS = { params: { [zc.ZSTD_c_checksumFlag]: 1 } }

/**
 * Mirror of dsh's V2→V3 migration source-kind whitelist
 * (`session-format-v2-to-v3` `SOURCE_KINDS`) — used ONLY to warn which OTHER
 * legacy kinds a repaired log may still be refused over. Drift here affects
 * the warning's accuracy, never the repair itself.
 */
const MIGRATION_SOURCE_KINDS = new Set([
  'user', 'plugin', 'model', 'tool', 'agent-instructions', 'session-reference', 'team-message',
  'goal', 'skill-invocation', 'skill-catalog', 'coordinator', 'subagent-report', 'subagent-settled',
  'webhook', 'agent-message',
])

/** The sessions root, mirroring `resolveDshHome` (DSH_HOME override → `~/.dsh`). */
export function dshSessionsRoot(env: Record<string, string | undefined> = process.env): string {
  const home = env.DSH_HOME !== undefined && env.DSH_HOME.trim().length > 0 ? env.DSH_HOME : join(homedir(), '.dsh')
  return resolve(home, 'sessions')
}

/**
 * Decompress a concatenated-Zstandard-frames session log. Node reports no
 * consumed-length, so frames are located by scanning for the magic and each
 * candidate is decompressed with retry-extension to the next boundary — the
 * same walk validated against real logs (116 frames / 236 records).
 */
export function decompressFrames(buf: Buffer): string {
  const offsets: number[] = []
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf[i] === 0x28 && buf[i + 1] === 0xb5 && buf[i + 2] === 0x2f && buf[i + 3] === 0xfd) offsets.push(i)
  }
  const chunks: string[] = []
  let oi = 0
  while (oi < offsets.length) {
    let placed = false
    for (let end = oi + 1; end <= offsets.length; end += 1) {
      const stop = end < offsets.length ? offsets[end] : buf.length
      try {
        chunks.push(zstdDecompressSync(buf.subarray(offsets[oi], stop)).toString('utf8'))
        oi = end
        placed = true
        break
      } catch {
        /* a magic seen mid-frame: extend to the next boundary and retry */
      }
    }
    if (!placed) throw new Error('unparseable zstd frame')
    // `placed` frames always advance `oi`; the loop cannot spin.
  }
  return chunks.join('')
}

/** Recursively rewrite `{ source: { kind: 'md-notes', … } }` to the official plugin form. */
function rewriteSources(value: unknown, tally: { count: number }): unknown {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) value[i] = rewriteSources(value[i], tally)
    return value
  }
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const source = record.source
  if (source !== null && typeof source === 'object' && (source as Record<string, unknown>).kind === 'md-notes') {
    const { kind: _kind, ...rest } = source as Record<string, unknown>
    record.source = { kind: 'plugin', plugin: 'md-notes', ...rest }
    tally.count += 1
  }
  for (const key of Object.keys(record)) {
    if (key !== 'source') record[key] = rewriteSources(record[key], tally)
  }
  return record
}

/**
 * Rewrite one log's JSONL text. Only lines that actually change are
 * re-serialized (JSON.stringify is compact, matching dsh's writer); untouched
 * lines keep their exact bytes.
 * @returns the new text and the number of source objects rewritten.
 */
export function rewriteLogText(text: string): { text: string; count: number } {
  const lines = text.split('\n')
  let count = 0
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line === undefined || line === '' || !line.includes('"md-notes"')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const tally = { count: 0 }
    rewriteSources(parsed, tally)
    if (tally.count > 0) {
      lines[i] = JSON.stringify(parsed)
      count += tally.count
    }
  }
  return { text: lines.join('\n'), count }
}

/** Source kinds present in a log's message-bearing events (post-rewrite check). */
function sourceKinds(text: string): Set<string> {
  const kinds = new Set<string>()
  for (const line of text.split('\n')) {
    if (line === '' || !line.includes('"source"')) continue
    try {
      collectKinds(JSON.parse(line), kinds)
    } catch {
      /* keep the header line and any oddity out of the tally */
    }
  }
  return kinds
}

function collectKinds(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKinds(item, out)
    return
  }
  if (value === null || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  const source = record.source
  if (source !== null && typeof source === 'object' && typeof (source as Record<string, unknown>).kind === 'string') {
    out.add((source as Record<string, unknown>).kind as string)
  }
  for (const key of Object.keys(record)) {
    if (key !== 'source') collectKinds(record[key], out)
  }
}

/** Repack log text as dsh-shaped frames: header line alone, then every event line. */
function repack(text: string): Buffer {
  const cut = text.indexOf('\n')
  const header = cut === -1 ? text : text.slice(0, cut)
  const rest = cut === -1 ? '' : text.slice(cut + 1)
  const headerFrame = zstdCompressSync(`${header}\n`, FRAME_OPTIONS)
  if (rest.trim() === '') return Buffer.concat([headerFrame])
  return Buffer.concat([headerFrame, zstdCompressSync(rest, FRAME_OPTIONS)])
}

/** Session log artifact files (current + older generations). */
function isSessionLog(name: string): boolean {
  return /^session(\.\w+)?\.jsonl\.zstd$/.test(name)
}

/** Rewrite one file if it carries legacy sources; returns how many sources were rewritten. */
async function repairFile(file: string): Promise<number> {
  const text = decompressFrames(await readFile(file))
  const rewritten = rewriteLogText(text)
  if (rewritten.count === 0) return 0
  await copyFile(file, `${file}.dsh-md-notes-repair.bak`)
  const tmp = `${file}.tmp-repair`
  await writeFile(tmp, repack(rewritten.text))
  await rename(tmp, file)
  return rewritten.count
}

/**
 * Sweep the sessions root and repair every affected log.
 * @param root - the dsh sessions directory (`dshSessionsRoot()`).
 * @returns the report shown by the settings action.
 */
export async function scanAndRepairSessions(root: string): Promise<SessionRepairReport> {
  const report: SessionRepairReport = { scanned: 0, repaired: 0, events: 0, failed: 0, stillBlocked: [] }
  const blocked = new Set<string>()
  let projects: string[] = []
  try {
    projects = await readdir(root, { withFileTypes: true })
      .then(entries => entries.filter(e => e.isDirectory()).map(e => e.name))
  } catch {
    return report // no sessions root yet — nothing to scan
  }
  for (const project of projects) {
    let sessions: string[] = []
    try {
      sessions = await readdir(join(root, project), { withFileTypes: true })
        .then(entries => entries.filter(e => e.isDirectory()).map(e => e.name))
    } catch {
      continue
    }
    for (const session of sessions) {
      let files: string[] = []
      try {
        files = (await readdir(join(root, project, session))).filter(isSessionLog)
      } catch {
        continue
      }
      for (const name of files) {
        const file = join(root, project, session, name)
        report.scanned += 1
        try {
          const before = await readFile(file)
          const fixed = await repairFile(file)
          if (fixed > 0) {
            report.repaired += 1
            report.events += fixed
            for (const kind of sourceKinds(decompressFrames(await readFile(file)))) {
              if (!MIGRATION_SOURCE_KINDS.has(kind)) blocked.add(kind)
            }
          } else {
            void before
          }
        } catch {
          report.failed += 1
        }
      }
    }
  }
  report.stillBlocked = [...blocked].sort()
  return report
}

/** Basename export for tests. */
export const repairBackupName = (file: string): string => `${file}.dsh-md-notes-repair.bak`
