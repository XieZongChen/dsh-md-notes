/**
 * Shared display helpers. Markdown rendering was replaced by dsh's
 * `MarkdownText` (GFM + TeX math + Shiki highlighting + built-in safety) —
 * see the notes-manager preview. This module only keeps the small timestamp
 * formatter used by the note list.
 * @module dsh-md-notes/client/markdown
 */

/** Format a Unix-epoch-ms timestamp for display. */
export function fmtTime(ts: number | undefined): string {
  return ts ? new Date(ts).toLocaleString() : ''
}
