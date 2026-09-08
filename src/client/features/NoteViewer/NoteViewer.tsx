/**
 * The `md-notes` right-Sidebar tab body: one note rendered as markdown.
 *
 * The tab type (`client/index.ts`) claims file addresses ending in a flat
 * `.dsh-notes` markdown name, at `extension` priority, beating the builtin
 * plain-text viewer for note files. This body maps the address to a note
 * through the plugin's own `list`/`read` API (`address.ts`), renders with
 * `MarkdownText` (the same preview vocabulary as the manager, interlinks
 * included), and opens interlink clicks as further sidebar tabs through the
 * owner's navigation face — the viewer stays a viewer: no editing, no git
 * surface.
 * @module dsh-md-notes/client/NoteViewer/NoteViewer
 */

import * as React from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconRefreshOutline16,
  MarkdownText,
  type MarkdownFileMentions,
  type MarkdownLabels,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { absoluteFileAddress, parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { api, type WorkspaceNotes } from '../api.ts'
import { noteTargetOf, sessionRootOf, type NoteTarget } from './address.ts'
import { preprocessWikiLinks, resolveNoteLink, titleMatchCount } from '../note-links.ts'
import css from './note-viewer.module.css'

/** The owner-provided navigation face (registered `inject` in `client/index.ts`). */
export interface NoteViewerInjected {
  /** Open another resource address in the right Sidebar. */
  openResource(address: string): void
}

/** The body's composed props: the tab, the navigation face, and copy. */
export type NoteViewerProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & InjectFace<NoteViewerInjected>
  & PropsLocale<'md-notes'>

/** What the body is showing. */
type Phase =
  | { kind: 'loading' }
  | { kind: 'not-note' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; target: NoteTarget; title: string; content: string; groups: readonly WorkspaceNotes[] }

/**
 * The note-viewer tab body. Every hook runs on every render (no conditional
 * hooks); the not-ready branches only affect the returned tree.
 * @param props - composed slot props.
 * @returns the note as markdown, or the reason it is not showing.
 */
export function NoteViewer({ useTabInfo, openResource, t }: NoteViewerProps): ReactNode {
  const { tab } = useTabInfo()
  const [phase, setPhase] = React.useState<Phase>({ kind: 'loading' })
  // Reload bump: the header control re-runs the load for the same address.
  const [revision, setRevision] = React.useState(0)

  React.useEffect(() => {
    const signal = tab.signal
    let cancelled = false
    setPhase({ kind: 'loading' })
    void (async () => {
      // Every group (matching + interlink vocabulary) +, for session-scoped
      // addresses, the address's own session group (its workspace root).
      const all = await api('list', {}, signal)
      if (signal.aborted) return
      if (!all.ok) {
        if (!cancelled) setPhase({ kind: 'failed', message: all.error })
        return
      }
      const parsed = parseFileAddress(tab.contentId)
      const sessionRoot = parsed?.scope === 'session'
        ? await api('list', { sessionId: parsed.sessionId }, signal).then((scoped) => {
          if (!scoped.ok || signal.aborted) return undefined
          return sessionRootOf(scoped.workspaces[0])
        })
        : undefined
      if (signal.aborted || cancelled) return
      const target = noteTargetOf(tab.contentId, all.workspaces, sessionRoot)
      if (target === undefined) {
        setPhase({ kind: 'not-note' })
        return
      }
      const read = await api('read', { name: target.name, workspaceId: target.workspaceId }, signal)
      if (signal.aborted || cancelled) return
      if (!read.ok) {
        setPhase({ kind: 'failed', message: read.error })
        return
      }
      const group = all.workspaces.find((ws) => ws.workspaceId === target.workspaceId)
      const title = group?.notes.find((note) => note.name === target.name)?.title ?? target.name
      setPhase({ kind: 'ready', target, title, content: read.content, groups: all.workspaces })
    })()
    return () => { cancelled = true }
  }, [tab.contentId, tab.signal, revision])

  const markdownLabels = React.useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])

  const ready = phase.kind === 'ready' ? phase : undefined
  // Interlinks: the manager's vocabulary (`` `名` `` + `[[名]]`), opening the
  // linked note as ANOTHER sidebar tab at its absolute address.
  const fileMentions = React.useMemo<MarkdownFileMentions>(() => ({
    resolve: (value) => {
      if (ready === undefined) return undefined
      const link = resolveNoteLink(value, ready.groups, ready.target.workspaceId)
      if (link === undefined) return undefined
      const ws = ready.groups.find((g) => g.workspaceId === link.workspaceId)
      const base = ws === undefined ? link.name : `${ws.name} · ${link.name}`
      const dupCount = titleMatchCount(value, ready.groups, link.workspaceId)
      return {
        open: () => {
          if (ws !== undefined) openResource(absoluteFileAddress(`${ws.notesDir}/${link.name}`))
        },
        label: link.title,
        title: dupCount > 1 ? `${base} — ${t('link.duplicateHint', { count: dupCount })}` : base,
      }
    },
  }), [ready, openResource, t])

  const previewText = React.useMemo(
    () => ready === undefined ? '' : preprocessWikiLinks(ready.content, ready.groups, ready.target.workspaceId),
    [ready],
  )

  if (ready === undefined) {
    return (
      <div className={css.status} data-note-viewer-state={phase.kind}>
        <p className={css.statusLine}>{t(
          phase.kind === 'loading' ? 'viewer.loading'
            : phase.kind === 'not-note' ? 'viewer.notNote'
              : 'viewer.failed',
        )}</p>
        {phase.kind === 'failed' && (
          <button type="button" className={css.action} data-note-viewer-retry onClick={() => { setRevision((n) => n + 1) }}>
            {t('viewer.retry')}
          </button>
        )}
      </div>
    )
  }

  const { target, title } = ready
  return (
    <div className={css.viewer} data-note-viewer-state="ready" data-note-viewer-address={tab.contentId}>
      <div className={css.header}>
        <span className={css.title} title={target.name} data-note-viewer-title>{title}</span>
        <span className={css.chip} data-note-viewer-workspace>{target.workspaceName}</span>
        <button
          type="button"
          className={css.tool}
          aria-label={t('viewer.reload')}
          title={t('viewer.reload')}
          data-note-viewer-reload
          onClick={() => { setRevision((n) => n + 1) }}
        >
          <IconRefreshOutline16 />
        </button>
      </div>
      <div className={css.body} data-note-viewer-body>
        <MarkdownText text={previewText} labels={markdownLabels} fileMentions={fileMentions} />
      </div>
    </div>
  )
}
