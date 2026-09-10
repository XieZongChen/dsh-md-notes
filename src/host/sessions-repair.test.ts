/**
 * Tests for the legacy-session repair sweep: the source rewrite (official
 * plugin form, nested shapes, untouched kinds), the multi-frame round trip
 * (checksummed frames, header/event shape, byte-stable untouched lines,
 * backup + atomic replace), stillBlocked reporting, and the sessions-root
 * resolution. Real zstd via node:zlib — same as production.
 * @module dsh-md-notes/sessions-repair.test
 */

import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { constants as zc, zstdCompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  dshSessionsRoot, decompressFrames, rewriteLogText, scanAndRepairSessions,
} from './sessions-repair.ts'

const FRAME = { params: { [zc.ZSTD_c_checksumFlag]: 1 } }

const HEADER = JSON.stringify({
  type: 'session', version: 0, id: 'session-x', createdAt: 1,
  cwd: '/base/ws-a', delegationDepth: 0,
})

/** A legacy injected-context event exactly like plugin ≤0.12.0 wrote. */
const mdNotesEvent = (name: string): string => JSON.stringify({
  type: 'user/message', seq: 3, time: 2,
  data: { id: 'm3', role: 'user', content: [{ type: 'text', text: `[笔记内容]\n…` }], source: { kind: 'md-notes', path: `/base/ws-a/.dsh-notes/${name}` } },
  surfaceOp: 'append',
})

const plainEvent = JSON.stringify({
  type: 'user/message', seq: 1, time: 0,
  data: { id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } },
  surfaceOp: 'append',
})

const otherKindEvent = JSON.stringify({
  type: 'assistant/message', seq: 2, time: 1,
  data: { message: { id: 'm2', role: 'assistant', source: { kind: 'fallback' } } },
})

afterEach(async () => {
  if (tmpRoot !== '') { await rm(tmpRoot, { recursive: true, force: true }); tmpRoot = '' }
})
let tmpRoot = ''

async function tempRoot(): Promise<string> {
  tmpRoot = await mkdtemp(join(tmpdir(), 'md-notes-repair-'))
  return tmpRoot
}

/** Write a dsh-shaped log: header frame + event-batch frame. */
async function writeLog(file: string, lines: readonly string[]): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true })
  const body = Buffer.concat([
    zstdCompressSync(`${lines[0]}\n`, FRAME),
    zstdCompressSync(`${lines.slice(1).join('\n')}\n`, FRAME),
  ])
  await writeFile(file, body)
}

describe('dshSessionsRoot', () => {
  it('defaults to ~/.dsh/sessions and honors a non-empty DSH_HOME', () => {
    expect(dshSessionsRoot({})).toBe(join(homedir(), '.dsh', 'sessions'))
    expect(dshSessionsRoot({ DSH_HOME: '/x' })).toBe('/x/sessions')
    expect(dshSessionsRoot({ DSH_HOME: '  ' })).toBe(join(homedir(), '.dsh', 'sessions'))
  })
})

describe('rewriteLogText', () => {
  it('rewrites the legacy source to the official plugin form, keeping path', () => {
    const line = mdNotesEvent('plan.md')
    const { text, count } = rewriteLogText(`${HEADER}\n${line}\n`)
    expect(count).toBe(1)
    const event = JSON.parse(text.split('\n')[1] as string)
    expect(event.data.source).toEqual({ kind: 'plugin', plugin: 'md-notes', path: '/base/ws-a/.dsh-notes/plan.md' })
  })

  it('rewrites sources nested in arrays and other message carriers', () => {
    const nested = JSON.stringify({ type: 'agent/inbox/spliced', seq: 9, time: 9, data: { inserted: [{ id: 'm', role: 'user', source: { kind: 'md-notes', path: '/p' } }] } })
    const { count } = rewriteLogText(`${nested}\n`)
    expect(count).toBe(1)
  })

  it('leaves other kinds and plain lines byte-identical, counts nothing', () => {
    const text = `${HEADER}\n${plainEvent}\n${otherKindEvent}\n`
    const out = rewriteLogText(text)
    expect(out.count).toBe(0)
    expect(out.text).toBe(text)
  })

  it('ignores a line mentioning md-notes only in content text', () => {
    const decoy = JSON.stringify({ type: 'user/message', seq: 5, time: 5, data: { id: 'm5', role: 'user', content: [{ type: 'text', text: 'see md-notes docs' }], source: { kind: 'user' } } })
    expect(rewriteLogText(`${decoy}\n`).count).toBe(0)
  })
})

describe('scanAndRepairSessions', () => {
  it('repairs affected logs with backup + atomic replace, skips clean ones, reports blocked kinds', async () => {
    const root = await tempRoot()
    const affected = join(root, '--proj-a--', 'session-x', 'session.jsonl.zstd')
    const clean = join(root, '--proj-a--', 'session-y', 'session.jsonl.zstd')
    const otherProj = join(root, '--proj-b--', 'session-z', 'session.v2.jsonl.zstd')
    await writeLog(affected, [HEADER, plainEvent, mdNotesEvent('a.md'), otherKindEvent])
    await writeLog(clean, [HEADER, plainEvent])
    await writeLog(otherProj, [HEADER, mdNotesEvent('b.md')])

    const report = await scanAndRepairSessions(root)

    expect(report.scanned).toBe(3)
    expect(report.repaired).toBe(2)
    expect(report.events).toBe(2)
    expect(report.failed).toBe(0)
    // fallback（assistant 消息的其它历史 kind）不在迁移白名单 → 报告
    expect(report.stillBlocked).toEqual(['fallback'])

    const text = decompressFrames(await readFile(affected))
    expect(text.includes('"kind":"md-notes"')).toBe(false)
    expect(text.includes('"kind":"plugin","plugin":"md-notes","path":"/base/ws-a/.dsh-notes/a.md"')).toBe(true)
    // 未受影响的行字节不变（plainEvent 原样保留）
    expect(text.includes(plainEvent)).toBe(true)
    // header 单独成帧、事件行完整
    expect(text.startsWith(`${HEADER}\n`)).toBe(true)
    // 备份存在且为原件
    const backup = await readFile(`${affected}.dsh-md-notes-repair.bak`)
    expect(decompressFrames(backup).includes('"kind":"md-notes"')).toBe(true)
    // 干净文件无备份
    const dirY = await readdir(join(root, '--proj-a--', 'session-y'))
    expect(dirY.some(n => n.includes('repair.bak'))).toBe(false)
  })

  it('returns zeros when the sessions root does not exist', async () => {
    const report = await scanAndRepairSessions(join(await tempRoot(), 'nope'))
    expect(report).toEqual({ scanned: 0, repaired: 0, events: 0, failed: 0, stillBlocked: [] })
  })
})
