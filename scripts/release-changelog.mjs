/**
 * Changelog release helper: rename the top `## NEXT_VERSION` block to a real
 * version (`[<version>] - <date>`) in both CHANGELOG.md and CHANGELOG.zh.md,
 * then prepend a fresh empty `NEXT_VERSION` block.
 *
 * The fresh block is inserted right before the (renamed) first version block —
 * i.e. after the header + rules — so the rules' own `## NEXT_VERSION` mention
 * (inside the rules prose) is never touched.
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
  // Rename this (the real version block) to the released version.
  const renamed = s.slice(0, idx) + `## [${version}] - ${date}` + s.slice(idx + marker.length)
  // Insert a fresh empty NEXT_VERSION right before the renamed block, so it
  // stays the top-most version block under the header/rules.
  const at = renamed.indexOf(`## [${version}] - ${date}`)
  const head = renamed.slice(0, at)
  const rest = renamed.slice(at)
  const fresh = `${head}## NEXT_VERSION\n\n### Added\n\n${rest}`
  writeFileSync(path, fresh)
  console.log(`${file}: NEXT_VERSION → [${version}] - ${date}, fresh NEXT_VERSION prepended`)
}
