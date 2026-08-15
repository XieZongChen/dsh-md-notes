#!/usr/bin/env node
/**
 * 开发期类型链接：把 deepseek-harness checkout 的构建产物链接进本项目的
 * node_modules，让 TypeScript 能解析 @deepseek-ai/* 类型（文档 4.2 做法）。
 * 用法：node scripts/link-deps.mjs 或 pnpm run link-deps
 */
import { mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// 指向 deepseek-harness checkout（可用环境变量 DSH_CHECKOUT 覆盖；
// 默认解析为脚本目录上两级目录下的 deepseek-harness）
const checkout = resolve(process.env.DSH_CHECKOUT ?? join(root, '..', '..', 'deepseek-harness'))

const targets = [
  'vendor/cordis',
  'vendor/schemastery',
  'packages/client/runtime',
  'packages/client/ui-slots',
  'packages/client/ui-conversation',
  'packages/client/ui-sidebar',
  'packages/client/ui-layout',
  'packages/client/ui-primitives',
  'packages/core/session',
  'packages/session-query/session-query',
  'packages/sandbox/sandbox-policy',
  'packages/host/webserver',
  'packages/api/remotes',
]

const scopeDir = join(root, 'node_modules', '@deepseek-ai')
mkdirSync(scopeDir, { recursive: true })

for (const rel of targets) {
  const pkgPath = join(checkout, rel)
  let pkgName
  try {
    pkgName = JSON.parse(readFileSync(join(pkgPath, 'package.json'), 'utf8')).name
  } catch {
    console.warn(`skip (no package.json): ${rel}`)
    continue
  }
  if (typeof pkgName !== 'string') {
    console.warn(`skip (no name): ${rel}`)
    continue
  }
  const link = join(scopeDir, pkgName.replace('@deepseek-ai/', ''))
  rmSync(link, { recursive: true, force: true })
  symlinkSync(pkgPath, link, 'dir')
  console.log(`linked ${pkgName} -> ${pkgPath}`)
}

console.log('done')
