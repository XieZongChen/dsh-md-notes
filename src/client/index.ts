/**
 * dsh-md-notes browser frontend entry: registers the feature's locale namespace,
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
// UseChat is the session-scope Chat-target selector backing text capture.
import type { UseChat } from '@deepseek-ai/dsh-client-ui-chat/client'
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
import { ICON_URL } from './features/api.ts'

/** Minimal projection of the per-session input state the re-track hook reads. */
interface InputSnapshot {
  draft: string
  draftRev: number
  phase: 'plain' | 'claimed' | 'adjudicating' | 'submitting'
}

/** Trigger availability tier from the input phase (mirrors dsh facade's guardOf). */
function triggerGuard(phase: InputSnapshot['phase']): 'plain' | 'claimed' | 'frozen' {
  switch (phase) {
    case 'plain': return 'plain'
    case 'claimed': return 'claimed'
    default: return 'frozen' // adjudicating / submitting
  }
}

// inputTriggers is deliberately NOT here: it is an OPTIONAL service — without
// it only the `@` notes source stays disabled (warn + no-op below), while the
// sidebar entry, manager, picker and settings section keep working. Declaring
// it in inject would make the whole frontend fail to load on dsh builds
// without ui-input-trigger.
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

  // Sidebar footer stacking (issue #2): dsh's `.footerActions` (the
  // sidebar.footer.action container, packages/client/ui-sidebar
  // SidebarRoot.module.css) is `display: flex` row + nowrap, while every
  // registered entry — the default-bundled ui-cordis row AND this plugin's
  // notes row — is `width: 100%; flex: none`. Two full-width non-shrinking
  // children in one nowrap row squeeze/overflow each other. The root fix is
  // upstream (column or wrap); until it lands, this rule stacks the
  // container. DELETE this effect once upstream ships the fix.
  //
  // Scoping/safety notes (do not "simplify" into a hashed-class match):
  // - `[data-slot]` anchors are an official harness contract — "every slot
  //   render site exposes a stable [data-slot] wrapper — the addressable seam
  //   dynamic styles target" (ui-renderer scoped-slots.tsx). No css-modules
  //   hashed class names are involved, so there is no substring over-match.
  // - The `>` direct-child combinator pins the match to exactly ONE element:
  //   the anchor's parent (the footerActions flex box). Structurally it can
  //   never climb to SidebarRoot or the session list.
  // - Unlike the historical issue #1 workaround (JS walking ancestors writing
  //   inline flex-wrap onto foreign nodes, widening the whole sidebar): this
  //   is one declarative rule in our own effect-owned tag, sets ONLY
  //   flex-direction (column over full-width rows renders identically for a
  //   single entry), touches flex-wrap nowhere, and is removed on
  //   unload/HMR with zero residue.
  // - Failure modes are inert: browsers without :has(), or an upstream
  //   column fix, make the rule a no-op back to today's layout; another
  //   plugin shipping the same rule is idempotent, and a display-level
  //   override from another plugin wins silently (flex-direction is a dead
  //   property outside a flex container).
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-md-notes'
    tag.dataset.pluginCss = 'dsh-md-notes/sidebar-footer'
    tag.textContent = "div:has(> [data-slot='sidebar.footer.action']) { flex-direction: column; }"
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'dsh-md-notes: sidebar footer stack stylesheet')

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
  // dsh's input refactor moved re-track off the SessionInput facade: the per-
  // session controller (inputTriggers.sessionOf) owns track(), and the draft /
  // revision / phase now come from the input state store.
  const notesSource = createNotesSource(t, (sessionId, caret) => {
    const sessions = ctx.get('sessions') as { scope(id: SessionId): ClientContext | undefined } | undefined
    const actx = sessions?.scope(sessionId)
    if (actx === undefined) return
    const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract | undefined
    const conversation = actx.get('conversation') as {
      input?: { for(a: ClientContext): { state: { getSnapshot(): InputSnapshot } } | undefined }
    } | undefined
    const sessionInput = conversation?.input?.for(actx)
    if (sessionInput === undefined || inputTriggers === undefined) return
    const state = sessionInput.state.getSnapshot()
    queueMicrotask(() => {
      inputTriggers.sessionOf(actx).track(state.draft, caret, { tier: triggerGuard(state.phase) }, state.draftRev)
    })
  })
  ctx.effect(() => {
    const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract | undefined
    if (inputTriggers === undefined) {
      // Graceful degradation (docs/architecture.md §4): only the `@` notes
      // source is lost; every other slot keeps working.
      console.warn('[dsh-md-notes] inputTriggers service unavailable — the @ notes reference source stays disabled')
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
