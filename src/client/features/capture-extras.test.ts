/**
 * Tests for the capture-extras derivation: produced-file paths replicate the
 * deliverables mutation semantics (complete mutating calls only, deduped).
 * @module dsh-md-notes/client/capture-extras.test
 */

import { describe, expect, it } from 'vitest'
import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { mutationPathOf, producedPathsOf } from './capture-extras.ts'

const write = (path: string): AssistantBlock =>
  ({ kind: 'tool-call', callId: 'c1', name: 'write', argsRaw: JSON.stringify({ file_path: path, content: 'x' }) })
const editCall = (path: string): AssistantBlock =>
  ({ kind: 'tool-call', callId: 'c2', name: 'edit', argsRaw: JSON.stringify({ file_path: path, old_string: 'a', new_string: 'b' }) })

describe('mutationPathOf', () => {
  it('accepts complete write/edit/mutating editor calls with their path', () => {
    expect(mutationPathOf('write', '{"file_path":"a.png","content":"x"}')).toBe('a.png')
    expect(mutationPathOf('edit', '{"file_path":"a.ts","old_string":"a","new_string":"b"}')).toBe('a.ts')
    expect(mutationPathOf('str_replace_editor', '{"path":"c.md","command":"create","file_text":"hi"}')).toBe('c.md')
    expect(mutationPathOf('str_replace_editor', '{"path":"c.md","command":"insert","insert_line":3,"new_str":"x"}')).toBe('c.md')
  })

  it('refuses incomplete or non-mutating calls', () => {
    expect(mutationPathOf('write', '{"file_path":"a"}')).toBeNull() // no content
    expect(mutationPathOf('edit', '{"file_path":"a","old_string":"","new_string":"b"}')).toBeNull()
    expect(mutationPathOf('str_replace_editor', '{"path":"c","command":"view"}')).toBeNull()
    expect(mutationPathOf('read', '{"file_path":"a"}')).toBeNull()
    expect(mutationPathOf('write', 'not json')).toBeNull()
  })
})

describe('producedPathsOf', () => {
  it('collects first-seen, deduped, skipping non-tool blocks', () => {
    const blocks = [
      { kind: 'text', text: 'hi' } as AssistantBlock,
      write('assets/x.png'),
      write('assets/x.png'),
      editCall('assets/x.png'),
      write('src/y.ts'),
    ]
    expect(producedPathsOf(blocks)).toEqual(['assets/x.png', 'src/y.ts'])
    expect(producedPathsOf(undefined)).toEqual([])
  })
})

