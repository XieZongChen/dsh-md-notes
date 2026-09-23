/**
 * Local-image rewriting for note previews (`MarkdownText.pathImages` plus the
 * `MarkdownDelegateProvider` `fileImages` face, dsh 0.1.5+/0.1.7+): an
 * authored image destination that names a LOCAL file maps to the same-origin
 * authenticated file route — the exact vocabulary dsh's own chat uses
 * (`AssistantMarkdown.localPathMediaUrl` → `/api/file?path=…`, served by
 * `session-controller/media-references` behind the connection fence; the
 * sandbox's read policy applies server-side).
 *
 * Destinations resolve against the NOTE'S OWN directory (its workspace's
 * `.dsh-notes` dir), so `img.png` sits beside the note, `../shot.png` reaches
 * the workspace root, and an authored absolute path is used as written.
 * Non-HTTP transports (Electron `file://`) get no rewrite — the renderer's
 * documented alt-text fallback applies, same as the chat.
 *
 * The delegate face additionally unlocks dsh 0.1.7's image chrome (contained
 * `ImagePreview`, click-to-open `ImageLightbox`, failure labels): its
 * `resolve` receives decoded local paths where the `pathImages` vocabulary
 * receives authored destinations, so both share one URL builder.
 * @module dsh-md-notes/client/path-images
 */

import type { MarkdownPathImages } from '@deepseek-ai/dsh-client-ui-primitives'
import { resolvePosix } from './NoteViewer/address.ts'


/** Destinations carrying a scheme (`data:`, `C:/` drive letters…) are never rewrites. */
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/** Resolve one local image path against the note's directory, or undefined for non-local values. */
function localImageUrl(
  protocol: string,
  origin: string,
  notesDir: string,
  value: string,
): string | undefined {
  if (protocol !== 'http:' && protocol !== 'https:') return undefined
  // Empty, protocol-relative, and scheme-carrying destinations are never
  // Host-served local files — leave them to the alt-text fallback.
  if (value.length === 0 || value.startsWith('//') || SCHEME_RE.test(value)) return undefined
  const base = notesDir.replace(/\\/g, '/')
  const resolved = value.startsWith('/') ? resolvePosix('', value) : resolvePosix(base, value)
  // A Windows drive base (`C:/…`) keeps its drive prefix, no leading `/`.
  const absolute = /^[A-Za-z]:/.test(base) ? resolved.slice(1) : resolved
  return `${origin}/api/file?path=${encodeURIComponent(absolute)}`
}

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
    resolve: (value) => localImageUrl(protocol, origin, notesDir, value),
  }
}

/**
 * Labels the `MarkdownDelegateProvider` `fileImages` face needs: the image
 * chrome (`ImageLightbox` dialog naming, open/loading/failed affordances).
 */
export interface NoteFileImageLabels {
  dialog: string
  close: string
  open: string
  loading: string
  failed: string
}

/**
 * Build the delegate `fileImages` face for one note's directory — the same
 * URL vocabulary as {@link createNotePathImages}, plus the labels that unlock
 * dsh 0.1.7's contained preview, lightbox, and failure text.
 * @param protocol - `window.location.protocol` at render time.
 * @param origin - `window.location.origin` at render time.
 * @param notesDir - the note's absolute `.dsh-notes` dir.
 * @param labels - localized image chrome strings.
 * @returns the `fileImages` value for `MarkdownDelegateProvider`.
 */
export function createNoteFileImages(
  protocol: string,
  origin: string,
  notesDir: string,
  labels: NoteFileImageLabels,
): { resolve: (path: string) => string | undefined; labels: NoteFileImageLabels } {
  return {
    resolve: (path) => localImageUrl(protocol, origin, notesDir, path),
    labels,
  }
}
