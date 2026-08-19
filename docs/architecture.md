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
├── cordis.patch.yml      # bundle 补丁：插入 md-notes 行
├── assets/
│   └── dsh-md-notes.svg  # 插件图标（唯一事实来源，host 直接 serve）
├── tsconfig.json         # host program（exclude src/client）
├── tsconfig.client.json  # client program（jsx: react-jsx）
├── tsdown.config.ts      # client bundle 构建（复刻仓库 tsdown.client.ts 协议）
├── docs/
│   ├── features.md        # 功能设计文档
│   ├── architecture.md    # 本文档（架构设计）
│   ├── git.md             # Git 同步设计（v4 模型）
│   ├── context.md         # 笔记引用进对话上下文设计（已实现）
│   └── TODO.md            # 功能规划（待办）
├── scripts/
│   └── link-deps.mjs     # 开发期链接 deepseek-harness checkout 类型
└── src/
    ├── index.ts          # host 插件入口（name/inject/Config/apply，纯装配）
    ├── host/
    │   ├── notes.ts      # 笔记领域逻辑（目录/元数据/各操作方法）
    │   ├── git.ts        # Git 领域逻辑（runGit/仓库解析/同步/冲突检测）
    │   ├── settings.ts   # L3 settings 命名空间（schema + mergeSettings）
    │   ├── context-inject.ts # agent/pre-step 笔记内容注入（模型请求前折叠笔记内容）
    │   └── http.ts       # HTTP 工具 + 路由 handler 组装（notes + git 分发）
    └── client/
        ├── index.ts     # 入口（组装层，无 JSX）：apply + slot 注册 + NotesOverlay
        └── features/
            ├── api.ts            # Host HTTP API 封装 + gitErrorText（错误码→i18n）+ checkUpdateApi
            ├── store.ts          # NotesStore（pub/sub 共享状态）
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
            ├── NotesManager/     # 笔记管理面板（列表 + 编辑器 + Git 同步区 + 冲突确认 Modal）
            ├── ContextSource/    # @ 引用 source（ui-input-trigger：candidates/onPick/codec）
            └── Settings/         # dsh 设置面板「MD 笔记」分区（SettingsSection + css）
