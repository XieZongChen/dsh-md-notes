# dsh-md-notes 架构设计文档

DSH 第三方插件（bundle）"MD 笔记管理"的架构设计：架构、目录结构、开发环境、配置与实现细节。
功能设计见 [features.md](features.md)。

## 1. 架构

插件是一个可安装的 npm bundle 包，同时扮演两个角色：

- **Host 半**（`lib/index.js`）：函数插件（`name` / `inject` / `Config` / `apply`），
  通过 `ctx.webServer` 暴露一个 JSON API 路由 `POST /plugins/md-notes`（body 携带 `method`：
  `list` / `read` / `write` / `create` / `delete` / `appendConversation` + `git*` 系列）。
  笔记以 `.md` 文件存储（**深度绑定工作区**：各工作区 `<工作区>/.dsh-notes`，无工作区时无法读写），
  `meta.json` 记录每篇笔记的标题与更新时间；Git 仓库由 URL 驱动，插件在
  `$DSH_HOME/md-notes-repos/<url-hash>/` 维护本地 clone。
- **Client 半**（`lib/client.js`）：通过 `dsh.client` 声明 + `exports["./client"]` 被
  `dsh-client-modules` 扫描进 `window.__DSH_BOOT__`，在浏览器里作为 cordis 插件运行；
  注册四个 slot（`sidebar.footer.action`、`conversation.chat.assistant-actions`、
  `shell.overlay`、`settings.section`），通过 `fetch` 调用 Host 的 HTTP API。

**无 typert/Remote 依赖**：Client↔Host 通信走 HTTP 路由而非 `@Remote` 生成物，
因此构建只需 tsc + tsdown，不需要仓库内的 typert 工具链。

## 2. 目录结构

