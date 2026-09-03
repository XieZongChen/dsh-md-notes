# AGENTS.md

dsh-md-notes 是 deepseek-harness（dsh）的第三方插件：工作区 `.dsh-notes` 目录下的
Markdown 笔记管理器（增删改查/预览/记入会话/`@` 引用注入），可选同步到 Git 仓库。
改代码前先读 [docs/architecture.md](docs/architecture.md)；本文是**硬约束速查**，
与 docs/ 不重复解释原理，只列「违反即坏」的规则和验证命令。

## 两半模型（一切约束的根源）

一个 npm 包，两个 cordis 插件，运行在两个进程里：

- **Host 半** `src/`（Node，`lib/index.js`）：`webServer` HTTP API + 笔记/git 领域逻辑 + 设置命名空间 + 上下文注入。
- **Client 半** `src/client/`（浏览器，`lib/client.js`）：slot 注册（侧边栏/管理器/记入笔记/设置分区）+ `@` 引用源。
- 两者只通过 `POST /plugins/md-notes`（`{ method, ...args }`）通信；契约在 `src/contract.ts`。

## 硬不变量（AI 改动前自查）

1. **两个 tsc program 不得合并**：host `dsh-session` 与浏览器 `dsh-client-runtime` 对
   `Context.sessions` 声明冲突。host program exclude `src/client`；client program 只含
   browser 侧 + `src/contract.ts`。**host 与 client 源码互不 import**（type 也不行）。
2. **wire 类型单一来源**：跨 host/client 的实体与 API 形状只写在 `src/contract.ts`
   （`ApiContract` 一 method 一条）。两侧 import/re-export，禁止在本侧再写一份。
3. **client `features/api.ts` 保持零运行时 import**（contract 与 TranslateNS 都是
   type-only）——这是它能脱离 dsh 运行时被单测的前提。
4. **HTTP 路由前缀是两半固定常量** `/plugins/md-notes`：host `index.ts` 与 client
   `api.ts` 各写一处同值，**不做配置项**（client 读不到 host 配置，可配即断链）。
5. **两条 HTTP 路由必须过 `authorize` 栅栏**（`connection.requestRejection`，401/403
   先于一切分发）。新增路由照抄 `notesApiHandler`/`iconHandler` 的栅栏位置。
6. **文件系统边界**：任何用户/请求提供的笔记名进 fs 前必经 `sanitizeName`；
   `context-inject` 只读 `.dsh-notes` 目录内文件；`gitConfig` 只接受白名单键。
7. **副作用全挂 `ctx.effect(..., 'dsh-md-notes: <what>')`**（路由/settings/事件/样式/DOM 注入）；
   跨请求缓存放 apply 闭包或工厂（`createFetchDedup`），**禁止模块级可变缓存**。
8. **客户端构建是手工复刻协议**：`tsdown.config.ts` 头部「Protocol coupling points」
   列了 4 个耦合点与 harness 源码位置。**升级 dsh 后先逐条核对再构建**。
9. **UI 文案只走 i18n**：`features/locales/`（zh 源字典、en 同键映射，类型强制），
   host 只返回错误码 + 英文 detail；新增错误码须同步 `gitErrorText` + 两份 locale。
10. **不碰 `lib/`**（构建产物、gitignored）；**不碰 harness checkout**
    （`../deepseek-harness`，只读参照）；不用 `--force` push。

## 验证命令（每个 commit 前跑）

```sh
npm run typecheck   # 4 个 tsc program：host build / client build / 两个 noEmit 测试 program
npm test            # vitest，扫 src/**/*.test.ts（Node 环境，无需浏览器）
npm run build       # tsc×2 + tsdown（改了 client 侧才需要）
```

- Node ≥ 22.19（与 harness 支持矩阵一致；老 Node 会以 ESM/语法错误崩）。
- 首次开发：`npm install --legacy-peer-deps && npm run link-deps`（链接 harness checkout 类型，
  `DSH_CHECKOUT` 可覆盖路径）。

## 按场景的修改清单

- **改/加 API method**：`contract.ts` 的 `ApiContract` → host `http.ts` case（+必要时
  `NotesApiDeps`）→ client `api.ts`（泛型自动生效）→ `docs/architecture.md` §3 端点表 →
  `http.test.ts` 分发用例。
- **新增 UI 文案**：`locales/zh.ts` + `en.ts` 同键（en 的类型由 zh 键联合强制），组件里 `t(key)`。
- **新增 host 错误码**：host 侧返回 `{ ok:false, code, error }` → `gitErrorText` 加 case →
  两份 locale 加文案。
- **新增 slot / 扩展点**：先查 harness 对应包的 slot 声明（`*.client.ts` 的 SlotMap），
  注册照抄现有 `ctx.slots.inject` 模式；拿不到的扩展点进 `docs/TODO.md` 平台问题区。
- **升级 dsh 适配**：`npm run link-deps` 后 typecheck 会暴露断裂面；迁移完成后更新
  `docs/compatibility.md` 对照表 + CHANGELOG「适配 deepseek-harness `<版本>`」条目。

## 提交 / CHANGELOG / 文档约定

- Commit：`type(scope): 中文描述`，正文写「为什么」。一 commit 一件事，逐个 push。
- CHANGELOG（中英两份，规则见文件头）：只记**用户可见**的功能性改动；未发布改动进
  `NEXT_VERSION` 块，分类顺序 Breaking → Added → Fixed；构建/重构/测试不进 CHANGELOG。
- 改动同步对应文档（功能 → features/usage，架构 → architecture，规范/隐患 → coding-standards）；
  `coding-standards.md` §12 是活清单：发现新隐患补一行，修掉标 ✅ + commit 号。

## docs/ 职责速查

| 文档 | 内容 |
|---|---|
| [architecture.md](docs/architecture.md) | 两半架构、目录树、端点表、配置、开发环境、bundle 协议 |
| [features.md](docs/features.md) / [usage(.zh).md](docs/usage.zh.md) | 功能设计与使用指南（CHANGELOG 链接目标） |
| [context.md](docs/context.md) | `@` 引用与注入链路设计（含 pre-step vs agent.inject 选型依据） |
| [git.md](docs/git.md) | Git 同步模型（v4：URL 驱动 clone、镜像同步、三路合并） |
| [state.md](docs/state.md) / [write-lock.md](docs/write-lock.md) | 状态分层与写锁协议 |
| [coding-standards.md](docs/coding-standards.md) | 分层/命名/类型/错误码/锁/测试规范 + §12 隐患清单 |
| [compatibility(.zh).md](docs/compatibility.zh.md) | 插件版本 ↔ dsh 版本对照表 |
| [TODO.md](docs/TODO.md) | 功能规划与平台能力缺口（含各 hack 的替换条件） |
