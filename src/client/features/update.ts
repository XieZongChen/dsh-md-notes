/**
 * Shared "update available" state for the sidebar entry and the notes manager.
 * The host checks the npm registry (cached); components call `useUpdateAvailable`
 * on mount and all share the same in-flight/result via a module-level promise.
 * @module dsh-md-notes/client/update
 */

import * as React from 'react'
import { checkUpdateApi } from './api.ts'

export interface UpdateInfo {
  current: string
  latest: string
}

let shared: Promise<UpdateInfo | null> | null = null

/** Fetch the update info once per page load; null = no update or check failed. */
function loadUpdate(): Promise<UpdateInfo | null> {
  if (shared === null) {
    shared = checkUpdateApi().then((res) => {
      if (res.ok && res.update?.hasUpdate === true) {
        return { current: res.update.current, latest: res.update.latest }
      }
      return null
    }).catch(() => null)
  }
  return shared
}

/**
 * Subscribe to the update-available state. Returns null while unknown/no
 * update, otherwise the version info.
 */
export function useUpdateAvailable(): UpdateInfo | null {
  const [info, setInfo] = React.useState<UpdateInfo | null>(null)
  React.useEffect(() => {
    let alive = true
    void loadUpdate().then((r) => { if (alive) setInfo(r) })
    return () => { alive = false }
  }, [])
  return info
}