```
dsh-md-notes/
├── package.json          # dsh.bundle + dsh.client + exports
├── AGENTS.md             # agent 硬约束速查（后端/前端模型/不变量/验证命令/场景清单）
├── CLAUDE.md             # 指向 AGENTS.md
├── cordis.patch.yml      # bundle 补丁：插入 md-notes 行
├── assets/
│   └── dsh-md-notes.svg  # 插件图标（唯一事实来源，host 直接 serve）
├── tsconfig.json         # host program（exclude src/client 与 *.test.ts）
├── tsconfig.client.json  # client program（jsx: react-jsx；exclude *.test.ts）
├── tsconfig.test.json        # host 测试 program（noEmit，仅 typecheck）
├── tsconfig.client-test.json # client 测试 program（noEmit，仅 typecheck）
├── tsdown.config.ts      # client bundle 构建（复刻仓库 tsdown.client.ts 协议）
├── docs/
│   ├── features.md        # 功能设计文档
│   ├── architecture.md    # 本文档（架构设计）
│   ├── git.md             # Git 同步设计（v4 模型）
│   ├── context.md         # 笔记引用进对话上下文设计（已实现）
│   ├── state.md           # 状态管理总纲（分层/选型/异步跟踪）
│   ├── write-lock.md      # 笔记写入互斥（写锁）方案（已实现）
│   ├── manager-redesign.md # 笔记面板改版方案（0.7.0 已实现 P0）
│   ├── coding-standards.md # 代码规范（分层/命名/类型/错误码/锁/测试 + 隐患清单）
│   └── TODO.md            # 功能规划（待办）
├── scripts/
│   └── link-deps.mjs     # 开发期链接 deepseek-harness checkout 类型
└── src/
    ├── index.ts          # host 插件入口（name/inject/Config/apply，纯装配）
    ├── contract.ts       # host/client 共享 wire 契约（纯类型：实体 + 各 method 请求/响应；两个 tsc program 各自编译，见 §5）
    ├── host/
    │   ├── notes.ts      # 笔记领域逻辑（目录/元数据/各操作方法）
    │   ├── git.ts        # Git 领域逻辑（runGit/仓库解析/同步/冲突检测/隔离 + FetchDedup）
    │   ├── keyed-lock.ts # 通用键控并发：KeyedLock（笔记写互斥）+ KeyedMutex（git 按 repo 串行）
    │   ├── settings.ts   # L3 settings 命名空间（schema + mergeSettings）
    │   ├── update.ts     # npm 版本检测（compareVersions + createUpdateChecker，I/O 全注入）
    │   ├── context-inject.ts # agent/pre-step 笔记内容注入（模型请求前折叠笔记内容）
    │   └── http.ts       # HTTP 工具 + 路由 handler 组装（notes + git 分发）
    └── client/
        ├── index.ts     # 入口（组装层，无 JSX）：apply + slot 注册 + NotesOverlay
        └── features/
            ├── api.ts            # Host HTTP API 封装 + gitErrorText（错误码→i18n）+ checkUpdateApi
            ├── store.ts          # NotesStore（createSnapshotStore 共享状态）
            ├── busy.ts           # BusyTracker（通用异步任务跟踪，域前缀 note/<ws>/<name>）
            ├── note-text.ts      # 记入笔记文本提取（从浏览器会话快照，与复制按钮同源）
            ├── note-links.ts     # 笔记互链解析/预处理（预览 fileMentions：resolveNoteLink / preprocessWikiLinks / titleMatchCount）
            ├── sanitize.ts       # 客户端文件名镜像 sanitizeFileName / fileNameKey（创建查重比对）
            ├── update.ts         # useUpdateAvailable（npm 版本检测，模块级共享缓存）
            ├── markdown.ts       # 共享小工具（fmtTime；渲染已改用 dsh MarkdownText）
            ├── locales/          # i18n：zh.ts（源字典）/ en.ts（同键映射）+ LocaleNamespaceMap 合并
            ├── styles.module.css # 共享样式（mask/dialog/btn/input 等）
            ├── components/
            │   ├── LoadingIndicator/ # StateDot loading 封装
            │   ├── DshInput/         # dsh 风格文本输入（token 化，抄 ui-primitives Input）
            │   └── DshSelect/        # dsh 风格下拉（token 化，抄 ui-settings-models select）
            ├── NotesEntry/       # 侧边栏入口
            ├── NoteAction/       # 记入笔记图标
            ├── NotePicker/       # 记入笔记弹窗
            ├── NotesManager/     # 笔记管理面板（列表 + 编辑器 + 工作区 Git 卡片 + 全局状态行）
            │   ├── NotesManager.tsx # 纯渲染组件（所有 state/handler 都在 hooks 里）
            │   ├── components/      # 面板私有子组件（复用不了才放这里，能跨功能的进 features/components/）
            │   │   ├── WorkspaceList.tsx   # 左栏：工作区分组列表（组合 GitSyncCard/GitStatusIcon/NoteItem）
            │   │   ├── GitSyncCard.tsx     # 每工作区 Git 同步卡片（状态行 + update/push）
            │   │   ├── GitStatusIcon.tsx   # 工作区行 git 开关（图标 + 活动点 + tooltip）
            │   │   ├── NoteItem.tsx        # 单篇笔记行
            │   │   └── notes-manager.module.css  # 面板共享样式（components 内部 + NotesManager.tsx 共用）
            │   └── hooks/             # 面板私有 hook（按关注点拆分，见 coding-standards §1.3）
            │       ├── useNotesList.ts     # 列表加载 + 每工作区 git 状态
            │       ├── useNotesEditor.ts   # 选中/内容/保存/删除/新建（依赖列表 hook）
            │       ├── useGitSync.ts       # update/push/冲突流程（依赖前两者）
            │       ├── useNotesManager.ts  # 编排三 hook，持有跨切面状态（gitMsg/remoteChanged/confirm）
            │       └── types.ts            # ConfirmState / NotesManagerProps（hooks 与渲染器共用）
            ├── ContextSource/    # @ 引用 source（ui-input-trigger：candidates/onPick/codec）
            │   ├── ContextSource.ts # source 组装（候选/插入/codec 胶水）
            │   ├── paths.ts        # 纯路径函数（relFrom/canon/parentDir/refPath/chipLabel，有测试）
            │   └── resolve.ts      # ref → 工作区 三分支解析（提交时序列化依赖，有测试）
            └── Settings/         # dsh 设置面板「MD 笔记」分区（SettingsSection + css）
```

## 3. Host 半（src/）

