# dsh-md-notes 代码规范

> 本仓库的统一编码规范与架构护栏。目标：在功能与代码量继续增长之前，把「每类代码该放哪、
> 该怎么写、违背了什么就算缺陷」固定成可执行规则，避免项目在变大过程中逐步变乱。
>
> 本文是**规范（normative）**：新代码必须遵守；修改现有代码时顺带把触碰到的部分向规范靠拢。
> 已有的设计文档仍各自负责自己的领域——状态分层看 [state.md](state.md)，写锁看
> [write-lock.md](write-lock.md)，架构与目录看 [architecture.md](architecture.md)。本文在它们
> 之上补齐「怎么写对、怎么不写坏」的通用规则，并附录一份**当前隐患清单**（§12）与每条的处置映射。

---

## 0. 一句话原则

- **分层清晰**：领域逻辑（纯函数）→ HTTP/装配层 → 插件入口，职责单向递减。
- **副作用可逆**：一切注册、监听、定时器、样式注入都挂在 `ctx.effect` 上，卸载自动清理。
- **单一事实来源**：图标、i18n 文案、host 错误码各只有一处权威定义，其余位置引用。
- **防御性输入**：任何来自请求/用户的名称、路径、文本，进入文件系统前必须先消毒/边界校验。
- **类型安全**：host↔client 契约用明确类型表达，不用「大杂烩 optional 字段」猜。
- **文档与代码同步**：新增功能/状态/错误码，同时更新对应 docs 与 CHANGELOG。

---

## 1. 目录与模块边界

### 1.1 两半严格分离

- `src/` 是 **host 半**（Node 进程），`src/client/` 是 **client 半**（浏览器），由两个 tsconfig
  程序分别编译（`tsconfig.json` exclude `src/client`；`tsconfig.client.json` 只 include `src/client`）。
  **两者不得互相 import**——这是两个 TS program 的硬边界。
- host 可用的全局（`process`、`node:*`、`fetch` 服务端）不得出现在 client；`window`/`document`/
  `DOM` API 不得出现在 host。

### 1.2 host 分层（`src/`）

| 层 | 目录 | 职责 | 禁止 |
|---|---|---|---|
| 领域逻辑 | `host/notes.ts`、`host/git.ts`、`host/settings.ts`、`host/keyed-lock.ts`、`host/context-inject.ts` | 纯业务：文件操作、git、设置合并、互斥、注入 | 不直接读写 `ctx.webServer`/HTTP 细节 |
| HTTP 装配 | `host/http.ts` | `readBody`/`sendJson`、method 分发、错误码出口 | 不包含领域细节（只调领域函数） |
| 入口装配 | `index.ts` | `name`/`inject`/`Config`/`apply`，把依赖装配进 handler | 不写业务逻辑 |

- **新领域**：新增一个 `host/<domain>.ts`（如未来「搜索」→ `host/search.ts`），在 `http.ts`
  加 method case，在 `index.ts` 把依赖注入 `NotesApiDeps`。不要把所有逻辑堆进 `http.ts` 或 `index.ts`。
- **领域函数尽量纯**：目录/仓库以参数注入（如 `notes.ts` 全部函数），不直接持有 `ctx`；需要
  `ctx` 的（`runGit`、`gitInit`）以 `ctx` 为首参显式传入。这样领域逻辑可单测（§11）。
- **通用工具**独立成模块（`keyed-lock.ts` 已示范）：与业务解耦、写清 key 约定、可被未来域复用。

### 1.3 client 分层（`src/client/`）

- 入口 `index.ts` 只做装配（建 store/tracker、绑 locale、注册 slot），**不写 JSX**。
- `features/` 下每个功能一个子目录（PascalCase：`NotePicker/`、`NotesManager/`、`ContextSource/`），
  目录内 `.tsx` + 同名前缀的 `.module.css`（kebab-case：`note-picker.module.css`）。
- `features/components/` 放跨功能复用的纯展示组件（`DshInput`/`DshSelect`/`LoadingIndicator`）。
- `features/` 根放共享模块：`api.ts`（HTTP 封装）、`store.ts`（全局状态）、`busy.ts`（任务跟踪）、
  `note-text.ts`/`markdown.ts`（纯函数工具）、`locales/`、`styles.module.css`（共享样式）。

