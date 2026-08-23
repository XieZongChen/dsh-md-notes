# 记入笔记异步写锁方案（docs/write-lock.md）

> 状态：✅ **已实现（0.6.0）**。host 通用 `KeyedLock`（`host/keyed-lock.ts`，write /
> appendConversation / delete 三操作互斥，冲突返回 `note-writing`）+ client 通用 busy 切片
> （`store.busy` + `BusyTracker`，见 [state.md](state.md) §4）。本文件保留方案原文
> （目标 / UI 联动 / 状态模型），实现与方案一致。

## 1. 背景与目标

「记入笔记」（`appendConversation`）与「保存」（`write`）都是对笔记文件的异步写操作，
耗时可能较长（读会话、拼分段、写盘）。当前实现存在两个问题：

1. **无互斥**：同一笔记可被并发写入（同一会话连续点击、不同会话同时记入），两次写
   互相覆盖/交错，文件内容不可预期。
2. **无全局可见性**：只有发起写的那个弹窗知道「正在写入」，笔记入口、笔记面板等
   位置不知道，用户可能去点另一个入口重复操作。

**目标**：把「笔记文件正在写入」提升为一等状态——host 端权威互斥（跨会话、进程内
并发安全）+ client 端全局状态镜像（所有 UI 位置自动联动），写入完成自动还原。

## 2. 需求摘要（UI 联动清单）

| 位置 | 写入中表现 |
|---|---|
| 记入笔记弹窗（NotePicker） | 正在写入的笔记**不可选中**，行尾显示 loading |
| 笔记入口（NotesEntry） | 只要有**任一**笔记在写 → 入口尾部显示 loading（位于「有新版本」tag **前面**）；hover tooltip「X 个笔记正在写入」 |
| 笔记面板（NotesManager）左栏行 | 该笔记行尾显示 loading 且**隐藏删除按钮**；仍可点击选中查看 |
| 笔记面板右侧操作栏 | 「编辑」Tab、更新、保存、推送**全部禁用**；更新按钮前方的提示位显示「**正在写入文件**」 |
| 写入结束（成功或失败） | 上述所有位置**自动还原**（无手动操作） |

互斥语义：**不区分会话**——同一笔记在写入期间，任何会话的记入/保存都被禁止
（host 端兜底拒绝 + client 端 UI 禁用）。

## 3. 架构总览

```
                    ┌────────────────────────────────────────┐
  NotePicker ──────▶│ client: NotesUiStore.busy: Record       │◀── useSyncExternalStore
  NotesManager ────▶│   noteKey → true                        │     订阅（3 个位置）
  （begin/end）     └───────────────┬────────────────────────┘
                                    │ API 调用
                    ┌───────────────▼────────────────────────┐
                    │ host: KeyedLock（进程内按 key 互斥）   │  权威互斥
                    │   write / appendConversation / delete  │  冲突返回 code:'note-writing'
                    │   acquire → 执行 → finally release     │
                    └────────────────────────────────────────┘
```

- **host 锁是权威**：真正保证「不能再对这个笔记写」。client 的 UI 禁用只是体验层，
  防不住绕过 UI 的调用；host 拒绝才是安全边界。
- **client 状态是镜像**：同一个页面里所有会话视图共享一份 store，跨会话 UI 联动
  天然成立；写入方 begin/end 自管理，写完成自动清掉，订阅位置自动还原。
- **不做轮询/事件流**：写入都由本 client 发起，begin/end 足够。跨设备/跨进程的
  写状态同步超出本期范围（见 §9）。

## 4. 写操作范围与 noteKey

**noteKey**：`${workspaceId}/${name}`（如 `5ea8fd52…/我的笔记.md`）。同一工作区不同
会话解析出相同 workspaceId → 跨会话命中同一把锁；不同工作区同名笔记互不影响。

**纳入锁的操作**（host 端统一处理，按 name 定位）：

| 操作 | 是否锁 | 理由 |
|---|---|---|
| `write`（保存） | ✅ | 直接改写文件内容 |
| `appendConversation`（记入笔记） | ✅ | 追加写入文件，本次需求的出发点 |
| `delete`（删除） | ✅ | 防「写删竞态」（写入进行中把文件删了） |
| `create`（新建） | ❌ | 目标文件尚不存在，无共享目标可冲突 |
| git push/pull | ❌ | 操作仓库 clone 而非笔记文件本身，另属 git 域 |

## 5. Host 端：权威写锁

### 5.1 锁（src/host/keyed-lock.ts，通用键控互斥）