```

## 3. Host 半（src/）

- 插件入口 `index.ts`：导出 `name`（`md-notes`）、`inject`（`webServer`, `settings`）、
  `Config`（schemastery schema：`route`、`gitMode`、`gitCentralRemote/Branch`、
  `gitRepos`、`gitAutoPull`、`gitAuthorName/Email`）、`apply(ctx, config)`；
  `apply` 只做装配——解析目录、构建 handler、注册路由、注册 L3 settings 命名空间。
- 领域逻辑 `host/notes.ts`：`notesDir` / `sanitizeName` / `titleOf` / `blocksToText` + 六个操作方法
  （`listNotes` / `readNote` / `writeNote` / `createNote` / `deleteNote` / `appendConversation`），
  全部为纯函数（目录参数注入，无 ctx 依赖），可独立测试。
- Git 领域 `host/git.ts`：`runGit`（subprocess 收集输出）、`cloneDirFor`（URL→本地 clone 目录）、
  `resolveWorkspaceRepo` / `resolveSharedRepo`（互斥双模式解析）、`resolveNotesDir`（恒为工作区
  `.dsh-notes`）、`syncNotes` / `changedNotes` / `remoteOnlyNotes` / `deleteMissingNotes`
  （目录镜像同步 + 冲突检测）、`gitInit`（clone）/ `gitStatus` / `gitPush` / `gitPull` / `gitSync`、
  `GitError`（带机器可读 `code`）。
- 设置 `host/settings.ts`：`MD_NOTES_NS`（`md-notes`）、`MdNotesSettingsSchema`（L3 wire schema）、
  `mergeSettings`（L2 Config 与 L3 逐层合并，`gitMode:'on'` 归一化为 shared/own）。
- HTTP 层 `host/http.ts`：`readBody`（有界 JSON 读取）、`sendJson`、`notesApiHandler`（method 分发：
  notes 域 + git 域）、`iconHandler`（GET 返回打包的 SVG 图标）。
- 上下文注入 `host/context-inject.ts`：监听 `agent/pre-step`，扫描已认领消息中的笔记路径
  （`.dsh-notes/…` 正则提取，相对会话 cwd 解析），读取内容并作为注入上下文消息
  （`source.kind: 'md-notes'`）折叠进模型请求——引用可靠生效，不依赖模型自觉 `read`。
- **错误码协议**：git 操作失败返回 `{ ok: false, code, error }`（如 `no-repo`、`sync-branch`、
  `git-failed`、`identity`、`remote-changed`、`non-fast-forward`），`error` 为英文 detail；
  client 用 `gitErrorText` 按 `code` 渲染本地化文案。
- HTTP 路由（`ctx.webServer.register`）：
  - `{ kind: 'prefix', path: route }`：仅接受 `POST`；body 为 `{ method, ...args }`。
  - `{ kind: 'exact', path: `${route}/icon.svg` }`：GET 返回 `assets/dsh-md-notes.svg`（`image/svg+xml`）。
- 所有副作用（路由注册、settings 注册）都包在 `ctx.effect(..., label)` 内，HMR 安全。

### Host API 端点

| method | body | 返回 |
|---|---|---|
| `list` | — | `{ ok, workspaces: [{ workspaceId, name, notesDir, notes }], noWorkspaces }`（按工作区分组；带 `sessionId` 时只返回该会话工作区，会话无工作区返回空数组） |
| `read` | `{ workspaceId?, name }` | `{ ok, name, content }` |
| `write` | `{ workspaceId?, name, content }` | `{ ok, name }` |
| `create` | `{ workspaceId?, title }` | `{ ok, name }`（空标题自动用 Untitled note） |
| `delete` | `{ workspaceId?, name }` | `{ ok, name }` |
| `appendConversation` | `{ noteName, questionText, answerText, sessionTitle? }` | `{ ok, name }`（文本由 client 从会话快照提取，host 只写文件） |
| `gitStatus` | `{ workspaceId? }` | `{ ok, status: { repoDir, subdir, branch, uncommitted, lastCommit?, remote } }` |
| `gitInit` | `{ workspaceId? }` | `{ ok }`（按 URL clone） |
| `gitPush` | `{ workspaceId?, message, overwrite? }` | `{ ok }` 或 `{ ok:false, code, changed? }` |
| `gitPull` | `{ workspaceId?, force? }` | `{ ok, skipped?, changed? }` |
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
  切换跨工作区（中文名已支持，仅空格受限，见 TODO 2.3）；`onPick` 返回 `ReferenceInsert`
  （`ref` = **会话工作区相对路径**：同工作区 `.dsh-notes/xxx.md`、跨工作区 `../<目录>/…`，
  `label` = 前置截断标题）；`codec.serialize` 提交时校验笔记仍存在并输出**标准 markdown
  链接** `[标题](路径)`，失效则抛本地化错误阻断发送；
  `warm`/`lexicon`/`subscribeLexicon` 提供纯文本装饰热快照。无 `inputTriggers` 时特性静默
  禁用（console.warn）。序列化格式与交互细节见 [context.md](context.md)。
  序列化格式与交互细节见 [context.md](context.md)。
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
- client bundle 协议（`tsdown.config.ts`）：输出 CJS closure-factory，经
  `window.__ModuleLoader__.load({ id, factory })` 加载；平台模块保持 external，其余依赖内联。

## 6. 配置

```yaml
# 在 profile 的 cordis.patch.yml 或更高层覆盖（会整体替换该行的 config）
- id: md-notes
  config:
    route: '/plugins/md-notes'    # HTTP API 前缀；默认即可
    gitMode: 'off'                # 'off' | 'shared' | 'own'（旧值 'on' 归一化）
    gitCentralRemote: ''          # 共享仓库 URL（L2 默认）
    gitCentralBranch: ''          # 共享仓库分支（L2 默认，留空=main）
    gitRepos: {}                  # 每工作区 { remote?, branch?, subpath? }（L2 默认）
    gitAutoPull: true             # 打开笔记时自动拉取
    gitAuthorName: ''             # 提交作者名（空=用 git 全局配置）
    gitAuthorEmail: ''            # 提交作者邮箱
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