- 插件入口 `index.ts`：导出 `name`（`md-notes`）、`inject`（`webServer`, `settings`）、
  `Config`（schemastery schema：`route`、`gitMode`、`gitCentralRemote/Branch`、
  `gitRepos`、`gitAutoPull`、`gitAuthorName/Email`）、`apply(ctx, config)`；
  `apply` 只做装配——解析目录、构建 handler、注册路由、注册 L3 settings 命名空间。
- 领域逻辑 `host/notes.ts`：`sanitizeName` / `titleOf` + 六个操作方法
  （`listNotes` / `readNote` / `writeNote` / `createNote` / `deleteNote` / `appendConversation`），
  全部为纯函数（目录参数注入，无 ctx 依赖），可独立测试。
- Git 领域 `host/git.ts`：`runGit`（subprocess 收集输出）、`cloneDirFor`（URL→本地 clone 目录）、
  `resolveWorkspaceRepo` / `resolveSharedRepo`（互斥双模式解析）、`resolveNotesDir`（恒为工作区
  `.dsh-notes`）、共享模式子目录映射（`.dsh-notes-workspaces.json`，`resolveEffectiveRepo` /
  `resolveSharedFolder` 固定目录名）、`syncNotes` / `changedNotes` / `remoteOnlyNotes` /
  `deleteMissingNotes`（目录镜像同步 + 冲突检测）、`gitInit`（clone）/ `gitStatus` / `gitPush` /
  `gitPull` / `gitSync`、`GitError`（带机器可读 `code`）。
- 设置 `host/settings.ts`：`MD_NOTES_NS`（`md-notes`）、`MdNotesSettingsSchema`（L3 wire schema）、
  `mergeSettings`（L2 Config 与 L3 逐层合并，`gitMode:'on'` 归一化为 shared/own）。
- HTTP 层 `host/http.ts`：`readBody`（有界 JSON 读取）、`sendJson`、`notesApiHandler`（method 分发：
  notes 域 + git 域）、`iconHandler`（GET 返回打包的 SVG 图标）。
- 上下文注入 `host/context-inject.ts`：监听 `agent/pre-step`，扫描已认领消息中的笔记路径
  （`.dsh-notes/…` 正则提取，相对会话 cwd 解析），读取内容并作为注入上下文消息
  （`source.kind: 'md-notes'`）折叠进模型请求——引用可靠生效，不依赖模型自觉 `read`。
- **写锁（host）**：`host/keyed-lock.ts` 实现通用 `KeyedLock`（键 = `note/<workspaceId>/<name>`），
  `write` / `appendConversation` / `delete` 三操作写入期间跨会话互斥，冲突返回错误码
  `note-writing`；client 端用 `busy.ts` 的 `BusyTracker` 镜像（`store.busy`）联动三处 UI。
  详见 [write-lock.md](write-lock.md) 与 [state.md](state.md)。
- **git 互斥（host）**：同文件还实现 `KeyedMutex`（`repo/<repoDir>` 排队串行），在 `index.ts`
  的 GitApi 装配处包住 `gitStatus/init/push/pull/sync` 顶层调用——消除同一 clone 的并发
  checkout/add/commit/push 竞态（shared 模式多工作区共享 clone 尤其危险）。
- **错误码协议**：git 操作失败返回 `{ ok: false, code, error }`（如 `no-repo`、`sync-branch`、
  `git-failed`、`identity`、`remote-changed`、`non-fast-forward`），`error` 为英文 detail；
  client 用 `gitErrorText` 按 `code` 渲染本地化文案。
- **HTTP 鉴权（信任栅栏）**：两条路由的 handler 开头先过 `connection.requestRejection`
  （deepseek-harness `packages/client/connection` 的官方路由信任门，官方 `/api` 通道同款：
  未认证浏览器会话 → 401，不可信 Host/Origin → 403），拒绝时不再泄露任何 API 信息。
  connection 服务按请求动态解析（`ctx.get('connection')`）——web profile 存在时全程有栅栏；
  无该服务的 profile（如 Electron IPC 载体）退回无栅栏路由（其载体本就不是共享 HTTP socket）。
- **remote 凭据脱敏**：`gitStatus` 返回的 `remote` 是展示用副本，经 `redactRemote` 抹去
  URL 内嵌 userinfo（`https://user:token@…` → `https://***@…`）；设置表单读写仍用原始值
  （用户编辑需回填）。