```ts
// 进程内按 string key 互斥；笔记域 key = `${workspaceId}/${name}`（跨会话唯一）。
// 通用设计：未来其他资源域（git 工作树、导出）复用同一把锁，仅换 key 约定。
export interface KeyedLock {
  with<T>(key: string, task: () => Promise<T>): Promise<{ acquired: true; value: T } | { acquired: false }>
  isHeld(key: string): boolean
}
export function createKeyedLock(): KeyedLock {
  const held = new Set<string>()
  return {
    isHeld: (key) => held.has(key),
    async with(key, task) {
      if (held.has(key)) return { acquired: false }
      held.add(key)
      try { return { acquired: true, value: await task() } } finally { held.delete(key) }
    },
  }
}
```

实例在 apply 闭包创建（随插件卸载销毁），经 `NotesApiDeps.lock` 传入 handler。

### 5.2 接线点（src/host/http.ts）

`write` / `appendConversation` / `delete` 三个 case 先解析 noteKey 再走 `deps.lock.with`，
未获锁（`acquired: false`）返回 `note-writing`：

```ts
case 'write': {
  const dir = deps.resolveDir(workspaceId)
  if (dir === undefined) return { ok: false, code: 'no-workspace', ... }
  const lock = await deps.lock.with(`${workspaceId}/${name}`, () => writeNote(dir, name, String(req.content ?? '')))
  return lock.acquired ? lock.value : { ok: false, code: 'note-writing', error: 'The note is being written, try again later' }
}
// appendConversation / delete 同构
```

`note-writing` 错误码进 `gitErrorText`（client 端映射）：
中文「该笔记正在写入，请稍后再试」/ 英文 "This note is being written — try again shortly"。

### 5.3 并发语义

- **拒绝而非排队**：锁被占用时立即返回 `note-writing`。UI 已提前禁用，正常用户路径
  不会撞上；它只作为绕过 UI / 极端竞态（两个请求同时到达）的兜底。
- **进程内有效**：锁在 dsh web 进程内存中。跨进程/跨设备（两台机器同时写）无法靠
  它保证——那是 git 冲突机制的领域，见 §9。

## 6. Client 端：状态镜像（NotesUiStore 扩展）

### 6.1 状态定义（src/client/features/store.ts）——通用 busy 切片（可扩展，见 state.md §4）

```ts
export interface NotesUiState {
  managerOpen: boolean
  picker: { sessionId: string; messageId: string } | null
  /** 进行中任务：<域>/<资源> → true；笔记域键 note/<workspaceId>/<name>（详见 docs/state.md §4） */
  busy: Record<string, true>
}

// 派生只读量（busy.ts 提供，选择器计算，不入 state）：
// busyCount(s) = Object.keys(s.busy).length
// tracker.isBusy(noteKey(wsId, name))
```

### 6.2 写入口包装（src/client/features/busy.ts，通用 BusyTracker）

```ts
/**
 * 通用异步任务跟踪器（域无关，见 docs/state.md §4.2）：begin/end 幂等计数 +
 * finally 保证清理 + 聚合派生。笔记域经 `noteKey(wsId, name)` 接入；未来
 * git / export / 图片上传等任务域复用同一 tracker，仅换 key 前缀。
 */
export interface BusyTracker {
  /** 把 key 标记为 busy（同 key 幂等，计数制）。返回用于结束的 release。 */
  begin(key: string): () => void
  /** 执行一次受跟踪的任务：begin → task → finally release。 */
  run<T>(key: string, task: () => Promise<T>): Promise<T>
  /** key 是否正在执行。 */
  isBusy(key: string): boolean
  /** 正在执行的任务总数（全域）。 */
  count(): number
}

/** 笔记域资源键：note/<workspaceId>/<name>（跨会话唯一）。 */
export function noteKey(workspaceId: string, name: string): string {
  return `note/${workspaceId}/${name}`
}
```

实现要点：

- `begin` 幂等（同 key 重复 begin 只记一次，计数器制，避免嵌套调用提前释放）；
- 与 store 的关系：tracker 持有 store，begin/release 内部 `store.update(d => …)`（immer draft 增删 `d.busy[key]`）；组件只读 store，不直接碰 tracker 内部态。
- `run` 用 `try/finally` 保证成功、失败、异常三条路径都释放；
- 与 store 的关系：tracker 持有 store，`begin/release` 内部 `store.update(d => …)`
  （immer draft 增删 `d.busy[key]`）；组件只读 store，不直接碰 tracker 内部态。

### 6.3 调用点改造

```ts
// NotePicker.send()：记入笔记（文本由 client 从会话快照提取，见 docs/context.md §3.5）
const release = tracker.begin(key)
api('appendConversation', { noteName, workspaceId, questionText, answerText, sessionTitle, labels })
  .finally(release)          // 成功/失败都还原状态
  .then(res => { if (res.ok) { /* 现有 900ms 后关窗 */ } })

// NotesManager.save()：保存
const release = tracker.begin(key)
api('write', {...}).finally(release).then(...)

// delete（若纳入）：同构
```

`create` 不包（无目标 key，见 §4）。

## 7. UI 联动（三个位置逐条）

