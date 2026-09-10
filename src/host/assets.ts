/**
 * In-place asset serving for "capture into note" — ZERO COPY by design.
 *
 * Image blocks of an assistant message carry attachment-store references; the
 * bytes stay where they are (dsh's attachment store under the harness home)
 * and the note references them through the plugin's own authenticated route:
 * `/plugins/md-notes/asset?<ref-params>`. The URL carries the DURABLE
 * reference itself (id, media type, byte length, pixel size) because the
 * store's read API validates the full reference (sha256 + metadata) — a
 * bare-id read is refused. The host reconstructs the reference, reads the
 * bytes in place, and streams them to the `<img>`.
 *
 * Consequences (deliberate): no files are written anywhere; no machine paths
 * appear in note content (the URL is a same-origin path); and images live
 * only where the attachment store holds them — a git-synced note carries the
 * reference, the bytes stay local to the machine that captured them.
 *
 * Structural store face: no type import from the attachment package, matching
 * the other `*Like` faces in `index.ts`.
 * @module dsh-md-notes/assets
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CapturedImage } from '../contract.ts'

/** The asset route's path under the fixed API prefix (`/plugins/md-notes`). */
export const ASSET_PATH = '/plugins/md-notes/asset'

/** Structural face of the attachment store (the `attachments` service). */
export interface AttachmentsLike {
  readImage(ref: unknown): Promise<{ data: Uint8Array; ref: unknown }>
}

/** The reference fields the store validates — all must ride the URL. */
interface RefParams {
  readonly id: string
  readonly mt: string
  readonly b: number
  readonly w: number
  readonly h: number
}

const SAFE_ID = /^[A-Za-z0-9._-]{1,80}$/

/**
 * The note-embedded URL for one captured image: same-origin path + the full
 * durable reference as query params (id / media type / bytes / pixel size).
 * Markdown-safe by construction (no spaces or parens).
 */
export function assetUrlOf(image: CapturedImage): string | undefined {
  const { attachmentId, mediaType, bytes, width, height } = image as Record<string, unknown>
  if (typeof attachmentId !== 'string' || !SAFE_ID.test(attachmentId)) return undefined
  if (typeof mediaType !== 'string' || !/^image\/[a-z0-9.+-]+$/.test(mediaType)) return undefined
  for (const n of [bytes, width, height]) {
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) return undefined
  }
  const q = `id=${encodeURIComponent(attachmentId)}&mt=${encodeURIComponent(mediaType)}&b=${bytes}&w=${width}&h=${height}`
  return `${ASSET_PATH}?${q}`
}

/** Parse the reference params back out of one asset request's URL. */
export function refParamsOf(url: string): RefParams | undefined {
  const query = url.slice(url.indexOf('?') + 1)
  const params = new URLSearchParams(query)
  const id = params.get('id') ?? ''
  const mt = params.get('mt') ?? ''
  const b = Number(params.get('b'))
  const w = Number(params.get('w'))
  const h = Number(params.get('h'))
  if (!SAFE_ID.test(id) || !/^image\/[a-z0-9.+-]+$/.test(mt)) return undefined
  if (![b, w, h].every(n => Number.isSafeInteger(n) && n >= 0)) return undefined
  return { id, mt, b, w, h }
}

/** 404/500 helpers keep responses tiny; the route is an image endpoint. */
function fail(res: ServerResponse, status: number): void {
  res.writeHead(status)
  res.end()
}

/**
 * The GET handler for the asset route (registered under the API prefix by
 * `index.ts`, behind the same connection trust fence as every other route).
 * @param getStore - live lookup of the attachment store (optional service).
 * @param authorize - the shared trust fence.
 * @returns a node:http handler answering GET with image bytes.
 */
export function assetHandler(
  getStore: () => AttachmentsLike | undefined,
  authorize: (req: IncomingMessage) => 401 | 403 | undefined,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const rejection = authorize(req)
    if (rejection !== undefined) { fail(res, rejection); return }
    if (req.method !== 'GET' && req.method !== 'HEAD') { fail(res, 405); return }
    const params = refParamsOf(req.url ?? '')
    const store = getStore()
    if (params === undefined || store === undefined) { fail(res, 404); return }
    try {
      const stored = await store.readImage({
        attachmentId: params.id, mediaType: params.mt, bytes: params.b, width: params.w, height: params.h,
      })
      res.writeHead(200, {
        'content-type': params.mt,
        'cache-control': 'private, max-age=31536000, immutable',
        'content-length': String(stored.data.byteLength),
      })
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(stored.data))
    } catch {
      // Unknown ref, missing bytes, or integrity mismatch — all just absent.
      fail(res, 404)
    }
  }
}
