/**
 * Changelog release helper: rename the top `## NEXT_VERSION` block to a real
 * version (`[<version>] - <date>`) in both CHANGELOG.md and CHANGELOG.zh.md.
 *
 * It does NOT prepend a fresh NEXT_VERSION — a new block is only created on
 * demand when the next change lands (see the recording rules in the
 * changelogs). This keeps the changelog free of empty NEXT_VERSION blocks
 * while nothing is in development.
 *
 * Usage: node scripts/release-changelog.mjs <version>
 * (exposed as `npm run changelog:release -- <version>`)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error('usage: node scripts/release-changelog.mjs <semver> (e.g. 0.4.0)')
  process.exit(1)
}
const date = new Date().toLocaleDateString('en-CA') // local YYYY-MM-DD
const marker = '## NEXT_VERSION\n\n### Added'

for (const file of ['CHANGELOG.md', 'CHANGELOG.zh.md']) {
  const path = join(root, file)
  const s = readFileSync(path, 'utf8')
  const idx = s.indexOf(marker)
  if (idx === -1) {
    console.error(`${file}: no top ${marker.trim()} block found — nothing to release`)
    process.exit(1)
  }
  const renamed = s.slice(0, idx) + `## [${version}] - ${date}` + s.slice(idx + marker.length)
  writeFileSync(path, renamed)
  console.log(`${file}: NEXT_VERSION → [${version}] - ${date}`)
}
