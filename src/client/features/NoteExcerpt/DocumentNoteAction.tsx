/**
 * The document preview's "save as note" action (dsh 0.1.7's
 * `sidebar.right.tab.document.actions` list seat): one button in the preview
 * toolbar that seeds a new note with the previewed file's text via the host
 * `createFromFile` endpoint, then opens the created note in the notes viewer
 * tab. The host re-validates that the file sits inside the target workspace;
 * the client only picks the workspace whose root contains the path (the
 * preview's `absolutePath` is host-native, so the notes dir's parent is the
 * workspace root).
 * @module dsh-md-notes/client/NoteExcerpt/DocumentNoteAction
 */

import * as React from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { absoluteFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { api } from '../api.ts'
import css from './document-note-action.module.css'

/** The owner-provided navigation face (registered `inject` in `client/index.ts`). */
export interface DocumentNoteActionInjected {
  /** Open a resource address in the right Sidebar (the created note). */
  openResource(address: string): void
}

/** Props the document-preview seat hands every actions entry, plus our inject face. */
export type DocumentNoteActionProps =
  & { absolutePath: string }
  & InjectFace<DocumentNoteActionInjected>
  & PropsLocale<'md-notes'>

/**
 * One excerpt action: click → create the note → open it in the viewer tab.
 * Failure stays inline in the button's tooltip; success shows a check briefly.
 */
export function DocumentNoteAction({ absolutePath, openResource, t }: DocumentNoteActionProps): ReactNode {
  const [state, setState] = React.useState<'idle' | 'busy' | 'done' | 'failed'>('idle')
  const [message, setMessage] = React.useState('')

  const save = React.useCallback((): void => {
    if (state === 'busy') return
    setState('busy')
    void (async () => {
      // Pick the workspace whose root contains the file; notesDir is
      // `<root>/.dsh-notes`, so the root is its parent path.
      const list = await api('list', {})
      if (!list.ok) {
        setMessage(list.error)
        setState('failed')
        return
      }
      const owner = list.workspaces.find((ws) => {
        const root = ws.notesDir.replace(/[\\/][^\\/]+$/, '')
        return root !== '' && (absolutePath === root || absolutePath.startsWith(root + '/') || absolutePath.startsWith(root + '\\'))
      })
      if (owner === undefined) {
        setMessage(t('excerpt.errOutside'))
        setState('failed')
        return
      }
      const created = await api('createFromFile', { path: absolutePath, workspaceId: owner.workspaceId })
      if (!created.ok) {
        setMessage(created.error)
        setState('failed')
        return
      }
      setState('done')
      openResource(absoluteFileAddress(`${owner.notesDir}/${created.name}`))
      window.setTimeout(() => { setState('idle'); setMessage('') }, 2000)
    })()
  }, [absolutePath, openResource, state, t])

  const label = state === 'done' ? t('excerpt.done') : t('excerpt.action')
  const button = (
    <button
      type="button"
      className={css.action}
      data-note-excerpt-state={state}
      disabled={state === 'busy'}
      onClick={save}
    >{state === 'busy' ? t('excerpt.busy') : label}</button>
  )
  return state === 'failed' && message !== ''
    ? <Tooltip label={message}>{button}</Tooltip>
    : button
}