### 7.1 笔记入口（NotesEntry）

- 订阅 store 的 `busyCount`（NotesEntry 由「只写」变为「读写」，新增
  `useSyncExternalStore` 订阅，选择器为 busy.ts 导出的 `busyCount`）。
- 渲染：`entryMain` 之后、`updateTag` **之前**：

```tsx
{writingCount > 0 && (
  <Tooltip label={t('sidebar.writingTitle', { count: writingCount })} side="bottom">
    <span className={styles.writingIndicator}><LoadingIndicator size={12} /></span>
  </Tooltip>
)}
```

- 语义：**只要有任何笔记在写**就显示（与具体是哪个笔记无关）。

### 7.2 记入笔记弹窗（NotePicker）

- 行渲染：`tracker.isBusy(noteKey(...))` 的笔记行——点击不选中（`onClick` 直接 return）、加禁用
  样式（如降低不透明度）、行尾（`noteTime` 之后）渲染 `<LoadingIndicator size={12} />`。
- 「写入笔记」按钮无需额外处理（现有 `busy` 已覆盖发起后的态）；选中检查与禁用
  样式见验收标准。

### 7.3 笔记面板（NotesManager）

**左栏行**（noteItem）：

```tsx
// 行尾：writing 时 LoadingIndicator；删除按钮仅非 writing 时渲染
{isWriting(key) ? <span className={styles.noteWriting}><LoadingIndicator size={12} /></span>
  : <button className={styles.noteDel} onClick={...}>🗑</button>}
```

- 行本身仍可点击（`open` 不受影响）——用户可查看正在写入的笔记（只读预览）。

**右侧操作栏**（editorHead）：设 `const writingThis = selected 对应的 key 是否在 writing`：

| 控件 | 写入中 |
|---|---|
| 「预览」Tab | 保持可用（只读查看） |
| 「编辑」Tab | `disabled` |
| 更新按钮（git.update） | `disabled` |
| 保存按钮 | `disabled`（且由它发起写入时正处于 writing） |
| 推送按钮（git.push） | `disabled` |
| 提示位（remoteHint，更新按钮前方） | 强制显示，文案 `t('manager.writingFile')` =「正在写入文件」（优先级高于「远端有更新」提示） |

实现：`busy` 计算并入 `writingThis`；remoteHint 渲染条件改为
`writingThis || (showEditorGit && remoteChanged?.length > 0)`，文案按条件二选一。

### 7.4 新增 i18n key（zh/en 同步）

| key | 中文 | 英文 |
|---|---|---|
| `sidebar.writingTitle` | `{count} 个笔记正在写入` | `{count} note(s) writing` |
| `manager.writingFile` | `正在写入文件` | `Writing file…` |
| `git.noteWriting`（错误码 `note-writing`） | `该笔记正在写入，请稍后再试` | `This note is being written — try again shortly` |

## 8. 状态还原与失败处理

- **成功**：`.finally(release)` → store 移除 busy 项 → 三个位置（入口 loading、弹窗
  禁用、面板行/操作栏）随 uSES 订阅自动还原，无需手动刷新。
- **失败**：同路径还原（finally 保证）；错误提示仍按现有 `picker.writeFailed` /
  `manager.saveFailed` 展示。
- **异常**（网络断开、页面刷新）：HTTP 请求随页面终止，内存态 store/host 锁随
  进程自然消失，无残留；无需持久化（写入状态不该跨刷新存活）。

## 9. 边界与限制

- **跨设备/跨进程**：host 锁是进程内的。两台机器同时写同一笔记无法由它互斥——
  该场景由 Git 同步的冲突检测（`remote-changed`）覆盖。若未来要跨 client 实时广播
  「正在写入」，需 dsh 的 connection-stream 事件流（host 推送 → client 订阅），
  本期不做，接口上已预留（tracker 只管本地镜像）。
- **性能**：写入集合通常 0~1 个元素，选择器 `Object.keys` 开销可忽略。
- **host 锁与 git**：push/pull 不锁笔记文件（操作 clone 目录），与 write 的竞态窗口
  极小且后果可恢复（git 冲突机制兜底），本期不处理。

## 10. 验收标准

1. 记入笔记进行中：该笔记在弹窗不可选中 + 行尾 loading；入口 loading + tooltip
   数字正确；面板中该笔记行尾 loading、删除按钮隐藏、可点击查看；操作栏编辑/
   更新/保存/推送全禁用，提示位显示「正在写入文件」。
2. **换一个会话**打开记入弹窗：同一笔记同样不可选（跨会话互斥）。
3. 写入成功/失败后，三个位置全部自动还原，无残留 loading/禁用。
4. 绕过 UI 并发调用 write/appendConversation（同笔记）时，后者收到
   `code: 'note-writing'` 且文件内容未被破坏。
5. 明暗主题下 loading 与提示样式一致；中英文案齐全。
