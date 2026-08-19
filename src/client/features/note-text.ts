/**
 * Capture the question + answer text for one assistant message from the
 * client-side conversation snapshot. The text already lives in the browser
 * (same source the copy button reads), so the note append sends it to the
 * host instead of the host re-reading the whole session log
 * (`sessionQuery.readSession` was the previous path — heavy on long sessions
 * and blocked the event loop, freezing the manager's list/read requests).
 * @module dsh-md-notes/client/note-text
 */

import type { AssistantBlock, ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'

/** The captured texts for one note append. */
export interface CapturedMessageText {
  /** The assistant answer (final answer only, reasoning skipped). */
  answerText: string
  /** The most recent user question preceding this answer. */
  questionText: string
}

/**
 * Text of assistant blocks: visible text only — reasoning (Think) is skipped,
 * images collapse to the placeholder, tool calls are dropped (matches the
 * host's previous `blocksToText` semantics).
 */
function assistantBlocksText(blocks: readonly AssistantBlock[] | undefined, imageLabel: string): string {
  const parts: string[] = []
  for (const b of blocks ?? []) {
    if (b.kind === 'text') parts.push(b.text)
    else if (b.kind === 'image') parts.push(imageLabel)
    // reasoning / tool-call / other → skipped
  }
  return parts.join('\n\n').trim()
}

/**
 * Locate one assistant message by its stable `messageId` in the snapshot's
 * legacy node list, and capture its answer plus the nearest preceding user
 * question. Returns null when the message is not materialized yet.
 */
export function captureMessageText(
  nodes: readonly ConversationNode[],
  messageId: string,
  imageLabel = '[image]',
): CapturedMessageText | null {
  let answerText = ''
  let questionText = ''
  let found = false
  for (const node of nodes) {
    if (node.kind === 'user') {
      // Remember the latest user question seen so far — the one before the
      // target assistant message is what we want.
      questionText = nodeText(node.content, imageLabel)
      continue
    }
    if (node.kind === 'assistant' && node.messageId === messageId) {
      answerText = assistantBlocksText(node.blocks, imageLabel)
      found = true
      break
    }
  }
  return found ? { answerText, questionText } : null
}

/** Text of a user message's content blocks (text + image placeholder). */
function nodeText(content: readonly { type?: string; text?: string }[] | undefined, imageLabel: string): string {
  const parts: string[] = []
  for (const b of content ?? []) {
    if (b === null || typeof b !== 'object') continue
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    else if (b.type === 'image') parts.push(imageLabel)
  }
  return parts.join('\n\n').trim()
}
