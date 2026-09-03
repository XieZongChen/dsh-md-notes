/**
 * Pure POSIX path helpers for note references (no node:path — this is the
 * browser bundle). Extracted from ContextSource.ts so the reference-path
 * math is unit-tested directly.
 * @module dsh-md-notes/client/ContextSource/paths
 */

import type { NoteSummary, WorkspaceNotes } from '../api.ts'

/**
 * POSIX relative path from one absolute directory to an absolute target.
 * Same-dir targets yield `.dsh-notes/<name>`-style paths; siblings yield
 * `../<dir>/…`.
 */
export function relFrom(fromDir: string, target: string): string {
  const f = fromDir.split('/').filter(Boolean)
  const t = target.split('/').filter(Boolean)
  let i = 0
  while (i < f.length && i < t.length && f[i] === t[i]) i++
  const ups = f.length - i
  const down = t.slice(i).join('/')
  return ups === 0 ? down : `${'../'.repeat(ups)}${down}`
}

/**
 * Canonicalize a POSIX path (collapse `.` / `..` segments) for exact compares.
 * Returns null when `..` escapes above the root — such a path is invalid, not
 * a real location (an out-of-range `..` must never be silently dropped and
 * then accidentally match).
 */
export function canon(p: string): string | null {
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length === 0) return null
      out.pop()
    } else out.push(seg)
  }
  return out.length === 0 ? '/' : `/${out.join('/')}`
}

/** Strip the last segment of an absolute dir (e.g. `<ws>/.dsh-notes` → `<ws>`). */
export function parentDir(dir: string): string {
  return dir.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '')
}

/** Absolute path of one note (the target for the session-relative path). */
export function refPath(ws: WorkspaceNotes, note: NoteSummary): string {
  return ws.notesDir.endsWith('/') ? ws.notesDir + note.name : `${ws.notesDir}/${note.name}`
}

/**
 * Chip display label. dsh renders the chip label inside a fixed 4em cell
 * (the U+FFFC advance) centered with overflow hidden — a too-long label
 * clips BOTH ends showing an unreadable middle slice. Front-truncate so the
 * chip always shows the note's beginning (+ '…' as a truncation marker).
 * 4 + '…' fits the ~48px window for Latin and keeps CJK front-visible.
 */
export function chipLabel(title: string): string {
  return title.length > 4 ? `${title.slice(0, 4)}…` : title
}
