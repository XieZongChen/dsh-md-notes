/**
 * dsh-md-notes browser half entry: wires the shared store into the three
 * registered slots (sidebar entry, assistant action, overlay host).
 * Uses React.createElement (no JSX) so this file stays a plain `.ts` entry;
 * feature modules live under `./features/<Name>/`.
 * @module dsh-md-notes/client
 */

import * as React from 'react'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Declaration-merge triggers for slot maps.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { NotesStore } from './features/store.ts'
import { NotesEntry } from './features/NotesEntry/NotesEntry.tsx'
import { NoteAction } from './features/NoteAction/NoteAction.tsx'
import { NotePicker } from './features/NotePicker/NotePicker.tsx'
import { NotesManager } from './features/NotesManager/NotesManager.tsx'

export const inject = ['slots']

/** React hook: re-render on every store change. */
function useStore(store: NotesStore): void {
  const [, setTick] = React.useState(0)
  React.useEffect(() => store.subscribe(() => setTick((t) => t + 1)), [store])
}

/** Overlay host: renders the manager or the picker based on store state. */
function NotesOverlay(props: { store: NotesStore }): React.ReactElement | null {
  useStore(props.store)
  const s = props.store.get()
  if (s.managerOpen) return React.createElement(NotesManager, { store: props.store })
  if (s.picker) {
    return React.createElement(NotePicker, {
      sessionId: s.picker.sessionId,
      messageId: s.picker.messageId,
      store: props.store,
    })
  }
  return null
}

/**
 * Client plugin body: registers the sidebar entry, the notes manager overlay,
 * and the assistant-message note action, all sharing one NotesStore.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const store = new NotesStore()

  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    { name: 'sidebar.footer.action', id: 'dsh-notes-entry', order: 30, label: '笔记' },
    (props: { wide: boolean }) => React.createElement(NotesEntry, { wide: props.wide, store }),
  )), 'dsh-md-notes: sidebar entry')

  ctx.effect(() => ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register(
    { name: 'conversation.chat.assistant-actions', id: 'dsh-notes-save', order: 20, label: '记笔记' },
    (props: { sessionId: SessionId; messageId: string }) => React.createElement(NoteAction, {
      sessionId: String(props.sessionId),
      messageId: props.messageId,
      store,
    }),
  )), 'dsh-md-notes: assistant action')

  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'dsh-notes-overlay', order: 100, label: 'MD 笔记' },
    () => React.createElement(NotesOverlay, { store }),
  )), 'dsh-md-notes: overlay')
}
