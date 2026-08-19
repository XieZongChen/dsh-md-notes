# 状态管理方案（docs/state.md）

> dsh-md-notes 的状态分层、能力选型与异步操作跟踪的总纲。新增任何状态前先读本文；
> 第一个异步跟踪落地实例见 [write-lock.md](write-lock.md)。

## 1. 为什么需要一份总纲

插件状态正在从「几个 useState」走向「跨插槽共享 + 异步操作 + 未来功能（搜索/星标/
TOC…）」的规模。没有约定时容易出的问题：状态散落导致跨组件传参膨胀、同类状态用
不同机制维护、异步状态忘记清理、持久化 key 冲突。本文把规则固定下来，加状态时
照表执行。

## 2. 状态分层模型

所有状态先归类到四层之一，层决定「用什么机制」：

| 层 | 定义 | 生命周期 | 机制 |
|---|---|---|---|
| **L0 组件局部** | 只被一个组件读写 | 组件挂载/卸载 | `useState` / `useRef` |
| **L1 插件全局** | 跨插槽/跨会话共享 | 插件挂载/卸载 | `createSnapshotStore` 单例 或 `defineStore` + root 座位 |
| **L2 面板内共享** | 仅在笔记面板内跨子组件（面板拆分后出现） | 面板打开/关闭 | `defineStore` + root 座位 或 React Context |
| **L3 host 服务端** | 服务端缓存/互斥（不参与渲染） | 插件挂载/卸载（apply 闭包） | 普通 Map/闭包变量 |

**判定口诀**：跨组件吗？→ 不跨 = L0。跨 → 要持久化/按会话隔离吗？→ 要 = L1 座位
（§3 路径 1）；不要 = L1 单例（§3 路径 2）。面板拆分后属于「面板内」的归 L2。
服务端互斥/缓存归 L3。

## 3. dsh 能力选型与隔离决策

dsh 提供的三种能力（同一引擎：zustand + immer）：

| 能力 | 隔离/生命周期 | 持久化 | 用在哪层 |
|---|---|---|---|
| `useState`/`useRef` | 组件级 | ❌ | L0 |
| `createSnapshotStore` | **无框架托管**（手动单例） | 可选 `persist:{name}`（裸 key） | L1 瞬时全局 |
| `defineStore` + register `store:` 座位 | 框架托管：实例唯一、卸载释放、**scope 隔离**、persist 自动清理 | 框架管（session 实例 key 自动加后缀） | L1 持久化全局 / L2 / 按会话 |

### 3.1 关键事实：隔离由「挂载位置」决定，不是状态开关

- store 挂在 **root 插槽** → 全应用 **1 个实例**（无隔离）
- store 挂在 **session 插槽** → **每会话 1 个实例**（隔离）
- **同一 handle 跨 root + session 插槽注册会抛错**（框架拒绝语义冲突的归属）

### 3.2 三条路径

- **路径 1（首选）**：状态全局/面板级，且**只被同一 scope 的插槽读写**
  → `defineStore` + 该插槽的 `store:` 座位。框架白送实例唯一、生命周期、持久化清理。
- **路径 2（现状）**：状态全局，但**需要跨 scope 读写**（如 `picker` 被 session 插槽
  的「记入笔记」按钮触发，挂在 root 的 overlay 消费）
  → `createSnapshotStore` 在 apply 里建 **root 单例** + props 手动注入。
  这是官方 session-log-export 同款模式。
- **路径 3（升级可选）**：路径 2 想要「命名动作审计」
  → `defineStore` 声明 + `handle.create()` 手动取 root 实例（放弃框架托管，等价于
  路径 2 + actions 写集）。当前不必要。

### 3.3 半隔离（默认全局、个别会话覆盖）——不支持，也不做

dsh 只有「全隔离 / 全不隔离」两档。需要时自行组合 root 默认层 + session 覆盖层。
当前无此需求，YAGNI。

## 4. 异步操作状态跟踪（通用抽象）

写文件、git 操作、未来导入导出都属于「进行中的异步任务」——它们有一致的管理模式，
抽成一条通用规则，`write-lock.md` 的写锁是第一个实例。

### 4.1 通用模型：busy map + 聚合派生 + finally 清理

```
state:  busy: Record<resourceKey, true>     // 哪些资源正在进行任务
派生:   busyCount = size(busy)              // 全局指示（入口 loading、tooltip 数字）
        isBusy(key)                         // 资源级指示（禁用/隐藏/行内 loading）
```

**五条铁律**：

1. **资源键稳定唯一**：`${scopeQualifier}/${resourceName}`（写锁用
   `workspaceId/name`）；所有读它/写它的位置用同一个 key 构造函数。
2. **begin/end 成对且幂等**：begin 用计数制（同 key 嵌套 begin 只记一次），
   end 配平后才从 busy 移除。
3. **finally 保证清理**：成功、业务失败、异常三条路径都释放——
   `run(key, task)` 包装器内聚这条规则，调用方不允许手写 begin/finally。
