import { describe, expect, it } from 'vitest'
import {
  configPatchFromSettings, mergeOverrides, mergeSettings, overridesFromConfig,
} from './settings.ts'

describe('mergeSettings', () => {
  it('defaults to off + autoPull true', () => {
    expect(mergeSettings({}, undefined)).toMatchObject({ gitMode: 'off', gitAutoPull: true })
  })

  it('keeps shared mode + central remote/branch', () => {
    const s = mergeSettings({ gitMode: 'shared', gitCentralRemote: 'https://x', gitCentralBranch: 'main' }, undefined)
    expect(s).toMatchObject({ gitMode: 'shared', gitCentral: { remote: 'https://x', branch: 'main' } })
  })

  it("normalizes legacy 'on' to shared when a central remote is set", () => {
    expect(mergeSettings({ gitMode: 'on', gitCentralRemote: 'https://x' }, undefined).gitMode).toBe('shared')
  })

  it("normalizes legacy 'on' to own without a central remote", () => {
    expect(mergeSettings({ gitMode: 'on' }, undefined).gitMode).toBe('own')
  })

  it('L3 overrides L2 for top-level scalars', () => {
    const s = mergeSettings(
      { gitMode: 'off', gitAutoPull: true },
      { gitMode: 'shared', gitAutoPull: false, gitCentral: { remote: 'https://l3' } },
    )
    expect(s).toMatchObject({ gitMode: 'shared', gitAutoPull: false, gitCentral: { remote: 'https://l3' } })
  })

  it('merges per-workspace repos key-wise (L3 wins per key)', () => {
    const s = mergeSettings(
      { gitRepos: { a: { remote: 'https://a-cfg' }, b: { remote: 'https://b-cfg' } } },
      { gitRepos: { b: { remote: 'https://b-l3' }, c: { remote: 'https://c-l3' } } },
    )
    expect(s.gitRepos).toEqual({
      a: { remote: 'https://a-cfg' },
      b: { remote: 'https://b-l3' },
      c: { remote: 'https://c-l3' },
    })
  })
})

describe('mergeSettings — gitCentral.branch empty-string semantics (§12 #17)', () => {
  it('an empty L3 branch falls back to the L2 branch (empty = unset, not "clear")', () => {
    const s = mergeSettings({ gitCentralBranch: 'main' }, { gitCentral: { remote: 'https://x', branch: '' } })
    expect(s.gitCentral?.branch).toBe('main')
  })

  it('a whitespace-only L3 branch falls back too; both unset leaves undefined', () => {
    const s = mergeSettings({ gitCentralBranch: 'dev' }, { gitCentral: { remote: 'https://x', branch: '   ' } })
    expect(s.gitCentral?.branch).toBe('dev')
    const none = mergeSettings({}, { gitCentral: { remote: 'https://x', branch: '' } })
    expect(none.gitCentral?.branch).toBeUndefined()
  })
})

describe('overridesFromConfig (dsh 0.1.7 profile-patch user layer)', () => {
  it('maps the Config keys the profile patch stores into the client shape', () => {
    expect(overridesFromConfig({
      gitMode: 'shared', gitCentralRemote: 'https://x', gitCentralBranch: 'main',
      gitAutoPull: false, gitAuthorName: 'A', gitAuthorEmail: 'a@x',
      gitRepos: { w1: { remote: 'u' } },
    })).toEqual({
      gitMode: 'shared',
      gitCentral: { remote: 'https://x', branch: 'main' },
      gitAutoPull: false,
      gitAuthorName: 'A',
      gitAuthorEmail: 'a@x',
      gitRepos: { w1: { remote: 'u' } },
    })
  })

  it('omits gitCentral when neither flat field is set', () => {
    expect(overridesFromConfig({ gitMode: 'off' })?.gitCentral).toBeUndefined()
  })

  it('treats a missing or non-object patch as "no overrides"', () => {
    expect(overridesFromConfig(undefined)).toBeUndefined()
    expect(overridesFromConfig(null)).toBeUndefined()
    expect(overridesFromConfig([])).toBeUndefined()
    expect(overridesFromConfig('x')).toBeUndefined()
  })

  it('drops values of the wrong type instead of passing them through', () => {
    const wrong = overridesFromConfig({ gitMode: 7, gitAutoPull: 'yes', gitAuthorName: 5, gitRepos: [] })
    expect(wrong?.gitMode).toBeUndefined()
    expect(wrong?.gitAutoPull).toBeUndefined()
    expect(wrong?.gitAuthorName).toBeUndefined()
    expect(wrong?.gitRepos).toBeUndefined()
  })
})

describe('configPatchFromSettings (client patch → Config keys)', () => {
  it('flattens gitCentral and keeps the whitelisted scalars', () => {
    expect(configPatchFromSettings({
      gitMode: 'own', gitCentral: { remote: 'https://x', branch: 'dev' },
      gitRepos: { w1: { remote: 'u' } }, gitAutoPull: true,
      gitAuthorName: 'A', gitAuthorEmail: 'a@x',
    })).toEqual({
      gitMode: 'own', gitCentralRemote: 'https://x', gitCentralBranch: 'dev',
      gitRepos: { w1: { remote: 'u' } }, gitAutoPull: true,
      gitAuthorName: 'A', gitAuthorEmail: 'a@x',
    })
  })

  it('drops unknown keys (only Config-declared fields may be written)', () => {
    expect(configPatchFromSettings({ route: '/evil', checkUpdate: false, gitMode: 'off' }))
      .toEqual({ gitMode: 'off' })
  })

  it('ignores a non-object gitCentral and only sets the fields it was given', () => {
    expect(configPatchFromSettings({ gitCentral: null })).toEqual({})
    expect(configPatchFromSettings({ gitCentral: { remote: 'u' } })).toEqual({ gitCentralRemote: 'u' })
  })
})

describe('mergeOverrides (write-through view)', () => {
  it('merges scalars, gitCentral and gitRepos over the current view', () => {
    const next = mergeOverrides(
      { gitMode: 'off', gitCentral: { remote: 'old', branch: 'main' }, gitRepos: { w1: { remote: 'a' } } },
      { gitMode: 'own', gitCentral: { remote: 'new' }, gitRepos: { w2: { remote: 'b' } } },
    )
    expect(next.gitMode).toBe('own')
    expect(next.gitCentral).toEqual({ remote: 'new', branch: 'main' })
    expect(next.gitRepos).toEqual({ w1: { remote: 'a' }, w2: { remote: 'b' } })
  })

  it('starts from an empty view and ignores undefined values', () => {
    expect(mergeOverrides(undefined, { gitMode: 'shared', gitAuthorName: undefined }))
      .toEqual({ gitMode: 'shared' })
  })
})
