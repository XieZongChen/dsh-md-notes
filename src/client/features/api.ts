/**
 * HTTP API client for the dsh-md-notes host route.
 * @module dsh-md-notes/client/api
 */

export interface NoteSummary {
  name: string
  title: string
  updatedAt: number
}

export type ApiResult =
  | { ok: true; notes?: NoteSummary[]; content?: string; name?: string; dir?: string }
  | { ok: false; error: string }

/** Host API route prefix; mirrors the host plugin's default. */
export const API = '/plugins/md-notes'

/** Icon asset URL served by the host GET route (`<prefix>/icon.svg`). */
export const ICON_URL = `${API}/icon.svg`

/**
 * Call one host API method.
 * @param method - endpoint name (list/read/write/create/delete/appendConversation).
 * @param body - endpoint arguments.
 * @returns the parsed result, or a failure branch on transport/HTTP errors.
 */
export async function api(method: string, body: Record<string, unknown> = {}): Promise<ApiResult> {
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, ...body }),
    })
    if (!res.ok) return { ok: false, error: `http ${res.status}` }
    return (await res.json()) as ApiResult
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
