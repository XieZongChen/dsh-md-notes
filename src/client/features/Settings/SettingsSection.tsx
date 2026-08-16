/**
 * dsh-md-notes settings panel section ("MD 笔记"): the full git configuration
 * form, registered into `settings.section`. Reads/writes the `md-notes` L3
 * settings via the host API (`gitSettings` / `gitConfig`).
 *
 * Model (v4): repos are identified by **URL only** — the plugin manages the
 * local clone, so there is no path input and no sandbox authorization.
 * @module dsh-md-notes/client/SettingsSection
 */

import * as React from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { GitSettingsData, WorkspaceNotes } from '../api.ts'
import { api, gitConfigApi, gitSettingsApi } from '../api.ts'
import styles from './settings-section.module.css'

export interface SettingsSectionProps {
  /** Close the settings panel (from the shell's owner props). */
  close: () => void
  /** Framework-injected locale seat (`md-notes` namespace). */
  t: TranslateNS<'md-notes'>
}

/**
 * The settings panel section: mode (off/shared/own), auto-pull, commit
 * author, the shared repo (URL + branch), and per-workspace repos (URL +
 * branch + subpath).
 */
export function SettingsSection(props: SettingsSectionProps): React.ReactElement {
  const { t } = props
  const [settings, setSettings] = React.useState<GitSettingsData | null>(null)
  const [workspaces, setWorkspaces] = React.useState<WorkspaceNotes[]>([])
  const [msg, setMsg] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const dirtyScalar = React.useRef<Set<string>>(new Set())
  const dirtyCentral = React.useRef(false)
  const dirtyWs = React.useRef<Set<string>>(new Set())

  const overlayDirty = (fresh: GitSettingsData, local: GitSettingsData | null): GitSettingsData => {
    const next: GitSettingsData = { ...fresh }
    if (dirtyCentral.current && local?.gitCentral !== undefined) {
      (next as Record<string, unknown>).gitCentral = local.gitCentral
    }
    if (dirtyWs.current.size > 0 && local?.gitRepos !== undefined) {
      next.gitRepos = { ...(fresh.gitRepos ?? {}) }
      for (const id of dirtyWs.current) {
        const entry = local.gitRepos[id]
        if (entry !== undefined) (next.gitRepos as Record<string, unknown>)[id] = entry
      }
    }
    for (const key of dirtyScalar.current) {
      (next as Record<string, unknown>)[key] = (local as Record<string, unknown> | null)?.[key]
    }
    return next
  }

  const load = (): void => {
    void gitSettingsApi().then((res) => {
      if (res.ok && res.settings) setSettings((prev) => overlayDirty(res.settings ?? {}, prev))
    })
    void api('list').then((res) => {
      if (res.ok && res.workspaces) setWorkspaces(res.workspaces)
    })
  }

  React.useEffect(() => { load() }, [])

  const save = (): void => {
    if (settings === null) return
    setBusy(true)
    setMsg('')
    void gitSettingsApi().then((res) => {
      if (!res.ok || !res.settings) {
        setBusy(false)
        setMsg(t('git.failed', { error: res.ok ? '' : res.error ?? '' }))
        return
      }
      // Merge the user's edits over the LATEST settings so an external change
      // is never clobbered.
      const merged = overlayDirty(res.settings, settings)
      setSettings(merged)
      const patch: Record<string, unknown> = {}
      for (const key of dirtyScalar.current) patch[key] = (merged as Record<string, unknown>)[key]
      if (dirtyCentral.current) patch.gitCentral = merged.gitCentral
      if (dirtyWs.current.size > 0 && merged.gitRepos !== undefined) {
        const repos: Record<string, unknown> = {}
        for (const id of dirtyWs.current) repos[id] = merged.gitRepos[id]
        patch.gitRepos = repos
      }
      if (Object.keys(patch).length === 0) {
        setBusy(false)
        setMsg(t('git.saved'))
        return
      }
      void gitConfigApi(patch).then((r) => {
        setBusy(false)
        if (r.ok) {
          dirtyScalar.current = new Set()
          dirtyCentral.current = false
          dirtyWs.current = new Set()
          setMsg(t('git.saved'))
          window.setTimeout(() => setMsg(''), 1500)
        } else {
          setMsg(t('git.failed', { error: r.error ?? '' }))
        }
      })
    })
  }

  const set = (patch: Partial<GitSettingsData>): void => {
    for (const key of Object.keys(patch)) dirtyScalar.current.add(key)
    setSettings((prev) => ({ ...(prev ?? {}), ...patch }))
  }
  const setCentral = (patch: { remote?: string; branch?: string }): void => {
    dirtyCentral.current = true
    setSettings((prev) => ({ ...(prev ?? {}), gitCentral: { ...(prev?.gitCentral ?? {}), ...patch } }))
  }
  const setWs = (workspaceId: string, patch: { remote?: string; branch?: string; subpath?: string }): void => {
    dirtyWs.current.add(workspaceId)
    setSettings((prev) => ({
      ...(prev ?? {}),
      gitRepos: { ...(prev?.gitRepos ?? {}), [workspaceId]: { ...(prev?.gitRepos?.[workspaceId] ?? {}), ...patch } },
    }))
  }

  if (settings === null) return <div className={styles.loading}>{t('git.loading')}</div>

  const mode = settings.gitMode === 'shared' || settings.gitMode === 'own' ? settings.gitMode : 'off'

  return (
    <div className={styles.section}>
      <div className={styles.tipPanel}>
        <div className={styles.tipTitle}>{t('git.tipTitle')}</div>
        <div className={styles.tipBody}>
          {mode === 'shared' ? t('git.tipShared') : mode === 'own' ? t('git.tipOwn') : t('git.tipOff')}
        </div>
      </div>
      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>{t('git.mode')}</span>
          <select
            className={styles.input}
            value={mode}
            onChange={(e) => set({ gitMode: e.target.value as 'off' | 'shared' | 'own' })}
          >
            <option value="off">{t('git.modeOff')}</option>
            <option value="shared">{t('git.modeShared')}</option>
            <option value="own">{t('git.modeOwn')}</option>
          </select>
        </label>
      </div>
      <div className={styles.hint}>{mode === 'off' ? t('git.modeOffHint') : mode === 'shared' ? t('git.modeSharedHint') : t('git.modeOwnHint')}</div>

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={settings.gitAutoPull !== false}
          onChange={(e) => set({ gitAutoPull: e.target.checked })}
        />
        {t('git.autoPull')}
      </label>

      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>{t('git.authorName')}</span>
          <input
            className={styles.input}
            value={settings.gitAuthorName ?? ''}
            onChange={(e) => set({ gitAuthorName: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('git.authorEmail')}</span>
          <input
            className={styles.input}
            value={settings.gitAuthorEmail ?? ''}
            onChange={(e) => set({ gitAuthorEmail: e.target.value })}
          />
        </label>
      </div>

      {mode === 'shared' && (
        <div className={styles.group}>
          <div className={styles.groupTitle}>{t('git.centralTitle')}</div>
          <div className={styles.row}>
            <label className={styles.field}>
              <span className={styles.label}>{t('git.url')}</span>
              <input
                className={styles.input}
                placeholder={t('git.urlPlaceholder')}
                value={settings.gitCentral?.remote ?? ''}
                onChange={(e) => setCentral({ remote: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>{t('git.branch')}</span>
              <input
                className={styles.input}
                placeholder={t('git.branchPlaceholder')}
                value={settings.gitCentral?.branch ?? ''}
                onChange={(e) => setCentral({ branch: e.target.value })}
              />
            </label>
          </div>
        </div>
      )}

      {mode === 'own' && (
        <div className={styles.group}>
          <div className={styles.groupTitle}>{t('git.workspacesTitle')}</div>
          {workspaces.length === 0
            ? <div className={styles.hint}>{t('git.noWorkspaces')}</div>
            : workspaces.map((ws) => {
              const repo = settings.gitRepos?.[ws.workspaceId]
              return (
                <div key={ws.workspaceId} className={styles.wsBlock}>
                  <div className={styles.wsName}>{ws.name}</div>
                  <div className={styles.wsRow}>
                    <input
                      className={styles.input}
                      placeholder={t('git.urlPlaceholder')}
                      value={repo?.remote ?? ''}
                      onChange={(e) => setWs(ws.workspaceId, { remote: e.target.value })}
                    />
                    <input
                      className={styles.input}
                      placeholder={t('git.branchPlaceholder')}
                      value={repo?.branch ?? ''}
                      onChange={(e) => setWs(ws.workspaceId, { branch: e.target.value })}
                    />
                    <input
                      className={styles.input}
                      placeholder={t('git.subpathPlaceholder')}
                      value={repo?.subpath ?? ''}
                      onChange={(e) => setWs(ws.workspaceId, { subpath: e.target.value })}
                    />
                  </div>
                  <div className={styles.hint}>{t('git.wsRowHint')}</div>
                </div>
              )
            })}
        </div>
      )}

      <div className={styles.foot}>
        <span className={styles.msg}>{msg}</span>
        <button type="button" className={styles.saveBtn} disabled={busy} onClick={save}>
          {t('git.saveSettings')}
        </button>
      </div>
    </div>
  )
}
