/**
 * Pasted-image helpers for the notes editor (TODO §3.6): pick image files out
 * of a clipboard / drop payload, encode them as base64, store them through the
 * host `saveAsset` API, and splice the resulting markdown references into the
 * note text at the caret.
 *
 * Everything DOM-shaped stays structural ({ type, getAsFile }) and every offset
 * is passed in by the caller, so the module is importable from the Node test
 * environment — the only browser-bound step, `Blob.arrayBuffer()`, is also
 * provided by Node. Preview needs no work here: the manager already routes
 * local destinations through `path-images.ts` → `MarkdownText`, so a stored
 * `assets/<name>` renders (and gets the lightbox) as soon as it is inserted.
 * @module dsh-md-notes/client/assets
 */

import { api } from './api.ts'

/**
 * Extension the host accepts for one clipboard MIME type; `undefined` means
 * "not a supported image" (the entry is left to the browser's default paste).
 * SVG is deliberately absent — the host refuses it too, since its markup is
 * not a fixed signature and the preview has no reason to render it inline.
 */
export function extForMime(mime: string): string | undefined {
  switch (mime.trim().toLowerCase()) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/gif': return 'gif'
    case 'image/webp': return 'webp'
    case 'image/bmp': return 'bmp'
    case 'image/avif': return 'avif'
    default: return undefined
  }
}

/** The minimal clipboard / drop entry shape this module reads (structural: testable without a DOM). */
export interface ImageEntry {
  /** `'file'` for clipboard and drop items; `undefined` is tolerated as file-like. */
  readonly kind?: string
  readonly type: string
  getAsFile(): File | null
}

/**
 * The supported image files among a clipboard / drop payload, in payload
 * order. Non-file entries (pasted text, drags of selections) and unsupported
 * image types are dropped, so the caller can treat "empty result" as "not an
 * image paste" and let the default behavior run.
 */
export function imageFilesFrom(entries: readonly ImageEntry[]): File[] {
  const files: File[] = []
  for (const entry of entries) {
    if (entry.kind !== undefined && entry.kind !== 'file') continue
    if (extForMime(entry.type) === undefined) continue
    const file = entry.getAsFile()
    if (file !== null) files.push(file)
  }
  return files
}

/**
 * Standard base64 of a byte array. Chunked `String.fromCharCode` (not
 * `String.fromCharCode(...bytes)`) so a multi-megabyte image cannot blow the
 * argument-count limit. `btoa` is a browser global and also present in Node.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Read one image blob as the bare base64 the host `saveAsset` takes. */
export async function readImageBase64(file: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await file.arrayBuffer()))
}

/** The `saveAsset` outcome, narrowed to what the editor branches on. */
export type StoreImagesResult =
  | { ok: true; paths: string[] }
  | { ok: false; code: string }

/**
 * Store every supported image file through the host, in order. A refusal stops
 * the batch: the caller reports the code instead of inserting a partial set of
 * references, so the note never points at an image that was not written.
 * @param files - image files from the clipboard / drop payload.
 * @param workspaceId - the note's workspace (its notes dir receives `assets/`).
 * @returns the markdown-relative paths, or the host's refusal code.
 */
export async function storeImages(files: readonly File[], workspaceId: string): Promise<StoreImagesResult> {
  const paths: string[] = []
  for (const file of files) {
    const ext = extForMime(file.type)
    if (ext === undefined) continue
    const data = await readImageBase64(file)
    const res = await api('saveAsset', { data, ext, workspaceId })
    if (!res.ok) return { ok: false, code: res.code ?? 'asset-write' }
    if (res.path === undefined) return { ok: false, code: 'asset-write' }
    paths.push(res.path)
  }
  return { ok: true, paths }
}

/**
 * Splice image references into the note text at a caret / selection. The block
 * is kept on its own paragraph (a blank line is added before it when the caret
 * sits mid-line) so a pasted screenshot never glues onto surrounding prose;
 * any selected text is replaced. References are inserted as authored — the host
 * generates them from a fixed alphabet, so no escaping is needed.
 * @param text - the current note source.
 * @param start - selection start (caret index).
 * @param end - selection end.
 * @param paths - notes-dir-relative image paths (`assets/<name>`).
 * @returns the new text and the caret offset after the inserted block.
 */
export function insertImageRefs(
  text: string,
  start: number,
  end: number,
  paths: readonly string[],
): { text: string; caret: number } {
  if (paths.length === 0) return { text, caret: start }
  const before = text.slice(0, start)
  const after = text.slice(end)
  const block = paths.map((path) => `![](${path})`).join('\n')
  const lead = before === '' || before.endsWith('\n') ? '' : '\n\n'
  const trail = after === '' || after.startsWith('\n') ? '' : '\n'
  const inserted = lead + block + trail
  return { text: before + inserted + after, caret: start + inserted.length }
}

/** Locale key for one `saveAsset` refusal code (all live in the manager namespace). */
export function assetErrorKey(
  code: string,
): 'manager.imageTooLarge' | 'manager.imageType' | 'manager.imageFailed' {
  if (code === 'asset-too-large') return 'manager.imageTooLarge'
  if (code === 'asset-type' || code === 'asset-empty') return 'manager.imageType'
  return 'manager.imageFailed'
}
