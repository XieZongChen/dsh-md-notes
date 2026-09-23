#!/usr/bin/env node
/**
 * Memory-surface evaluation (docs/memory-eval.md).
 *
 * The question this answers: does letting the agent consult/grow its notes
 * actually improve its answers, or is the whole feature a bolt-on need?
 * Arguing about it is useless — this prepares a fixture whose facts exist ONLY
 * in the notes, and scores two arms of the same six questions:
 *
 *   control   — `agentTools: 'off'`   (no tools, no discovery notice)
 *   treatment — `agentTools: 'write'` (tools + one notice per session)
 *
 * Usage:
 *   node scripts/memory-eval.mjs prepare [dir]   # write the fixture + prompts
 *   node scripts/memory-eval.mjs score <dir>     # score saved answers
 *   node scripts/memory-eval.mjs --self-test     # check the scorer itself
 *
 * Answers are scored by required tokens (all must appear, case-insensitive), so
 * a correct answer is a fact a model cannot guess: every token is arbitrary.
 * A model that does not consult the notes can only hedge or hallucinate — both
 * are `miss` here, and the transcript is there for you to read.
 * @module dsh-md-notes/scripts/memory-eval
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The facts live here — repo files below must NOT contain any of them. */
const NOTES = {
  'deploy.md': [
    '# 发布窗口',
    '',
    '- 预发环境（staging）发布窗口：每周二 14:00-16:00（北京时间）。',
    '- 窗口外发布需要值班同学批，别自己开。',
  ].join('\n'),
  'clients.md': [
    '# 客户约定',
    '',
    '- Acme：报表时间一律用 UTC+8，且**不要出现秒**。',
    '- Beta：只接受 CSV，不接受 xlsx。',
  ].join('\n'),
  'banned.md': [
    '# 禁用依赖',
    '',
    '- `left-pad` 一律禁止（2025-03 供应链事故）。替代：直接实现 padding。',
  ].join('\n'),
  'env.md': [
    '# 环境速查',
    '',
    '- 本地测试库端口是 **55432**（不是默认的 5432）。',
    '- 本地 Redis 已下线，队列走 SQLite。',
  ].join('\n'),
  'people.md': [
    '# 找人',
    '',
    '- 线上事故第一步找 **Lin**（值班表在内部 wiki）。',
    '- 不要越级直接找 CTO。',
  ].join('\n'),
  'decisions.md': [
    '# 技术决策',
    '',
    '- 2025-06：决定**不引入 Redis**，改用 **SQLite** 队列（运维成本考虑）。',
  ].join('\n'),
}

/** One scored question. `expect` tokens are all required; `from` is the note. */
const TASKS = [
  { id: 1, from: 'deploy.md', prompt: '预发环境什么时候可以发布？', expect: ['周二', '14:00'] },
  { id: 2, from: 'clients.md', prompt: '给 Acme 做报表有什么要注意的？', expect: ['UTC+8', '秒'] },
  { id: 3, from: 'banned.md', prompt: '这个项目可以用 left-pad 吗？', expect: ['left-pad', '禁止'] },
  { id: 4, from: 'env.md', prompt: '本地测试库连哪个端口？', expect: ['55432'] },
  { id: 5, from: 'people.md', prompt: '线上出事故先找谁？', expect: ['Lin'] },
  { id: 6, from: 'decisions.md', prompt: '我们为什么不用 Redis？', expect: ['Redis', 'SQLite'] },
]

/** Files that make the fixture look like a real (fact-free) workspace. */
const REPO_FILES = {
  'README.md': [
    '# Eval workspace (fact-free on purpose)',
    '',
    'This workspace exists only for the memory eval. Its source of truth for any',
    'project question is `.dsh-notes/` — the repo itself states none of the facts',
    'the eval asks about.',
    '',
    'Run `node scripts/memory-eval.mjs score <dir>` from the plugin repo to score.',
  ].join('\n'),
  'src/index.js': [
    "export function main() {",
    "  return 'ok'",
    "}",
  ].join('\n'),
}

