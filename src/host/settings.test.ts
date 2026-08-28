import { describe, expect, it } from 'vitest'
import { mergeSettings } from './settings.ts'

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