**规则**：

- 一个功能目录 = 一个对内聚的责任；文件超过 ~250 行就开始考虑拆子组件或自定义 hook
  （`NotesManager.tsx` 目前 ~620 行，已越界，见 §12 隐患 #5）。
- 两个功能目录出现**同一段 JSX/逻辑**时，抽取到 `components/` 或共享模块，禁止复制粘贴
  （当前 `NotePicker` 与 `NotesManager` 的「按工作区分组列表」重复，见 §12 #8）。

---

## 2. 命名与语言

### 2.1 命名

- **目录**：host 模块 `kebab-case`（`context-inject.ts`）；client 功能/组件目录 `PascalCase`；
  css 文件 `kebab-case`（与组件同名）。
- **文件**：组件 `PascalCase.tsx`；非组件模块 `kebab-case.ts`。
- **类型/接口**：`PascalCase`（`NoteSummary`、`ResolvedRepo`）；**常量**：`UPPER_SNAKE_CASE`
  或 `PascalCase` 命名空间导出（`MD_NOTES_NS`、`NOTE_CONTEXT_SOURCE`）。
- **函数/变量**：`camelCase`。布尔用问句/前缀（`isBusy`、`hasWorkspaces`、`acquired`）。
- **i18n key**：`域.小写驼峰`（`git.errSyncBranch`、`manager.untitled`、`context.noteMissing`），
  新增域沿用既有前缀，不造新顶层域。
- **busy/锁的资源 key**：`<域>/<scope>/<资源>`，构造函数集中一处导出（`noteKey(wsId, name)`），
  所有读写位置都用它，禁止内联字符串拼接（见 §7.3 与 state.md 铁律 1）。

### 2.2 语言分工

