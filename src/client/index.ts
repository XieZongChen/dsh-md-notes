/**
 * dsh-md-notes browser half entry: registers the feature's locale namespace,
 * then wires the shared store into the three registered slots (sidebar entry,
 * assistant action, overlay host). Uses React.createElement (no JSX) so this
 * file stays a plain `.ts` entry; feature modules live under
 * `./features/<Name>/`.
 * @module dsh-md-notes/client
 */

import * as React from 'react'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Declaration-merge triggers for slot maps + the ctx.locale service.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-general/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { InputTriggerServiceContract } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NotesStore } from './features/store.ts'
import { en, zh } from './features/locales/index.ts'
import { NotesEntry } from './features/NotesEntry/NotesEntry.tsx'
import { NoteAction } from './features/NoteAction/NoteAction.tsx'
import { NotePicker } from './features/NotePicker/NotePicker.tsx'
import { NotesManager } from './features/NotesManager/NotesManager.tsx'
import { SettingsSection } from './features/Settings/SettingsSection.tsx'
import { createNotesSource } from './features/ContextSource/ContextSource.ts'

export const inject = ['slots', 'locale']

/** React hook: re-render on every store change. */
function useStore(store: NotesStore): void {
  const [, setTick] = React.useState(0)
  React.useEffect(() => store.subscribe(() => setTick((t) => t + 1)), [store])
}

/** Overlay host: renders the manager or the picker based on store state. */
function NotesOverlay(props: {
  store: NotesStore
  t: TranslateNS<'md-notes'>
}): React.ReactElement | null {
  useStore(props.store)
  const s = props.store.get()
  if (s.managerOpen) return React.createElement(NotesManager, { store: props.store, t: props.t })
  if (s.picker) {
    return React.createElement(NotePicker, {
      sessionId: s.picker.sessionId,
      messageId: s.picker.messageId,
      store: props.store,
      t: props.t,
    })
  }
  return null
}

/**
 * Client plugin body: register the locale namespace, then the sidebar entry,
 * the notes manager overlay, and the assistant-message note action — all
 * sharing one NotesStore and the `md-notes` locale seat.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  const store = new NotesStore()
  const t = ctx.locale.bind('md-notes')
  ctx.effect(() => ctx.locale.register('md-notes', { zh, en }), 'dsh-md-notes: locale dicts')

  // '@' reference source: notes as conversation context (docs/context.md).
  // Registered under ctx.effect so HMR/unmount clears the per-session caches.
  // The re-track hook re-opens the candidate menu right after a workspace
  // auto-complete (machine-driven draft changes never pass through onChange).
  const notesSource = createNotesSource(t, (sessionId, caret) => {
    const sessions = ctx.get('sessions') as { scope(id: SessionId): ClientContext | undefined } | undefined
    const actx = sessions?.scope(sessionId)
    if (actx === undefined) return
    const conversation = actx.get('conversation') as {
      input?: { for(a: ClientContext): { track(draft: string, caret: number): void; snapshot: { draft: string } } | undefined }
    } | undefined
    const input = conversation?.input?.for(actx)
    if (input === undefined) return
    queueMicrotask(() => {
      input.track(input.snapshot.draft, caret)
    })
  })
  ctx.effect(() => {
    const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract | undefined
    if (inputTriggers === undefined) {
      // ui-input-trigger absent (unbundled host) — the feature is inert.
      console.warn('[dsh-md-notes] inputTriggers unavailable; @ reference disabled')
      return () => {}
    }
    const unregister = inputTriggers.registerSource(notesSource.source)
    return () => {
      unregister()
      notesSource.dispose()
    }
  }, 'dsh-md-notes: @ source')

  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    { name: 'sidebar.footer.action', id: 'dsh-notes-entry', order: 30, label: t('sidebar.label'), locale: 'md-notes' },
    (props: { wide: boolean; t: TranslateNS<'md-notes'> }) =>
      React.createElement(NotesEntry, { wide: props.wide, store, t: props.t }),
  )), 'dsh-md-notes: sidebar entry')

  ctx.effect(() => ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register(
    { name: 'conversation.chat.assistant-actions', id: 'dsh-notes-save', order: 20, label: t('action.tooltip'), locale: 'md-notes' },
    (props: { sessionId: SessionId; messageId: string; t: TranslateNS<'md-notes'> }) =>
      React.createElement(NoteAction, {
        sessionId: String(props.sessionId),
        messageId: props.messageId,
        store,
        t: props.t,
      }),
  )), 'dsh-md-notes: assistant action')

  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'dsh-notes-overlay', order: 100, label: t('sidebar.entry'), locale: 'md-notes' },
    (props: { t: TranslateNS<'md-notes'> }) =>
      React.createElement(NotesOverlay, { store, t: props.t }),
  )), 'dsh-md-notes: overlay')

  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'md-notes', order: 10, label: () => t('git.settingsNav'), locale: 'md-notes' },
    SettingsSection,
  )), 'dsh-md-notes: settings section')
}