- HTTP 路由（`ctx.webServer.register`）：
  - `{ kind: 'prefix', path: route }`：仅接受 `POST`；body 为 `{ method, ...args }`。
  - `{ kind: 'exact', path: `${route}/icon.svg` }`：GET 返回 `assets/dsh-md-notes.svg`（`image/svg+xml`）。
- 所有副作用（路由注册、settings 注册）都包在 `ctx.effect(..., label)` 内，HMR 安全。

### Host API 端点

端点的请求/响应形状以 `src/contract.ts` 为单一事实来源（`ApiContract` 一 method 一条，
client 的 `api<M>()` 按其推导精确返回类型；下表为可读摘要）：

| method | body | 返回 |
|---|---|---|
| `list` | — | `{ ok, workspaces: [{ workspaceId, name, notesDir, notes }], noWorkspaces }`（按工作区分组；带 `sessionId` 时只返回该会话工作区，会话无工作区返回空数组） |
| `read` | `{ workspaceId?, name }` | `{ ok, name, content }` |
| `write` | `{ workspaceId?, name, content }` | `{ ok, name }` |
| `create` | `{ workspaceId?, title }` | `{ ok, name }`（空标题自动用 Untitled note） |
| `delete` | `{ workspaceId?, name }` | `{ ok, name }` |
| `appendConversation` | `{ noteName, questionText, answerText, sessionTitle? }` | `{ ok, name }`（文本由 client 从会话快照提取，host 只写文件） |
| `gitStatus` | `{ workspaceId? }` | `{ ok, status: { repoDir, subdir, branch, uncommitted, unpushed, lastCommit?, remote } }`（`unpushed` 0.7.0 新增，本地与仓库差异数；`remote` 为脱敏展示副本，不含 userinfo 凭据） |
| `gitInit` | `{ workspaceId? }` | `{ ok }`（按 URL clone） |
| `gitPush` | `{ workspaceId?, message, overwrite? }` | `{ ok }` 或 `{ ok:false, code, changed? }` |
| `gitPull` | `{ workspaceId?, force?, manual? }` | `{ ok, skipped?, changed? }`（manual=手动更新始终同步；自动拉取按远端提交领先短路，见 git.md §5.2） |
| `gitSync` | `{ workspaceId? }` | `{ ok }`（合并远端，用户触发） |
| `gitSettings` | — | `{ ok, settings }`（L3 原始值，设置表单用） |
| `gitConfig` | 白名单 L3 keys | `{ ok }`（写设置） |
| `checkUpdate` | — | `{ ok, update: { current, latest, hasUpdate } }`（npm 版本检测，host 缓存 10 分钟） |

## 4. Client 半（src/client/）

- 入口 `index.ts`（无 JSX，用 `React.createElement`）：`inject: ['slots', 'locale']`；`apply` 里
  注册 `md-notes` locale 字典（`ctx.locale.register`），创建共享 `NotesStore` 并注册四个 slot
  （每个注册带 `locale: 'md-notes'`，组件 props 自动注入 `t`）：
  - `sidebar.footer.action` → 侧边栏入口；
  - `conversation.chat.assistant-actions` → 记入笔记图标；
  - `shell.overlay` → 笔记管理器与记入笔记选择弹窗；
  - `settings.section` → 设置面板「MD 笔记」分区（`id: 'md-notes'`，order 10）。
- **`@` 引用 source**（`features/ContextSource/`）：`apply` 里
  `ctx.get('inputTriggers')?.registerSource(...)`（挂 `ctx.effect`，HMR 安全）注册
  `trigger: '@'`、`name: 'notes'` 的引用源：`candidates` 默认取当前会话工作区笔记、
  部分工作区名出现模糊**工作区行**（`{ text }` 自动补全 `@工作区名/` + re-track 重触发）
  切换跨工作区（中文名已支持，仅空格受限，见 [context.md](context.md) §3.2）；`onPick` 返回 `ReferenceInsert`
  （`ref` = **会话工作区相对路径**：同工作区 `.dsh-notes/xxx.md`、跨工作区 `../<目录>/…`，
  `label` = 前置截断标题）；`codec.serialize` 提交时校验笔记仍存在并输出**标准 markdown
  链接** `[标题](路径)`，失效则抛本地化错误阻断发送；
  `warm`/`lexicon`/`subscribeLexicon` 提供纯文本装饰热快照。无 `inputTriggers` 时特性静默
  禁用（console.warn）。序列化格式与交互细节见 [context.md](context.md)。
