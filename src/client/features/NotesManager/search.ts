/**
 * Pure client helpers for the manager search (docs/search.md §5–§6): hit
 * highlight segmentation and the edit-mode locate math (absolute selection
 * offsets + scroll position). No React, no DOM access — unit-tested in Node
 * alongside the other pure feature modules.
 * @module dsh-md-notes/client/NotesManager/search
 */

/** One renderable slice of a hit line: marked (a token) or plain text. */
export interface HighlightSegment {
  text: string
  mark: boolean
}

/**
 * Split a hit line into plain/marked segments by its host-computed ranges.
 * The host guarantees sorted non-overlapping ranges; every bound is clamped
 * anyway so a malformed payload can never slice out of the text.
 */
export function highlightSegments(
  text: string,
  ranges: ReadonlyArray<{ start: number; end: number }>,
): HighlightSegment[] {
  const segments: HighlightSegment[] = []
  let cursor = 0
  for (const range of ranges) {
    const start = Math.max(cursor, Math.min(range.start, text.length))
    const end = Math.max(start, Math.min(range.end, text.length))
    if (start > cursor) segments.push({ text: text.slice(cursor, start), mark: false })
    if (end > start) segments.push({ text: text.slice(start, end), mark: true })
    cursor = end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), mark: false })
  return segments
}

/** Where to reveal a hit in the editor (docs/search.md §6.2). */
export interface LocateTarget {
  /** 1-based source line over the EOL-normalized content. */
  line: number
  /** Optional line-relative selection range (the matched token). */
  start?: number
  end?: number
}

/** Clamp a number into [min, max] (NaN collapses to min). */
function clamp(value: number, min: number, max: number): number {
  const v = Number.isFinite(value) ? value : min
  return Math.max(min, Math.min(v, max))
}

/**
 * Absolute textarea offsets for a locate target against the LOADED content.
 * The content is re-split here rather than trusting host offsets — the host
 * truncates line text and browsers normalize the textarea value to `\n`, so
 * the client owns the mapping from line numbers to absolute positions.
 * Out-of-range lines (the note shrank after the search) clamp to the last
 * line; out-of-range selection offsets clamp into that line.
 */
export function locateOffsets(content: string, target: LocateTarget): { start: number; end: number } {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const line = clamp(Math.floor(target.line), 1, lines.length)
  let lineStart = 0
  for (let i = 0; i < line - 1; i++) {
    const l = lines[i]
    lineStart += (l === undefined ? 0 : l.length) + 1
  }
  const lineText = lines[line - 1] ?? ''
  const start = target.start === undefined ? lineStart : lineStart + clamp(target.start, 0, lineText.length)
  const end = target.end === undefined ? start : lineStart + clamp(target.end, 0, lineText.length)
  return { start, end: Math.max(start, end) }
}

/**
 * Scroll position that brings the hit line to the middle of the textarea's
 * viewport. Pure math over metrics the caller reads from the live element —
 * `lineHeight`/`paddingTop` come from `getComputedStyle` (the stylesheet pins
 * `font: 13px/1.6`, so lineHeight is a fixed number, never `normal`).
 */
export function locateScrollTop(line: number, lineHeight: number, viewportHeight: number, paddingTop: number): number {
  const target = (clamp(Math.floor(line), 1, Number.MAX_SAFE_INTEGER) - 1) * lineHeight
    + paddingTop - viewportHeight / 2 + lineHeight / 2
  return Math.max(0, target)
}
