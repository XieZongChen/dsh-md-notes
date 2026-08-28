import { describe, expect, it } from 'vitest'
import type { AssistantBlock, ConversationNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { captureMessageText } from './note-text.ts'

const textBlock = (text: string): AssistantBlock => ({ kind: 'text', text }) as AssistantBlock
const reasoningBlock = (text: string): AssistantBlock => ({ kind: 'reasoning', text }) as AssistantBlock
const userNode = (text: string): ConversationNode =>
  ({ kind: 'user', content: [{ type: 'text', text }] }) as unknown as ConversationNode
const assistantNode = (messageId: string, blocks: AssistantBlock[]): ConversationNode =>
  ({ kind: 'assistant', messageId, blocks }) as unknown as ConversationNode

describe('captureMessageText', () => {
  it('captures the answer and the nearest preceding user question', () => {
    const nodes = [
      userNode('Q1'),
      assistantNode('m1', [textBlock('A1')]),
      userNode('Q2'),
      assistantNode('m2', [textBlock('A2')]),
    ]
    expect(captureMessageText(nodes, 'm2')).toEqual({ answerText: 'A2', questionText: 'Q2' })
  })

  it('skips reasoning and keeps only visible text', () => {
    const nodes = [
      userNode('Q'),
      assistantNode('m', [reasoningBlock('think'), textBlock('visible')]),
    ]
    expect(captureMessageText(nodes, 'm')).toEqual({ answerText: 'visible', questionText: 'Q' })
  })

  it('returns null when the message is not materialized', () => {
    expect(captureMessageText([userNode('Q')], 'missing')).toBeNull()
  })
})
