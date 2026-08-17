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
// 只匹配块标题行本身（行首 `## NEXT_VERSION`），保留其下的分类标题（如 `### Added`）。
// 不用 indexOf 裸标题：记录规则正文里也会出现反引号包裹的 `## NEXT_VERSION`。
const marker = /^## NEXT_VERSION\n/m

for (const file of ['CHANGELOG.md', 'CHANGELOG.zh.md']) {
  const path = join(root, file)
  const s = readFileSync(path, 'utf8')
  if (!marker.test(s)) {
    console.error(`${file}: no top ${marker.source.trim()} block found — nothing to release`)
    process.exit(1)
  }
  const renamed = s.replace(marker, `## [${version}] - ${date}\n`)
  writeFileSync(path, renamed)
  console.log(`${file}: NEXT_VERSION → [${version}] - ${date}`)
}