- **代码注释、commit message、CHANGELOG（英文版）、PR 描述**：英文。
- **设计文档（docs/*.md）**：中文（现状约定），关键术语保留英文原文。
- **面向用户文档**：`usage.md` / `usage.zh.md` 中英双份，改动必须同步两份。
- **CHANGELOG**：`CHANGELOG.md` / `CHANGELOG.zh.md` 中英双份，同步更新。
- **i18n 文案**：`zh.ts` 是源字典（key 的权威全集），`en.ts` 用映射类型强制同键，缺失即编译报错。

> 反例：`NotesManager.tsx` 内残留一段中文注释（`// ok 分支把 pushing 的生命周期…`），
> 应改为英文或删除（见 §12 #10）。

---

## 3. TypeScript 约定

- **strict 全开**（已开启）+ `noUncheckedIndexedAccess` + `noUnusedLocals` + `noUnusedParameters`：
  不得用 `// @ts-ignore` 或局部放宽绕过；确需放宽时用精确的 `as unknown as X` 并写一行注释说明
  （参考 `ContextSource` 里 `appearance: 'notes' as unknown as 'file'` 的写法）。
- **`any` 禁用**；`unknown` 仅用于「外部边界收窄」（JSON 反序列化、服务接口断言），并在同一函数内
  收窄到具体类型。对外部服务用**最小接口**（`WebServerLike`/`SubprocessLike`）而非 `any`。
- **声明合并**（`declare module`）只用于给平台补类型（`LocaleNamespaceMap`、`MessageSourceMap`），
  集中放在相关模块顶部并注明作用。
- **类型共享**：host 与 client 公用的实体（`NoteSummary`、`GitStatusData`、`GitSettingsData`、
  `RepoSettings`）目前**两边各写一份**，是漂移隐患（§12 #6）。规则：新增共享实体时，先在
  `src/host/` 定义权威类型，client 侧 `import type` 引用（前提是 tsconfig 边界允许——若两个
  program 无法共享，则至少在两处加注释互相指向对方文件，避免静默漂移）。目标是在不破坏两
  program 隔离的前提下逐步收敛到一份。
- **API 结果类型**：用**可辨识联合（discriminated union）**按 method 精确表达，禁止
  「一个 `ok:true` 分支塞十几个 optional 字段」（当前 `ApiResult` 是反例，见 §12 #7）。
  新增 method 时应给出该 method 的专属返回类型。

---

## 4. Host 侧规范

### 4.1 服务获取

- 可选服务用 `ctx.get('serviceName')` 并**处理 `undefined`**（服务缺失时特性静默降级并留一行
  `console.warn`/注释）；只有硬依赖才列进 `inject`（`index.ts` 的 `inject: ['webServer', 'settings']`）。
- 读 `ctx.xxx` 前必须先在 `inject` 声明；未声明的服务一律走 `ctx.get`。

### 4.2 副作用

- 所有副作用（路由注册、settings 注册、事件监听、样式）包 `ctx.effect(fn, 'label')`，label 命名
  `dsh-md-notes: <what>`（现状已遵守）。`ctx.on` 的返回 disposer 交给 `ctx.effect` 管理
  （`registerNoteContextInjection` 已示范）。
- **模块级可变缓存禁止无清理地裸放在模块顶层**（`git.ts` 的 `fetchCache` 是反例，§12 #12）：
  需要跨请求缓存时，放进 `apply` 闭包或给 Map 加 TTL 清理；随插件生命周期销毁。

### 4.3 输入安全（必须）

- **任何来自请求体的名称/路径，写文件前必须过 `sanitizeName`/边界校验**。`write`/`read`/`delete`
  已做，但 `appendConversation` 的 `noteName` **未消毒**（§12 #1），属必须修复项。
- 路径拼接一律用 `node:path` 的 `join`/`resolve`，禁止字符串拼接（`/` 拼路径）。
- 读文件边界：`context-inject.ts` 已做 `.dsh-notes` 目录内校验（`/(^|[\\/])\.dsh-notes[\\/]/`），
  任何「按请求读文件」的新能力都要复刻同款边界校验。
- 请求体大小有界（`readBody` 2MB），新增读 body 的能力沿用。

### 4.4 错误与错误码

- host 对**业务失败**返回 `{ ok: false, code, error }`：`code` 是机器可读的短横线码（`no-repo`、
  `sync-branch`、`remote-changed`、`non-fast-forward`、`note-writing`），`error` 是**英文 detail**
  （供日志/回退显示），**绝不返回面向用户的本地化文案**——本地化由 client `gitErrorText` 完成。
- 可预期的 git 失败用 `GitError(code, message)` 抛出，`http.ts` 统一转 `code`；**新增错误码**必须：
  1) host 常量/字符串集中；2) client `gitErrorText` 加 case + zh/en 文案；3) 记录到 §12 的映射。
- **不得在 client 侧残留死 code**：`gitErrorText` 里 `push-failed`、`merge-unrelated` 两个码 host
  从不返回，应删除（§12 #11）。
- HTTP 层：method 分发集中在 `handleApi`；未识别的 method 返回 `unknown method`；handler 只负责
  try/catch 兜底转 500（当前 500 与 200-业务失败 的语义要区分清楚，client `api()` 先看 HTTP
  status 再看 `ok` 字段）。

### 4.5 并发与锁

- **笔记写互斥**：`write`/`appendConversation`/`delete` 必须走 `deps.lock.with(key, …)`，`create`
  不锁（无目标文件）。host 锁是权威，client busy 只是镜像（write-lock.md）。
- **git 操作必须串行化**：目前 `gitInit/gitStatus/gitPush/gitPull/gitSync` 对**同一 clone 目录**
  没有任何互斥，两个并发推送/拉取会 race（`checkout`/`add`/`commit`/`push` 交叠），shared 模式下
  多工作区共享同一 clone 尤其危险（§12 #2）。规则：按 `repo.repoDir` 新增一把进程内锁
  （复用 `KeyedLock`，key = `repo/<repoDir>`），所有会改动 clone 状态的 git 入口串行执行；
  `fetch` 的 TTL 去重保持现状但移入 apply 闭包。
- 所有 `try { await } finally { cleanup }` 的清理逻辑（timer、abort、busy 释放）必须在 finally，
  成功/失败/异常三路径都释放（§7.3 同理）。

### 4.6 设置三层模型

- 读设置只通过 `mergeSettings(config, scope.get())`，不直接读 `scope.get()` 拼字段。
- 写设置只通过 `gitConfig` 的**白名单数组**，新增可写字段同步扩展白名单（当前
  `allowed` 数组在 `http.ts` 内硬编码）。
- 新增 L2/L3 设置项，同步更新 `Config` schema、`MdNotesSettings`/`MdNotesSettingsSchema`、
  `mergeSettings`、client `GitSettingsData`、`SettingsSection` 表单与 docs/git.md §2.1 总表。

---

## 5. Client 侧规范

### 5.1 状态（总纲见 state.md）

- 新增状态先走 state.md §5 决策清单分层（L0/L1/L2/L3），再落地；违背「五条铁律」视为缺陷。
- L1 全局瞬时态用 `createSnapshotStore` 单例 + props 注入（现状路径 2），**不得**因为省事把所有
  状态都塞进全局 store——组件局部的（NotesManager 的选中/内容/表单）留在组件内。
- busy 一律走 `BusyTracker.run(key, task)`，**禁止手写 begin/finally**；`key` 用 `noteKey()` 等
  集中构造函数。

### 5.2 i18n

- **所有 UI 文案走 `t(key)`**，禁止硬编码中英文。新增 key：`zh.ts` 加 → `en.ts` 加（映射类型
  强制），组件用 `MdNotesKey` 类型约束 flash/status 的 key 字段。
- 模板占位用 `{name}` 语法，参数对象在 `t(key, params)` 传入。

### 5.3 slot 注册

- 每个 slot 注册包 `ctx.effect(() => ctx.slots.inject(...), 'dsh-md-notes: <slot>')`，并带
  `locale: 'md-notes'` 让组件自动拿到 `t`。
- 新 UI 先确认挂哪个 slot（`sidebar.footer.action` / `conversation.chat.assistant-actions` /
  `shell.overlay` / `settings.section`），不要为省事新开 slot 名。

### 5.4 组件与样式

- CSS Modules（`.module.css`）；主题色用 `--dsw-alias-*` 变量**并带静态兜底值**（明暗都可读），
  禁止写死十六进制。共享样式进 `styles.module.css`，功能私有样式进各自 module。
- 复用 dsh 原语（`Modal`、`Tooltip`、`MarkdownText`、`StateDot`、图标），**不要重造**；确需
  「dsh 风格」的表单控件用现有 `DshInput`/`DshSelect`（若 dsh 后续公开了官方等价物，改用它）。
- **禁止用 DOM 查询模拟平台交互**（`openDshSettings` 用 `querySelector` 找按钮点两下是反例，
  §12 #9）：依赖平台内部 DOM 结构，升级即碎。新需求优先找平台扩展点/slot；找不到就在代码里
  留 TODO 标注「依赖平台能力」。

### 5.5 异步与清理

- `useEffect` 里发起的异步要在清理函数里 `alive = false` 守卫（参考 `update.ts`），避免卸载后
  setState 泄漏。
- 跨请求的「单飞/缓存」要能失效：`ContextSource` 的 `dispose()` 清空所有 Map 是正确示范；
  `update.ts` 的模块级 `shared` promise 失败后永不重试，可接受但要写注释说明语义。
- 列表刷新 + 重读选中笔记的「三连」（`refresh()` → 重读 → 更新选中）在 `open/doUpdate/updateClick`
  三处重复——抽出**自定义 hook**（如 `useNoteListAndRead`）收敛，避免下次改逻辑漏一处（§12 #5）。

---

## 6. HTTP API 契约

- 单一路由 `POST /plugins/md-notes`，body `{ method, ...args }`；method 名 `camelCase`。
- **成功**：`{ ok: true, ...payload }`；**失败**：`{ ok: false, code?, error }`。
- **新增 method 的检查单**：
  1. host `http.ts` 加 case（含参数解析与错误码出口）；
  2. client `api.ts` 加封装函数 + 该 method 的返回类型（§3）；
  3. 需要本地化的错误码加 `gitErrorText` case + zh/en；
  4. docs/architecture.md §3 的端点表补一行。
- `workspaceId` 来自 body 时**不做会话鉴权**（任何人可传任意 workspaceId 访问任意工作区）——
  这是「本地单用户工具」的信任边界，可接受，但新增会越界（读工作区外文件、执行命令）的能力时
  必须重新评估并显式加边界。

---

## 7. 并发、锁与异步任务（通用）

- **资源键稳定唯一**、**begin/end 幂等计数**、**finally 清理**、**不持久化**、**服务端兜底**——
  五条铁律（state.md §4.1）。
- host 权威锁（KeyedLock）与 client busy 镜像**职责不混**：host 拒绝是安全边界，client 禁用是体验。
- **锁 key 命名**：host 锁 key 与 client busy key 是两个体系，可以不同，但各自内部必须一致；文档
  里要写清楚（write-lock.md 目前 §4 写 `${workspaceId}/${name}`、§6 写 `note/<ws>/<name>`，需对齐）。

---

## 8. 测试

- 引入 **vitest**（TODO 4.8 已列，未落地，§12 #16）。`npm test` 全绿作为合并前提。
- 优先测**领域纯函数**：`sanitizeName`/`titleOf`、`syncNotes`/`threeWaySync`/`pushConflicts`/
  `changedNotes`/`remoteOnlyNotes`、`ContextSource` 的 `relFrom`/`canon`、`mergeSettings`。
- 文件操作用 `fs.mkdtemp` 跑真实读写；git 逻辑用临时仓库（`git init` + 本地 remote）做集成测试。

---

## 9. Git 提交、文档与发布

- **提交粒度（越细越好）**：一笔 commit 只做**一个独立、可单独 revert 的改动点**（一个 bug
  修复、一个关注点、一个文件的独立变更）。一次提问涉及多个独立改动时，按改动点拆成多笔，
  逐笔 `commit` + `push`；禁止把多个无关改动混进一笔。粒度上限 = 每笔仍要能独立通过类型
  检查/构建，不为拆而拆出「半成品」提交（改动需配套一起改的文件要放进同一笔）。
- **Commit message**：Conventional Commits（`feat`/`fix`/`perf`/`docs`/`chore`/`refactor`…），
  描述可用中文（现状约定），一行讲清动机；涉及用户可见行为变更时关联版本。示例：
  `fix: appendConversation 对 noteName 做 sanitize，堵住路径穿越`。
- **CHANGELOG**：只记**用户可见的功能性改动**（见 CHANGELOG.md 顶部规则）；未发布改动放
  `## NEXT_VERSION`，发布时 `npm run changelog:release -- <version>`。中英双份同步。
- **文档同步**：功能/状态/错误码/端点/设置项变化，同步更新 architecture.md、features.md、
  state.md §6/§7 清单、git.md 设置总表，缺一不可。
- **版本号**：SemVer；破坏性变更 bump major、新功能 minor、修复 patch。

---

## 10. 风格与工具

- 半角标点 + 单空格；对象/数组字面量尾逗号（现状一致）；import 分组（`node:` → `@deepseek-ai/*` →
  相对路径）。
- **引入 formatter + linter**（当前缺失，§12 #17）：建议 `biome`（或 Prettier + ESLint）作为
  `npm run lint`/`npm run format`，纳入 CI。工具未落地前，PR 里手工保持上述风格。

---

## 11. 架构演进护栏（功能越来越多时）

1. **领域前置**：新功能先写 `host/<domain>.ts` 纯函数 + 单测，再接 HTTP/client UI，不要从 UI
   开始倒着写。
2. **busy/锁通用化**：新「进行中的任务」域（git 任务、导出、图片上传）复用 `BusyTracker` 与
   `KeyedLock`，只新增 key 前缀与 host 锁接入点，不改 store/tracker 本体（state.md §4 已预留）。
3. **面板拆分子组件**：NotesManager 继续膨胀前拆成 `NotesManager` + 子组件（工作区列表 / 编辑器 /
   Git 卡片 / 确认弹窗）+ 自定义 hook（§5.5），右栏 TOC/反链（TODO 3.x）作为独立子组件挂入，
   不再往主文件里堆 state。
4. **类型收敛**：随功能增加，优先把 host↔client 共享实体收敛为一份（§3），API 返回用
   discriminated union，避免「猜字段」扩散。
5. **信任边界固化**：凡「按用户输入访问文件/执行命令」的新能力，先写边界校验（§4.3）+ 锁（§4.5），
   再写功能。

---

## 12. 附录：当前隐患与问题清单（审计 2026-08）

> 每条给出：现象、影响、处置（立即修 / 重构时做 / 文档化即可）。这是「变乱之前」的待办输入，
> 建议逐条在后续 commit 中消解，消解一条就更新本节状态。

| # | 位置 | 隐患 | 级别 | 处置 |
|---|---|---|---|---|
| 1 | ✅ `host/http.ts` + `host/notes.ts` | `appendConversation` 的 `noteName` 未消毒，可被 `../` 穿越出 `.dsh-notes` | 已修 | 双层 `sanitizeName`（commit `577912f`） |
| 2 | ✅ `host/keyed-lock.ts` + `index.ts` | 同一 clone 无并发互斥，并发 push/pull 会 race；shared 模式多工作区共享 clone 尤其危险 | 已修 | 新增 `KeyedMutex`，GitApi 边界按 `repo/<repoDir>` 串行化（commit `dc293c1`） |
| 3 | `host/http.ts` | HTTP API 无鉴权，任意 client 可传任意 `workspaceId` 读写任意工作区；`gitStatus` 返回含凭据的 `remote` URL | 中（信任边界） | 文档化信任边界；评估 `remote` 是否脱敏/不下发 |
| 4 | ✅ `host/git.ts` | shared 子目录原用 `sanitizeFolder(ws.title)`，工作区改名孤儿化旧目录 | 已修 | 仓库内 `.dsh-notes-workspaces.json` 以 `ws.id` 固定目录名（commit `e59f300`） |
| 5 | 🔶 `client/NotesManager.tsx` | 三处「刷新+重读」已去重、左栏已拆 `NoteItem`/`WorkspaceList`；主组件仍 ~20 个 useState | 中（进行中） | 剩余：抽 `useNotesManagerData` 等 hook 收敛 state（commit `f1b5d98`/`8eda8ed` 已完成前两项） |
| 6 | host/client 双份类型 | `NoteSummary`/`GitStatusData`/`GitSettingsData` 等两边各一份，易漂移 | 中 | 收敛为一份（§3），至少交叉注释 |
| 7 | `client/api.ts` `ApiResult` | `ok:true` 分支 10+ optional 字段的大杂烩，调用方靠猜 | 中 | 改按 method 的 discriminated union |
| 8 | `NotePicker`/`NotesManager` | 「按工作区分组列表」JSX 重复 | 低 | 抽共享列表组件 |
| 9 | `NotesManager.openDshSettings` | `querySelector` 模拟两次点击跳设置，耦合 dsh DOM | 中 | 找平台扩展点；找不到则留 TODO |
| 10 | `http.ts` 重复声明 + `NotesManager` 中文注释 | `hasWorkspaces` 接口重复声明；残留中文注释 | 低 | 顺手清理 |
| 11 | `api.ts` `gitErrorText` | `push-failed`/`merge-unrelated` 死 code（host 从不返回） | 低 | 删除 |
| 12 | `git.ts` `fetchCache` | 模块级 Map 只增不清理，跨 repo 累积 | 低 | 移入 apply 闭包或加 TTL 清理 |
| 13 | `notes.ts` `listNotes` | 首读无 meta.json 时全量读文件重建，笔记量大时慢 | 低 | 可接受（一次性），量大再评估索引 |
| 14 | `notes.ts` `createNote` | 并发同名 create 有 TOCTOU 竞态（未锁） | 低 | 可接受（write-lock.md 明示不锁 create），或加目录级锁 |
| 15 | `client/update.ts` | 模块级 `shared` promise 失败后永不重试 | 低 | 可接受，加注释说明语义 |
| 16 | 全仓库 | 无测试、无 lint/format、无 CI | 中（债务） | 引入 vitest（§8）+ biome（§10） |
| 17 | `settings.ts` `mergeSettings` | `gitCentral.branch` 空串会回退 L2 值，用户想清空分支时无法清空 | 低 | 评估语义：空串应表示「未设置/回退默认 main」并写清 |
| 18 | 文档内部不一致 | write-lock.md §4 与 §6 的 noteKey 写法不一致 | 低 | 对齐 host 锁 key（`workspaceId/name`）与 client busy key（`note/workspaceId/name`）的表述 |

> 本节是活的：修掉一条就把该行标 ✅ 并注明 commit；新增隐患随时补。目标是在功能继续增长前
> 把「高/中」级别清空。