/** Case-insensitive "every token appears in the answer". */
export function scoreAnswer(answer, expect) {
  const text = String(answer ?? '').toLowerCase()
  const missing = expect.filter((token) => !text.includes(token.toLowerCase()))
  return { hit: missing.length === 0, missing }
}

/** Score both arms. `read(dir, arm, id)` supplies one answer's text. */
export function scoreArms(answers) {
  const rows = TASKS.map((task) => ({
    id: task.id,
    from: task.from,
    control: scoreAnswer(answers.control[task.id], task.expect),
    treatment: scoreAnswer(answers.treatment[task.id], task.expect),
  }))
  const hits = (arm) => rows.filter((row) => row[arm].hit).length
  const control = hits('control')
  const treatment = hits('treatment')
  // Pre-declared decision line (docs/memory-eval.md): do not move it after
  // seeing the numbers.
  const delta = treatment - control
  const verdict = delta >= 4 && treatment >= 5
    ? 'adopt'
    : delta <= 1
      ? 'pseudo-need'
      : 'inconclusive'
  return { rows, control, treatment, delta, verdict }
}

/** The two profile-patch snippets the operator pastes between arms. */
function patchSnippet(tier) {
  return [
    '# dsh-md-notes memory eval — paste into ~/.dsh/profiles/<profile>/cordis.patch.yml,',
    '# then RESTART dsh web (agentTools is a host-side deployment switch).',
    '- id: md-notes',
    '  config:',
    `    agentTools: '${tier}'`,
  ].join('\n')
}

async function prepare(target) {
  const dir = resolve(target ?? join(homedir(), 'dsh-notes-eval-workspace'))
  await mkdir(join(dir, '.dsh-notes'), { recursive: true })
  await mkdir(join(dir, 'src'), { recursive: true })
  for (const [name, content] of Object.entries(REPO_FILES)) {
    await writeFile(join(dir, name), `${content}\n`, 'utf8')
  }
  for (const [name, content] of Object.entries(NOTES)) {
    await writeFile(join(dir, '.dsh-notes', name), `${content}\n`, 'utf8')
  }
  await mkdir(join(dir, 'answers', 'control'), { recursive: true })
  await mkdir(join(dir, 'answers', 'treatment'), { recursive: true })
  const prompts = TASKS.map((task) => `${task.id}. ${task.prompt}`).join('\n')
  await writeFile(join(dir, 'answers', 'README.md'), [
    '# How to run the eval',
    '',
    '1. Add this directory as a dsh workspace (`' + dir + '`).',
    '2. Paste the CONTROL patch below into the profile patch, restart dsh web.',
    '3. In a NEW session in this workspace, send each prompt below. Save answer',
    '   `N` as `answers/control/N.txt` (just the assistant text).',
    '4. Paste the TREATMENT patch, restart, and repeat into `answers/treatment/N.txt`.',
    '5. `node <plugin-repo>/scripts/memory-eval.mjs score ' + dir + '`',
    '',
    '## Prompts',
    '',
    prompts,
    '',
    '## CONTROL patch',
    '',
    '```yaml',
    patchSnippet('off'),
    '```',
    '',
    '## TREATMENT patch',
    '',
    '```yaml',
    patchSnippet('write'),
    '```',
    '',
  ].join('\n'), 'utf8')

  process.stdout.write([
    `fixture written: ${dir}`,
    '',
    `next: register "${dir}" as a dsh workspace, then follow ${join(dir, 'answers', 'README.md')}`,
    '',
    'prompts:',
    prompts,
    '',
    'score with:',
    `  node ${fileURLToPath(import.meta.url)} score ${dir}`,
    '',
  ].join('\n'))
}

async function readAnswer(dir, arm, id) {
  const path = join(dir, 'answers', arm, `${id}.txt`)
  if (!existsSync(path)) return undefined
  return readFile(path, 'utf8')
}

