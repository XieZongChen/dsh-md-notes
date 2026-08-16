/**
 * dsh-md-notes settings panel section ("MD 笔记"): the full git configuration
 * form, registered into `settings.section`. Reads/writes the `md-notes` L3
 * settings via the host API (`gitSettings` / `gitConfig`), and authorizes or
 * revokes sandbox-external repos (`gitAuthorize` / `gitRevoke`).
 * @module dsh-md-notes/client/SettingsSection
 */

import * as React from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { GitSettingsData, WorkspaceNotes } from '../api.ts'
import { api, gitAuthorizeApi, gitConfigApi, gitRevokeApi, gitSettingsApi, gitSuggestApi, type GitSuggestData } from '../api.ts'
import styles from './settings-section.module.css'

export interface SettingsSectionProps {
  /** Close the settings panel (from the shell's owner props). */
  close: () => void
  /** Framework-injected locale seat (`md-notes` namespace). */
  t: TranslateNS<'md-notes'>
}

/**
 * The settings panel section: git master switch, branch, auto-pull, commit
 * author, the central repo (path/remote + authorization), and per-workspace
 * repos.
 */
export function SettingsSection(props: SettingsSectionProps): React.ReactElement {
  const { t } = props
  const [settings, setSettings] = React.useState<GitSettingsData | null>(null)
  const [workspaces, setWorkspaces] = React.useState<WorkspaceNotes[]>([])
  const [suggestions, setSuggestions] = React.useState<GitSuggestData | null>(null)
  const [msg, setMsg] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const load = (): void => {
    void gitSettingsApi().then((res) => {
      if (res.ok && res.settings) setSettings(res.settings)
    })
    void api('list').then((res) => {
      if (res.ok && res.workspaces) setWorkspaces(res.workspaces)
    })
    void gitSuggestApi().then((res) => {
      if (res.ok && res.suggestions) setSuggestions(res.suggestions)
    })
  }

  React.useEffect(() => { load() }, [])

  const save = (): void => {
    if (settings === null) return
    setBusy(true)
    setMsg('')
    void gitConfigApi({
      gitMode: settings.gitMode ?? 'off',
      gitAutoPull: settings.gitAutoPull ?? true,
      gitBranch: settings.gitBranch ?? 'main',
      gitAuthorName: settings.gitAuthorName ?? '',
      gitAuthorEmail: settings.gitAuthorEmail ?? '',
      gitCentral: settings.gitCentral ?? {},
      gitRepos: settings.gitRepos ?? {},
    }).then((res) => {
      setBusy(false)
      if (res.ok) {
        setMsg(t('git.saved'))
        window.setTimeout(() => setMsg(''), 1500)
      } else {
        setMsg(t('git.failed', { error: res.error ?? '' }))
      }
    })
  }

  const toggleCentralAuth = (): void => {
    if (settings === null) return
    const authorized = !(settings.gitCentral?.authorized === true)
    setBusy(true)
    void (authorized ? gitAuthorizeApi() : gitRevokeApi()).then((res) => {
      setBusy(false)
      if (res.ok) load()
      else setMsg(t('git.failed', { error: res.error ?? '' }))
    })
  }

  const toggleWsAuth = (workspaceId: string): void => {
    const repo = settings?.gitRepos?.[workspaceId]
    const authorized = !(repo?.authorized === true)
    setBusy(true)
    void (authorized ? gitAuthorizeApi(workspaceId) : gitRevokeApi(workspaceId)).then((res) => {
      setBusy(false)
      if (res.ok) load()
      else setMsg(t('git.failed', { error: res.error ?? '' }))
    })
  }

  const set = (patch: Partial<GitSettingsData>): void => {
    setSettings((prev) => ({ ...(prev ?? {}), ...patch }))
  }
  const setCentral = (patch: { path?: string; remote?: string; authorized?: boolean }): void => {
    setSettings((prev) => ({ ...(prev ?? {}), gitCentral: { ...(prev?.gitCentral ?? {}), ...patch } }))
  }
  const setWs = (workspaceId: string, patch: { path?: string; remote?: string; authorized?: boolean }): void => {
    setSettings((prev) => ({
      ...(prev ?? {}),
      gitRepos: { ...(prev?.gitRepos ?? {}), [workspaceId]: { ...(prev?.gitRepos?.[workspaceId] ?? {}), ...patch } },
    }))
  }

  if (settings === null) return <div className={styles.loading}>{t('git.loading')}</div>

  return (
    <div className={styles.section}>
      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>{t('git.mode')}</span>
          <select
            className={styles.input}
            value={settings.gitMode ?? 'off'}
            onChange={(e) => set({ gitMode: e.target.value as 'off' | 'on' })}
          >
            <option value="off">{t('git.modeOff')}</option>
            <option value="on">{t('git.modeOn')}</option>
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('git.branch')}</span>
          <input
            className={styles.input}
            value={settings.gitBranch ?? 'main'}
            onChange={(e) => set({ gitBranch: e.target.value })}
          />
        </label>
      </div>

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

      <div className={styles.group}>
        <div className={styles.groupTitle}>{t('git.centralTitle')}</div>
        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.label}>{t('git.path')}</span>
            <input
              className={styles.input}
              placeholder={t('git.centralPathPlaceholder')}
              value={settings.gitCentral?.path ?? ''}
              onChange={(e) => setCentral({ path: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>{t('git.remote')}</span>
            <input
              className={styles.input}
              placeholder={t('git.remotePlaceholder')}
              value={settings.gitCentral?.remote ?? ''}
              onChange={(e) => setCentral({ remote: e.target.value })}
            />
          </label>
          {suggestions?.centralPath && (
            <button type="button" className={styles.suggestBtn} onClick={() => setCentral({ path: suggestions.centralPath ?? '' })}>
              {t('git.suggest')}
            </button>
          )}
          <button
            type="button"
            className={styles.authBtn}
            disabled={busy || !settings.gitCentral?.path}
            onClick={toggleCentralAuth}
          >
            {settings.gitCentral?.authorized === true ? t('git.revoke') : t('git.authorize')}
          </button>
        </div>
        {settings.gitCentral?.path && settings.gitCentral?.authorized !== true && (
          <div className={styles.hint}>{t('git.needAuthorize')}</div>
        )}
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>{t('git.workspacesTitle')}</div>
        {workspaces.length === 0
          ? <div className={styles.hint}>{t('git.noWorkspaces')}</div>
          : workspaces.map((ws) => (
            <div key={ws.workspaceId} className={styles.wsRow}>
              <span className={styles.wsName}>{ws.name}</span>
              <input
                className={styles.input}
                placeholder={t('git.path')}
                value={settings.gitRepos?.[ws.workspaceId]?.path ?? ''}
                onChange={(e) => setWs(ws.workspaceId, { path: e.target.value })}
              />
              <input
                className={styles.input}
                placeholder={t('git.remotePlaceholder')}
                value={settings.gitRepos?.[ws.workspaceId]?.remote ?? ''}
                onChange={(e) => setWs(ws.workspaceId, { remote: e.target.value })}
              />
              {suggestions?.workspaces?.some((sg) => sg.workspaceId === ws.workspaceId) && (
                <button
                  type="button"
                  className={styles.suggestBtn}
                  onClick={() => {
                    const sg = suggestions.workspaces?.find((x) => x.workspaceId === ws.workspaceId)
                    if (sg) setWs(ws.workspaceId, { path: sg.path })
                  }}
                >
                  {t('git.suggest')}
                </button>
              )}
              <button
                type="button"
                className={styles.authBtn}
                disabled={busy || !settings.gitRepos?.[ws.workspaceId]?.path}
                onClick={() => toggleWsAuth(ws.workspaceId)}
              >
                {settings.gitRepos?.[ws.workspaceId]?.authorized === true ? t('git.revoke') : t('git.authorize')}
              </button>
            </div>
          ))}
      </div>

      <div className={styles.foot}>
        <span className={styles.msg}>{msg}</span>
        <button type="button" className={styles.saveBtn} disabled={busy} onClick={save}>
          {t('git.saveSettings')}
        </button>
      </div>
    </div>
  )
}
