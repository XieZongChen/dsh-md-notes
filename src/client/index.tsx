/**
 * dsh-md-notes browser half: sidebar entry, notes manager overlay, and the
 * assistant-message note action, all backed by the host HTTP API.
 * @module dsh-md-notes/client
 */

import * as React from 'react'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Declaration-merge triggers for slot maps.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { css as dshnCss } from './styles.ts'

export const inject = ['slots']

interface NoteSummary { name: string; title: string; updatedAt: number }
type ApiResult =
  | { ok: true; notes?: NoteSummary[]; content?: string; name?: string; dir?: string }
  | { ok: false; error: string }

const API = '/plugins/md-notes'

async function api(method: string, body: Record<string, unknown> = {}): Promise<ApiResult> {
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, ...body }),
    })
    if (!res.ok) return { ok: false, error: `http ${res.status}` }
    return (await res.json()) as ApiResult
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

interface NotesStoreState {
  managerOpen: boolean
  picker: { sessionId: string; messageId: string } | null
}

class NotesStore {
  private state: NotesStoreState = { managerOpen: false, picker: null }
  private readonly listeners = new Set<() => void>()

  get(): NotesStoreState { return this.state }
  set(patch: Partial<NotesStoreState>): void {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
}

export function apply(ctx: ClientContext): void {
  const styleEl = document.createElement('style')
  styleEl.setAttribute('data-plugin', 'dsh-md-notes')
  styleEl.textContent = dshnCss
  document.head.appendChild(styleEl)
  ctx.effect(() => () => { styleEl.remove() }, 'dsh-md-notes: styles')

  const store = new NotesStore()

  const useStore = (): NotesStoreState => {
    const [, setTick] = React.useState(0)
    React.useEffect(() => store.subscribe(() => setTick((t) => t + 1)), [])
    return store.get()
  }

  /* ---- tiny markdown renderer ---- */
  const escapeHtml = (s: string): string =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const inlineMd = (s: string): string =>
    escapeHtml(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')

  const renderMd = (src: string): string => {
    const lines = String(src ?? '').split('\n')
    const out: string[] = []
    let inCode = false
    let codeBuf: string[] = []
    let inList = false
    const flushList = (): void => { if (inList) { out.push('</ul>'); inList = false } }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      if (/^```/.test(line)) {
        flushList()
        if (inCode) { out.push(`<pre>${escapeHtml(codeBuf.join('\n'))}</pre>`); codeBuf = []; inCode = false }
        else inCode = true
        continue
      }
      if (inCode) { codeBuf.push(line); continue }
      const h = line.match(/^(#{1,6})\s+(.*)$/)
      if (h) { flushList(); out.push(`<h${h[1]!.length}>${inlineMd(h[2]!)}</h${h[1]!.length}>`); continue }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushList(); out.push('<hr/>'); continue }
      const li = line.match(/^\s*[-*+]\s+(.*)$/)
      if (li) { if (!inList) { out.push('<ul>'); inList = true } out.push(`<li>${inlineMd(li[1]!)}</li>`); continue }
      const bq = line.match(/^>\s?(.*)$/)
      if (bq) { flushList(); out.push(`<blockquote>${inlineMd(bq[1]!)}</blockquote>`); continue }
      flushList()
      if (line.trim() === '') continue
      out.push(`<p>${inlineMd(line)}</p>`)
    }
    flushList()
    if (inCode) out.push(`<pre>${escapeHtml(codeBuf.join('\n'))}</pre>`)
    return out.join('\n')
  }

  const fmtTime = (ts: number | undefined): string =>
    ts ? new Date(ts).toLocaleString() : ''

  /* ---- sidebar entry ---- */
  const NotesEntry = (props: { wide: boolean }): React.ReactElement => {
    const wide = !!props.wide
    const rowRef = React.useRef<HTMLDivElement | null>(null)
    React.useEffect(() => {
      const el = rowRef.current
      if (!el) return
      const patched: Array<[HTMLElement, string]> = []
      let node = el.parentElement
      let hops = 0
      while (node && hops < 4) {
        const prev = node.style.flexWrap
        if (prev !== 'wrap') {
          node.style.flexWrap = 'wrap'
          patched.push([node, prev])
        }
        node = node.parentElement
        hops++
      }
      return () => { for (const [n, prev] of patched) n.style.flexWrap = prev }
    }, [])
    return (
      <div ref={rowRef} className="notesRow">
        <button
          type="button"
          className={wide ? 'entry' : 'entry entryRail'}
          title="MD 笔记"
          onClick={() => store.set({ managerOpen: true })}
        >
          <span className="entryIcon">📓</span>
          {wide ? <span className="entryLabel">笔记</span> : null}
        </button>
      </div>
    )
  }

  /* ---- assistant message action ---- */
  const NoteAction = (props: { sessionId: SessionId; messageId: string }): React.ReactElement => (
    <button
      type="button"
      className="action"
      title="记入笔记"
      onClick={() => store.set({ picker: { sessionId: String(props.sessionId), messageId: props.messageId } })}
    >
      <span className="actionIcon">📝</span>
    </button>
  )

  /* ---- overlay root ---- */
  const NotesOverlay = (): React.ReactElement | null => {
    useStore()
    const s = store.get()
    if (s.managerOpen) return <NotesManager />
    if (s.picker) return <NotePicker sessionId={s.picker.sessionId} messageId={s.picker.messageId} />
    return null
  }

  /* ---- note picker popup ---- */
  const NotePicker = (props: { sessionId: string; messageId: string }): React.ReactElement => {
    const [notes, setNotes] = React.useState<NoteSummary[]>([])
    const [selected, setSelected] = React.useState<string | null>(null)
    const [newTitle, setNewTitle] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const [status, setStatus] = React.useState('')

    React.useEffect(() => {
      void api('list').then((res) => {
        if (res.ok && res.notes) {
          setNotes(res.notes)
          if (res.notes.length > 0) setSelected(res.notes[0]!.name)
        }
      })
    }, [])

    const createAndPick = (): void => {
      const title = newTitle.trim()
      setBusy(true)
      void api('create', { title }).then((res) => {
        setBusy(false)
        if (res.ok && res.name) {
          setSelected(res.name)
          setNewTitle('')
          return api('list')
        }
        setStatus('创建失败')
        return null
      }).then((res) => { if (res?.ok && res.notes) setNotes(res.notes) })
    }

    const send = (): void => {
      if (!selected) { setStatus('请先选择或新建一篇笔记'); return }
      setBusy(true)
      setStatus('写入中…')
      void api('appendConversation', { noteName: selected, sessionId: props.sessionId, messageId: props.messageId }).then((res) => {
        setBusy(false)
        if (res.ok) {
          setStatus('已写入 ✓')
          window.setTimeout(() => store.set({ picker: null }), 900)
        } else {
          setStatus(`写入失败: ${res.error}`)
        }
      })
    }

    const close = (): void => store.set({ picker: null })

    return (
      <div className="mask" onClick={(e) => { if (e.target === e.currentTarget) close() }}>
        <div className="dialog">
          <div className="dialogHead">
            <span className="dialogTitle">📝 记入笔记</span>
            <button type="button" className="iconBtn" onClick={close} title="关闭">✕</button>
          </div>
          <div className="dialogBody">
            {notes.length === 0
              ? <div className="empty">还没有笔记，先在下方新建一篇</div>
              : <div className="pickList">
                {notes.map((n) => (
                  <div
                    key={n.name}
                    className={selected === n.name ? 'pickItem pickItemActive' : 'pickItem'}
                    onClick={() => setSelected(n.name)}
                  >
                    <span className="pickRadio">{selected === n.name ? '●' : '○'}</span>
                    <span>{n.title}</span>
                  </div>
                ))}
              </div>}
            <div className="newRow">
              <input
                className="input"
                placeholder="新建笔记标题…"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createAndPick() }}
              />
              <button type="button" className="btn" onClick={createAndPick} disabled={busy}>新建</button>
            </div>
            <div className="status">{status}</div>
          </div>
          <div className="dialogFoot">
            <button type="button" className="btn btnPrimary" onClick={send} disabled={busy || !selected}>
              {busy ? '写入中…' : '写入笔记'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ---- notes manager ---- */
  const NotesManager = (): React.ReactElement => {
    const [notes, setNotes] = React.useState<NoteSummary[]>([])
    const [selected, setSelected] = React.useState<string | null>(null)
    const [content, setContent] = React.useState('')
    const [mode, setMode] = React.useState<'edit' | 'preview'>('edit')
    const [newTitle, setNewTitle] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const [flash, setFlash] = React.useState('')

    const refresh = (): void => {
      void api('list').then((res) => { if (res.ok && res.notes) setNotes(res.notes) })
    }

    React.useEffect(() => { refresh() }, [])

    const open = (name: string): void => {
      setSelected(name)
      setMode('edit')
      void api('read', { name }).then((res) => { if (res.ok) setContent(res.content ?? '') })
    }

    const save = (): void => {
      if (!selected) return
      setBusy(true)
      void api('write', { name: selected, content }).then((res) => {
        setBusy(false)
        if (res.ok) { setFlash('已保存'); refresh(); window.setTimeout(() => setFlash(''), 1200) }
        else setFlash('保存失败')
      })
    }

    const create = (): void => {
      const title = newTitle.trim() || `未命名笔记 ${new Date().toLocaleDateString()}`
      setBusy(true)
      setFlash('创建中…')
      void api('create', { title }).then((res) => {
        setBusy(false)
        if (res.ok && res.name) {
          setNewTitle('')
          setFlash('已创建 ✓')
          refresh()
          open(res.name)
          window.setTimeout(() => setFlash(''), 1500)
        } else {
          setFlash('创建失败')
        }
      })
    }

    const remove = (name: string): void => {
      if (window.confirm(`删除笔记 ${name} ？`)) {
        void api('delete', { name }).then((res) => {
          if (res.ok) {
            if (selected === name) { setSelected(null); setContent('') }
            refresh()
          }
        })
      }
    }

    const close = (): void => store.set({ managerOpen: false })
    const previewHtml = mode === 'preview' ? renderMd(content) : ''

    return (
      <div className="mask" onClick={(e) => { if (e.target === e.currentTarget) close() }}>
        <div className="manager">
          <div className="managerHead">
            <span className="managerTitle">📓 MD 笔记</span>
            <span className="managerSub">保存于工作区 .dsh-notes/</span>
            <button type="button" className="iconBtn" onClick={close} title="关闭">✕</button>
          </div>
          <div className="managerBody">
            <div className="list">
              <div className="listHead">
                <input
                  className="input"
                  placeholder="新笔记标题…"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') create() }}
                />
                <button type="button" className="btn" onClick={create} disabled={busy}>
                  {busy ? '创建中…' : '新建'}
                </button>
              </div>
              <div className="listItems">
                {notes.length === 0
                  ? <div className="empty">还没有笔记，输入标题后点“新建”</div>
                  : notes.map((n) => (
                    <div
                      key={n.name}
                      className={selected === n.name ? 'noteItem noteItemActive' : 'noteItem'}
                      onClick={() => open(n.name)}
                    >
                      <div className="noteMain">
                        <div className="noteTitle">{n.title}</div>
                        <div className="noteTime">{fmtTime(n.updatedAt)}</div>
                      </div>
                      <button
                        type="button"
                        className="noteDel"
                        title="删除"
                        onClick={(e) => { e.stopPropagation(); remove(n.name) }}
                      >🗑</button>
                    </div>
                  ))}
              </div>
            </div>
            <div className="editor">
              {!selected
                ? <div className="empty editorEmpty">← 选择左侧笔记，或新建一篇</div>
                : (
                  <>
                    <div className="editorHead">
                      <button type="button" className={mode === 'edit' ? 'tab tabActive' : 'tab'} onClick={() => setMode('edit')}>编辑</button>
                      <button type="button" className={mode === 'preview' ? 'tab tabActive' : 'tab'} onClick={() => setMode('preview')}>预览</button>
                      <span className="editorName">{selected}</span>
                      <span className="flash">{flash}</span>
                      <button type="button" className="btn btnPrimary" onClick={save} disabled={busy}>保存</button>
                    </div>
                    {mode === 'edit'
                      ? <textarea className="textarea" value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} />
                      : <div className="preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />}
                  </>
                )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    { name: 'sidebar.footer.action', id: 'dsh-notes-entry', order: 30, label: '笔记' },
    (props: { wide: boolean }) => <NotesEntry wide={props.wide} />,
  )), 'dsh-md-notes: sidebar entry')

  ctx.effect(() => ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register(
    { name: 'conversation.chat.assistant-actions', id: 'dsh-notes-save', order: 20, label: '记笔记' },
    (props: { sessionId: SessionId; messageId: string }) => <NoteAction sessionId={props.sessionId} messageId={props.messageId} />,
  )), 'dsh-md-notes: assistant action')

  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'dsh-notes-overlay', order: 100, label: 'MD 笔记' },
    () => <NotesOverlay />,
  )), 'dsh-md-notes: overlay')
}
