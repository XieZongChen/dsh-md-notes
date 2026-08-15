/**
 * Tiny markdown renderer: escapes HTML first, then renders a safe subset
 * (headings, lists, blockquotes, fenced code, inline code/bold/italic/links).
 * Pure function; no React dependency.
 * @module dsh-md-notes/client/markdown
 */

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inlineMd(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}

/** Render markdown source to an HTML string (safe, escaped). */
export function renderMd(src: string): string {
  const lines = String(src ?? '').split('\n')
  const out: string[] = []
  let inCode = false
  let codeBuf: string[] = []
  let inList = false
  const flushList = (): void => { if (inList) { out.push('</ul>'); inList = false } }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (/^```/.test(line)) {
      flushList()
      if (inCode) { out.push(`<pre>${escapeHtml(codeBuf.join('\n'))}</pre>`); codeBuf = []; inCode = false }
      else inCode = true
      continue
    }
    if (inCode) { codeBuf.push(line); continue }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) { flushList(); out.push(`<h${h[1]!.length}>${inlineMd(h[2]!)}</h${h[1]!.length}>`); continue }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushList(); out.push('<hr/>'); continue }
    const li = line.match(/^\s*[-*+]\s+(.*)$/)
    if (li) { if (!inList) { out.push('<ul>'); inList = true } out.push(`<li>${inlineMd(li[1]!)}</li>`); continue }
    const bq = line.match(/^>\s?(.*)$/)
    if (bq) { flushList(); out.push(`<blockquote>${inlineMd(bq[1]!)}</blockquote>`); continue }
    flushList()
    if (line.trim() === '') continue
    out.push(`<p>${inlineMd(line)}</p>`)
  }
  flushList()
  if (inCode) out.push(`<pre>${escapeHtml(codeBuf.join('\n'))}</pre>`)
  return out.join('\n')
}

/** Format a Unix-epoch-ms timestamp for display. */
export function fmtTime(ts: number | undefined): string {
  return ts ? new Date(ts).toLocaleString() : ''
}