- **i18n**：所有 UI 文案在 `features/locales/`（`zh.ts` 源字典、`en.ts` 映射类型强制同键，
  `LocaleNamespaceMap` 合并 `md-notes` 命名空间）；组件用 `t(key, params)` 读取，随 dsh 语言
  自动重渲染；host 错误经 `gitErrorText(t, code, detail)` 本地化。占位符用 `{name}` 模板。
- **错误码映射**：`api.ts` 的 `gitErrorText` 把 host 返回的 `code` 映射为本地化文案
  （`git.errNoRepo` / `git.errSyncBranch` / `git.errGitFailed` / `git.errNonFastForward` 等），
  `detail` 作参数；未知 code 回退 `git.failed`。
- **版本更新检测**：`update.ts` 的 `useUpdateAvailable` 在入口/管理器挂载时调 `checkUpdateApi`
  （模块级共享缓存，页面生命周期只查一次）；有新版时两处（侧边栏入口尾部、管理器标题栏设置
  按钮旁）渲染黄色 tag（warn token，20% 透明度背景）。
- 图标：`<img src="/plugins/md-notes/icon.svg">` 直接引用 host serve 的 SVG（`api.ts` 导出 `ICON_URL`）。
- 目录约定：功能模块放在 `features/` 下，每个功能一个子目录；共享模块（`api.ts` / `store.ts` /
  `markdown.ts`）与共享样式 `styles.module.css` 在 `features/` 根；`components/` 放跨功能复用组件。
  功能目录自己长胖时按职责拆出**私有子目录**（`NotesManager/` 已示范）：`components/` 放「复用了
  但放不进 `features/components/`」的面板私有子组件，`hooks/` 放按关注点拆出的状态逻辑
  （`useNotesManager.ts` 编排 `useNotesList`/`useNotesEditor`/`useGitSync`），css module 随组件
  放在 `components/` 下共享；跨功能复用先考虑放 `features/components/`，别堆在功能私有目录里。
- 样式用 **CSS Modules**（tsdown 的 `dsh-md-notes-css-modules` 插件注入
  `<style data-plugin-css="dsh-md-notes/<file>">`）。
- **表单控件**：设置面板用 `DshInput` / `DshSelect`（`components/` 内本地副本，照抄 dsh
  ui-primitives Input 与 ui-settings-models select 的 token 化样式），暗黑模式与 dsh 原生表单一致。
- **确认弹窗**：删除/推送覆盖/更新覆盖统一用页面内 `Modal`（ui-primitives），不依赖
  原生 `window.confirm`（在 `shell.overlay` 下更可靠）；**记入笔记弹窗**（NotePicker）同样
  用 `Modal`（headless 模式）+ `DshInput`，深色模式与 dsh 弹窗一致。
- **记入笔记标签本地化**：`appendConversation` 写入笔记的分段标签（用户/助手/图片/空占位）
  由 client 按界面语言传入 `labels`，host 用传入值渲染（缺省英文），笔记内容跟随 dsh 语言。
- markdown 预览用 **dsh 的 `MarkdownText`**（`@deepseek-ai/dsh-client-ui-primitives`，micromark/mdast 生态：
  GFM、TeX 公式（KaTeX）、代码高亮（Shiki）、CJK 友好加粗，XSS 安全内置——原始 HTML 与危险协议
  禁用）。自研 `renderMd` 已移除。
- 所有数据经 `fetch('/plugins/md-notes', { method: 'POST', body: JSON.stringify({ method, ...args }) })`。

## 5. 开发环境

```sh
# 1. 安装构建依赖（--legacy-peer-deps 跳过 @deepseek-ai/* peer 解析）
npm install --legacy-peer-deps

# 2. 链接 deepseek-harness checkout 的类型（改代码前跑一次）
npm run link-deps

# 3. 构建（tsc host → tsc client → tsdown → lib/client.js）
npm run build
```

- `scripts/link-deps.mjs` 把 `@deepseek-ai/*` 包符号链接到 checkout 的构建产物
  （`packages/<group>/<pkg>`），使 TypeScript 能解析类型。`DSH_CHECKOUT` 环境变量
  覆盖默认 checkout 路径。