async function score(dir) {
  const answers = { control: {}, treatment: {} }
  for (const task of TASKS) {
    answers.control[task.id] = await readAnswer(dir, 'control', task.id)
    answers.treatment[task.id] = await readAnswer(dir, 'treatment', task.id)
  }
  const report = scoreArms(answers)
  const cell = (result) => (result === undefined ? '  ?  ' : result.hit ? ' hit ' : ' miss')
  const lines = [
    `dir: ${resolve(dir)}`,
    '',
    '  #  note              control  treatment',
    '  -  ----------------  -------  ---------',
    ...report.rows.map((row) => `  ${row.id}  ${row.from.padEnd(16)}  ${cell(row.control)}    ${cell(row.treatment)}`),
    '',
    `hits: control ${report.control}/6   treatment ${report.treatment}/6   delta ${report.delta >= 0 ? '+' : ''}${report.delta}`,
    `verdict: ${report.verdict}`,
    '',
    report.verdict === 'adopt'
      ? 'The agent-usable surface demonstrably improves answers here. Keep investing in it (next: curation/provenance, docs/memory.md §4).'
      : report.verdict === 'pseudo-need'
        ? 'On the "better answers" axis this is a pseudo-need: stop adding features, and either keep it as a plain document manager (agentTools off) or archive it.'
        : 'Inconclusive: read the transcripts (answers/*/N.txt) before deciding — a token miss may be a wording difference rather than a wrong answer.',
    '',
    'missing tokens:',
    ...report.rows.flatMap((row) => [
      row.control.hit ? undefined : `  control   ${row.id} (${row.from}): ${row.control.missing.join(', ')}`,
      row.treatment.hit ? undefined : `  treatment ${row.id} (${row.from}): ${row.treatment.missing.join(', ')}`,
    ]).filter(Boolean),
    '',
  ]
  process.stdout.write(lines.join('\n'))
}

/** Synthetic check of the scorer + verdict thresholds (no files involved). */
function selfTest() {
  const perfect = { control: {}, treatment: {} }
  const none = { control: {}, treatment: {} }
  for (const task of TASKS) {
    perfect.control[task.id] = 'I do not know'
    perfect.treatment[task.id] = `${task.expect.join(' and ')}`
    none.control[task.id] = 'no idea'
    none.treatment[task.id] = 'still no idea'
  }
  const adopt = scoreArms(perfect)
  const pseudo = scoreArms(none)
  const failures = []
  if (adopt.control !== 0) failures.push(`control should be 0, got ${adopt.control}`)
  if (adopt.treatment !== 6) failures.push(`treatment should be 6, got ${adopt.treatment}`)
  if (adopt.verdict !== 'adopt') failures.push(`expected adopt, got ${adopt.verdict}`)
  if (pseudo.verdict !== 'pseudo-need') failures.push(`expected pseudo-need, got ${pseudo.verdict}`)
  const partial = { control: {}, treatment: {} }
  for (const task of TASKS) {
    partial.control[task.id] = task.expect.join(' ')
    partial.treatment[task.id] = task.expect.join(' ')
  }
  if (scoreArms(partial).verdict !== 'pseudo-need') failures.push('equal arms must read pseudo-need')
  if (failures.length > 0) {
    process.stderr.write(`self-test FAILED:\n${failures.map((f) => `  - ${f}`).join('\n')}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write('self-test ok (scorer + verdict thresholds)\n')
}

const [command, argument] = process.argv.slice(2)
if (command === 'prepare') await prepare(argument)
else if (command === 'score' && argument !== undefined) await score(argument)
else if (command === '--self-test') selfTest()
else {
  process.stdout.write([
    'usage:',
    '  node scripts/memory-eval.mjs prepare [dir]   # write fixture + prompts',
    '  node scripts/memory-eval.mjs score <dir>     # score saved answers',
    '  node scripts/memory-eval.mjs --self-test     # check the scorer itself',
    '',
    `default fixture dir: ${join(homedir(), 'dsh-notes-eval-workspace')}`,
    `module: ${dirname(fileURLToPath(import.meta.url))}`,
    '',
  ].join('\n'))
  if (command !== undefined) process.exitCode = 1
}
