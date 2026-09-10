/**
 * Capture extras for "capture into note": produced-file paths collected from
 * one assistant message's blocks. Produced
 * paths replicate dsh's own deliverables derivation
 * (`ui-deliverables/turn-deliverables.ts` `mutationPath`): successful-looking
 * `write` / `edit` / mutating `str_replace_editor` calls contribute the path
 * they name — a produced file must be listed whether or not the prose mentions
 * it. Block-level tool-call arms carry no settlement status, so a failed write
 * can yield a dead link (rare; the card filters by result status).
 * @module dsh-md-notes/client/capture-extras
 */

import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** The mutation path named by one tool call, or null when not a file mutation. */
export function mutationPathOf(name: string, argsRaw: string): string | null {
  let args: unknown
  try {
    args = JSON.parse(argsRaw) as unknown
  } catch {
    return null
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null
  const a = args as Record<string, unknown>
  const path = typeof a.file_path === 'string' && a.file_path.trim().length > 0
    ? a.file_path
    : typeof a.path === 'string' && a.path.trim().length > 0 ? a.path : null
  if (path === null) return null
  switch (name) {
    case 'write':
      return typeof a.content === 'string' ? path : null
    case 'edit':
      return typeof a.old_string === 'string' && a.old_string.length > 0
        && typeof a.new_string === 'string' && a.old_string !== a.new_string
        ? path
        : null
    case 'str_replace_editor':
      switch (a.command) {
        case 'create':
          return typeof a.file_text === 'string' ? path : null
        case 'str_replace':
          return typeof a.old_str === 'string' && a.old_str.length > 0 ? path : null
        case 'insert':
          return typeof a.insert_line === 'number' && typeof a.new_str === 'string' ? path : null
        default:
          return null
      }
    default:
      return null
  }
}


/** Produced-file paths of one assistant message, first-seen order, deduped. */
export function producedPathsOf(blocks: readonly AssistantBlock[] | undefined): string[] {
  const paths: string[] = []
  const seen = new Set<string>()
  for (const block of blocks ?? []) {
    if (block.kind !== 'tool-call') continue
    const path = mutationPathOf(block.name, block.argsRaw)
    if (path === null || seen.has(path)) continue
    seen.add(path)
    paths.push(path)
  }
  return paths
}