- **host 与 client 必须两个 tsc program**：host 侧 `dsh-session` 与浏览器侧
  `dsh-client-runtime` 对 `Context.sessions` 的声明不同，同一 program 内会冲突；
  host program `exclude: ["src/client"]`，client program 只编译浏览器侧。
  **共享 wire 契约** `src/contract.ts`（纯类型、零 dsh import）被两个 program 同时
  include（client program 显式列入），是「两 program 不合并」约束下消除双份类型
  （实体 + API 形状）的方式；client program 的 `declarationDir` 为 `lib/types`，
  产物 `lib/types/client/index.d.ts` 与 package.json `exports["./client"].types` 对齐。
  **测试文件不进构建产物**：两个 build program 都 exclude `*.test.ts`（vitest 直接吃
  TS 源码，tsc 产出的 test.js 毫无用途且会随 `files: ["lib"]` 发布）；测试的类型检查
  由两个 noEmit program（`tsconfig.test.json` / `tsconfig.client-test.json`）承担，
  挂在 `npm run typecheck` 里——两半测试不能同 program（同一 `Context.sessions` 冲突）。
- client bundle 协议（`tsdown.config.ts`）：输出 CJS closure-factory，经
  `window.__ModuleLoader__.load({ id, factory })` 加载；平台模块保持 external，其余依赖内联。
  该协议是**手工复刻** deepseek-harness `packages/client/tsdown.client.ts`——四个耦合点
  （closure 包络 / 平台 externals 对齐模块表 / CSS Modules 注入的 `data-plugin-css`
  标签约定 / 产物路径契约）及各自的 harness 源码位置与升级核对清单，见
  `tsdown.config.ts` 头部「Protocol coupling points」注释；升级 dsh 后逐条核对再重构建。

## 6. 配置

```yaml
# 在 profile 的 cordis.patch.yml 或更高层覆盖（会整体替换该行的 config）
# HTTP 路由前缀固定为 /plugins/md-notes（client 半硬编码同值，不可配置）
- id: md-notes
  config:
    gitMode: 'off'                # 'off' | 'shared' | 'own'（旧值 'on' 归一化）
    gitCentralRemote: ''          # 共享仓库 URL（L2 默认）
    gitCentralBranch: ''          # 共享仓库分支（L2 默认，留空=main）
    gitRepos: {}                  # 每工作区 { remote?, branch?, subpath? }（L2 默认）
    gitAutoPull: true             # 打开笔记时自动拉取
    gitAuthorName: ''             # 提交作者名（空=用 git 全局配置）
    gitAuthorEmail: ''            # 提交作者邮箱
    checkUpdate: true             # 允许向 registry.npmjs.org 查询插件新版（false=完全离线）
```

用户级配置（L3）通过 dsh 设置面板「MD 笔记」分区写入 `md-notes` 命名空间，覆盖 L2。

## 7. 实现要点与约定

- 笔记是普通 `.md` 文件，可直接在文件系统编辑；`meta.json` 为最佳努力缓存，不入库。
- **笔记位置恒定** `<工作区>/.dsh-notes`（git 模式/仓库配置不影响本地位置）。
- Git 仓库由 URL 驱动：`cloneDirFor(remote)` 哈希 URL 得本地 clone 目录，同一 URL 共用。
- `appendConversation` 的文本（提问/回答/会话标题）由 **client 从浏览器会话快照提取**（`note-text.ts`，与复制按钮同源），host 只做格式化 + 写文件——不再 `sessionQuery.readSession` 全量读会话（长会话会同步阻塞事件循环，卡住面板请求）。
- 删除文件用 `node:fs/promises` 的 `rm`；目录创建用 `mkdir({ recursive: true })`。
- 样式使用主题 CSS 变量（`--dsw-alias-*`），同时带静态兜底值，明暗主题均可读；
  主按钮/输入框/下拉框配色与 dsh 一致（`--dsw-alias-button-primary-fill`、
  `--dsw-alias-label-primary-foreground`、`--dsw-alias-bg-layer-1` 等）。
- 所有 UI 文案必须走 i18n（`t()`），host 不返回面向用户的本地化文案（返回错误码 + 英文 detail）。
