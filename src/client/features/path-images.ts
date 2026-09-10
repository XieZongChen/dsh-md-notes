/**
 * Local-image rewriting for note previews (`MarkdownText.pathImages`,
 * dsh 0.1.5+): an authored image destination that names a LOCAL file maps to
 * the same-origin authenticated file route — the exact vocabulary dsh's own
 * chat uses (`AssistantMarkdown.localPathMediaUrl` → `/api/file?path=…`,
 * served by `session-controller/media-references` behind the connection
 * fence; the sandbox's read policy applies server-side).
 *
 * Destinations resolve against the NOTE'S OWN directory (its workspace's
 * `.dsh-notes` dir), so `img.png` sits beside the note, `../shot.png` reaches
 * the workspace root, and an authored absolute path is used as written.
 * Non-HTTP transports (Electron `file://`) get no rewrite — the renderer's
 * documented alt-text fallback applies, same as the chat.
 * @module dsh-md-notes/client/path-images
 */

import type { MarkdownPathImages } from '@deepseek-ai/dsh-client-ui-primitives'
import { resolvePosix } from './NoteViewer/address.ts'


/** Destinations carrying a scheme (`data:`, `C:/` drive letters…) are never rewrites. */
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/**
 * Build the path-images vocabulary for one note's directory.
 * @param protocol - `window.location.protocol` at render time.
 * @param origin - `window.location.origin` at render time.
 * @param notesDir - the note's absolute `.dsh-notes` dir (OS-native separators
 * are normalized here).
 * @returns the resolver handed to `MarkdownText`.
 */
export function createNotePathImages(
  protocol: string,
  origin: string,
  notesDir: string,
): MarkdownPathImages {
  return {
    resolve: (value) => {
      if (protocol !== 'http:' && protocol !== 'https:') return undefined
      // Empty, protocol-relative, and scheme-carrying destinations are never
      // Host-served local files — leave them to the alt-text fallback.
      if (value.length === 0 || value.startsWith('//') || SCHEME_RE.test(value)) return undefined
      const base = notesDir.replace(/\\/g, '/')
      const resolved = value.startsWith('/') ? resolvePosix('', value) : resolvePosix(base, value)
      // A Windows drive base (`C:/…`) keeps its drive prefix, no leading `/`.
      const absolute = /^[A-Za-z]:/.test(base) ? resolved.slice(1) : resolved
      return `${origin}/api/file?path=${encodeURIComponent(absolute)}`
    },
  }
}
