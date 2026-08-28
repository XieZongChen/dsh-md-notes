/**
 * dsh-md-notes browser half entry: registers the feature's locale namespace,
 * then wires the shared store into the three registered slots (sidebar entry,
 * assistant action, overlay host). Uses React.createElement (no JSX) so this
 * file stays a plain `.ts` entry; feature modules live under
 * `./features/<Name>/`.
 * @module dsh-md-notes/client
 */

import * as React from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Declaration-merge triggers for slot maps + the ctx.locale service.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// The assistant-actions slot is now declared by ui-chat (was ui-conversation);
// UseChat is the session-scope Chat-target selector backing text capture, and
// ChatFileMentions is the optional service making note paths clickable in chat.
import type { ChatFileMentions, UseChat } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-general/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots), now provided by ui-renderer.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { InputTriggerServiceContract } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { createNotesUiStore, type NotesUiState, type NotesUiStore } from './features/store.ts'
import { createBusyTracker, type BusyTracker } from './features/busy.ts'
import { en, zh } from './features/locales/index.ts'
import { NotesEntry } from './features/NotesEntry/NotesEntry.tsx'
import { NoteAction } from './features/NoteAction/NoteAction.tsx'
import { NotePicker } from './features/NotePicker/NotePicker.tsx'
import { NotesManager } from './features/NotesManager/NotesManager.tsx'
import { SettingsSection } from './features/Settings/SettingsSection.tsx'
import { createNotesSource } from './features/ContextSource/ContextSource.ts'
import { resolveNotePath } from './features/note-links.ts'
import { api, ICON_URL, type WorkspaceNotes } from './features/api.ts'

export const inject = ['slots', 'locale']

/** React hook: subscribe to the store via uSES, re-render on snapshot change. */
function useStore(store: NotesUiStore): NotesUiState {
  return React.useSyncExternalStore(store.subscribe, store.getSnapshot)
}

/** Overlay host: renders the manager or the picker based on store state. */
function NotesOverlay(props: {
  store: NotesUiStore
  tracker: BusyTracker
  t: TranslateNS<'md-notes'>
}): React.ReactElement | null {
  const s = useStore(props.store)
  if (s.managerOpen) return React.createElement(NotesManager, { store: props.store, tracker: props.tracker, t: props.t })
  if (s.picker) {
    return React.createElement(NotePicker, {
      questionText: s.picker.questionText,
      answerText: s.picker.answerText,
      sessionTitle: s.picker.sessionTitle,
      store: props.store,
      tracker: props.tracker,
      t: props.t,
    })
  }
  return null
}

/**
 * Client plugin body: register the locale namespace, then the sidebar entry,
 * the notes manager overlay, and the assistant-message note action — all
 * sharing one NotesUiStore and the `md-notes` locale seat.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  const store = createNotesUiStore()
  const tracker = createBusyTracker(store)
  const t = ctx.locale.bind('md-notes')
  ctx.effect(() => ctx.locale.register('md-notes', { zh, en }), 'dsh-md-notes: locale dicts')

  // Chat file mentions: make assistant inline-code note paths (`` `相对路径` ``)
  // clickable — resolved against a cached all-workspaces list, then opening the
  // manager and jumping to the note (TODO 4.3; docs/context.md §3.7).
  let workspacesCache: WorkspaceNotes[] = []
  let cacheWarm = false
  const refreshWorkspaces = (): void => {
    void api('list').then((res) => {
      if (res.ok && res.workspaces !== undefined) {
        workspacesCache = res.workspaces
        cacheWarm = true
      }
    })
  }
  refreshWorkspaces()
  ctx.effect(() => ctx.provide('chatFileMentions', {
    forClosing: () => {
      refreshWorkspaces() // keep the list fresh for later turns
      return {
        resolve: (value) => {
          if (!cacheWarm) return undefined
          const link = resolveNotePath(value, workspacesCache)
          if (link === undefined) return undefined
          return {
            open: () => store.update((d) => {
              d.pendingOpen = { workspaceId: link.workspaceId, name: link.name }
              d.managerOpen = true
            }),
            label: link.title,
            title: link.title,
          }
        },
      }
    },
  } satisfies ChatFileMentions), 'dsh-md-notes: chat file mentions')

  // Note-reference chip logo: paint the plugin icon as the chip's domain
  // glyph. The notes `@` source sets a reserved `appearance` value 'notes', so
  // this selector matches only note chips — never ui-reference's file/session
  // chips (which use the built-in 'file'/'session' kinds). The chip's leading
  // `@` is transparent (it only reserves the icon's advance), and ReferenceIcon
  // renders nothing for the unknown kind, so the logo below fills that slot.
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-md-notes'
    tag.dataset.pluginCss = 'dsh-md-notes/context-chip'
    tag.textContent = [
      // The chip's leading '@' (transparent) reserves its glyph advance and
      // the title starts right after it. The logo is absolutely centered over
      // that advance. NOTE: keep the width close to the '@' advance (~10px at
      // 16px font) or the logo crowds the title; and do NOT add margin/padding
      // to the chip's elements — that shifts the backdrop away from the
      // textarea's caret (the inline-backdrop invariant). Tune the vertical
      // offset via `top` / `translateY` only.
      "[data-decoration='chip'][data-reference-appearance='notes'] > span:first-child::after {",
      "  content: '';",
      '  position: absolute;',
      '  top: 50%;',
      '  left: 50%;',
      '  transform: translate(-50%, -50%);',
      '  width: 12px;',
      '  height: 12px;',
      `  background: url('${ICON_URL}') center / contain no-repeat;`,
      '}',
    ].join('\n')
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'dsh-md-notes: context chip stylesheet')

  // Session title for the append section heading — read from the client-side
  // sessions list (in-memory, no host round-trip), see docs/context.md.
  const getSessionTitle = (sessionId: string): string => {
    const sessions = ctx.get('sessions') as { list?: { getSnapshot(): { byId?: Record<string, { title?: string }> } } } | undefined
    return sessions?.list?.getSnapshot().byId?.[sessionId]?.title ?? ''
  }

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
    (props: { sessionId: SessionId; messageId: string; useChat: UseChat; t: TranslateNS<'md-notes'> }) =>
      React.createElement(NoteAction, {
        sessionId: String(props.sessionId),
        messageId: props.messageId,
        useChat: props.useChat,
        getSessionTitle,
        store,
        t: props.t,
      }),
  )), 'dsh-md-notes: assistant action')

  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'dsh-notes-overlay', order: 100, label: t('sidebar.entry'), locale: 'md-notes' },
    (props: { t: TranslateNS<'md-notes'> }) =>
      React.createElement(NotesOverlay, { store, tracker, t: props.t }),
  )), 'dsh-md-notes: overlay')

  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'md-notes', order: 10, label: () => t('git.settingsNav'), locale: 'md-notes' },
    SettingsSection,
  )), 'dsh-md-notes: settings section')
}