4. **不持久化**：busy 是瞬时态，页面刷新/进程重启自然清零；持久化 busy 是 bug。
5. **互斥在服务端兜底**：client 的 busy 只管 UI；真正的「不可并发」由 host 端锁
   （L3）保证，冲突返回错误码，client 映射为本地化文案。

### 4.2 通用包装器形态（每类任务一个 tracker）

```ts
// 形态约定（写锁实例见 docs/write-lock.md §6.2；未来 git/import 任务同构）
interface BusyTracker {
  begin(key: string): () => void          // 幂等 begin，返回 release
  run<T>(key: string, task: () => Promise<T>): Promise<T>   // begin + finally release
  isBusy(key: string): boolean
  count(): number
}
```

### 4.3 UI 联动约定（busy 的消费端）

- **全局聚合**（任何资源 busy 就出现）：入口级 loading + tooltip「X 个…」；
  文案 key 带 `{count}` 参数，中英双写。
- **资源级**（指定 key busy）：
  - 列表行 → 行尾小 loading，**隐藏会改变资源归属的动作**（删除/重命名）；
  - 操作栏 → 该资源相关的写动作全部禁用，只读路径保持可用；
  - 冲突提示位 → 显示「正在写入/处理中」文案（优先级高于普通提醒）。
- 结束后**所有位置自动还原**（uSES 订阅，禁止手动 setState 刷新）。

## 5. 新增状态的决策清单

按顺序问，全答完就知道怎么落地：

1. 它被几个组件读写？ → 一个 = L0 `useState`；多个 = 往下。
2. 它属于「整个插件」还是「面板内」还是「服务端」？ → 面板内（且面板已拆子组件）
   或插件全局 = client 状态；服务端互斥/缓存 = L3 闭包。
3. 要持久化或按会话隔离吗？ → 要 + 只被单一 scope 插槽读写 = **路径 1**（defineStore
   + root 座位，或 session 座位做按会话）；要 + 跨 scope 读写 = 路径 3（defineStore
   + 手动 root 实例）；不要 = **路径 2**（createSnapshotStore 单例）。
4. 是「进行中的异步任务」吗？ → 按 §4 的 busy 模型入 track，host 端配套互斥。
5. 命名与文案：key 构造函数集中一处；i18n key 中英同键；持久化 name 加
   `md-notes.` 前缀防冲突。

## 6. 当前状态清单

| 状态 | 层 | 机制 | 备注 |
|---|---|---|---|
| `managerOpen` / `picker` | L1 | createSnapshotStore 单例（路径 2） | 跨 scope（session 按钮写） |
| `busy`（写入互斥镜像） | L1 | store.busy 通用切片 + BusyTracker（`src/client/features/busy.ts`） | 域前缀 `note/<ws>/<name>`；host 权威锁在 L3（KeyedLock） |
| update-available | L1 | update.ts 模块级 promise | 请求级缓存（非可订阅状态）：语义「每页面加载查一次」，各组件 hook 各自订阅结果；模块级引用的 HMR 残留影响仅限「本页面不重查」，可接受 |
| NotesManager 的 useState/useRef（22+ 个） | L0 | useState | 数据加载/选中/保存反馈/git 组 |
| NotePicker / Settings 的 useState | L0 | useState | 弹窗与设置表单局部 |
| host npm 版本缓存 `updateCache` | L3 | apply 闭包 | 10 分钟缓存 |
| context-inject per-session 缓存 | L3 | host 闭包 Map | 引用注入去重 |
| 笔记写互斥锁 `KeyedLock` | L3 | apply 闭包（`src/host/keyed-lock.ts`） | 进程内按 key 互斥，写锁的权威层（client busy 只是镜像） |

## 7. 未来状态预分配（TODO 4.x）

| 功能 | 状态 | 层/机制 |
|---|---|---|
| 4.4 星标 | 全局 + 持久化，仅管理器读写 | L1 路径 1（defineStore + root 座位，persist `md-notes.star`） |
| 4.4 最近笔记 | 同上 | 同上（或并入星标 store） |
| 4.1 搜索词/结果/高亮 | 面板内跨子组件 | L2（面板拆分后 defineStore 座位 / React Context） |
| 4.2 TOC 展开态/当前标题 | 面板内 | L2 |
| 4.3 反链列表 | 面板内、按笔记 | L2 |
| 4.5 自动保存 timer/字数 | 编辑器局部 | L0 |
| 4.6 图片上传进度 | 弹窗局部 → busy 模型 | L0 → 迁移 §4 tracker |
| 4.7 导出进度 | 全局 busy | §4 tracker + host 任务 |

## 8. 维护约定

- 状态定义集中在 `src/client/features/store.ts`（L1）与各组件顶部（L0）；
  L2 诞生后建 `src/client/features/panel-store.ts` 之类独立文件，不塞进全局 store。
- tracker 文件与业务解耦（`write-track.ts` 不含业务判断），业务层只调 begin/run。
- 每次新增 L1/L2 状态，更新本文 §6/§7 的清单（文档与代码同步）。
- 违背「五条铁律」的代码在 review 时视为缺陷（尤其 finally 清理与不持久化两条）。
