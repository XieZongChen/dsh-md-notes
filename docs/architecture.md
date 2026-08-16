# dsh-md-notes 架构设计文档

DSH 第三方插件（bundle）"MD 笔记管理"的架构设计：架构、目录结构、开发环境、配置与实现细节。
功能设计见 [features.md](features.md)。

## 1. 架构

插件是一个可安装的 npm bundle 包，同时扮演两个角色：

- **Host 半**（`lib/index.js`）：函数插件（`name` / `inject` / `Config` / `apply`），
  通过 `ctx.webServer` 暴露一个 JSON API 路由 `POST /plugins/md-notes`（body 携带 `method`：
  `list` / `read` / `write` / `create` / `delete` / `appendConversation`）。
  笔记以 `.md` 文件存储（默认 `<cwd>/.dsh-notes`，可用 Config `root` 覆盖），
  `meta.json` 记录每篇笔记的标题与更新时间。
- **Client 半**（`lib/client.js`）：通过 `dsh.client` 声明 + `exports["./client"]` 被
  `dsh-client-modules` 扫描进 `window.__DSH_BOOT__`，在浏览器里作为 cordis 插件运行；
  注册三个 slot（`sidebar.footer.action`、`conversation.chat.assistant-actions`、`shell.overlay`），
  通过 `fetch` 调用 Host 的 HTTP API。

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
│   └── architecture.md    # 本文档（架构设计）
├── scripts/
│   └── link-deps.mjs     # 开发期链接 deepseek-harness checkout 类型
└── src/
    ├── index.ts          # host 插件入口（name/inject/Config/apply，纯装配）
    ├── host/
    │   ├── notes.ts      # 笔记领域逻辑（目录/元数据/各操作方法）
    │   └── http.ts       # HTTP 工具 + 路由 handler 组装
    └── client/
        ├── index.ts     # 入口（组装层，无 JSX）：apply + 三个 slot 注册 + NotesOverlay
        └── features/
            ├── api.ts            # Host HTTP API 封装
            ├── store.ts          # NotesStore（pub/sub 共享状态）
            ├── markdown.ts       # markdown 渲染器（纯函数）
            ├── locales/          # i18n：zh.ts（源字典）/ en.ts（同键映射）+ LocaleNamespaceMap 合并
            ├── styles.module.css # 共享样式（mask/dialog/btn/input 等）
            ├── NotesEntry/       # 侧边栏入口（NotesEntry.tsx + notes-entry.module.css）
            ├── NoteAction/       # 记入笔记图标（NoteAction.tsx + note-action.module.css）
            ├── NotePicker/       # 记入笔记弹窗（NotePicker.tsx + note-picker.module.css）
            └── NotesManager/     # 笔记管理面板（NotesManager.tsx + notes-manager.module.css）
```

## 3. Host 半（src/）

- 插件入口 `index.ts`：导出 `name`（`md-notes`）、`inject`（`webServer`）、`Config`（schemastery
  schema：`root`、`route`）、`apply(ctx, config)`；`apply` 只做装配——解析目录、构建 handler、注册路由。
- 领域逻辑 `host/notes.ts`：`notesDir` / `sanitizeName` / `titleOf` / `blocksToText` + 六个操作方法
  （`listNotes` / `readNote` / `writeNote` / `createNote` / `deleteNote` / `appendConversation`），
  全部为纯函数（目录参数注入，无 ctx 依赖），可独立测试。
- HTTP 层 `host/http.ts`：`readBody`（有界 JSON 读取）、`sendJson`、`notesApiHandler`（method 分发）、
  `iconHandler`（GET 返回打包的 SVG 图标）。
- HTTP 路由（`ctx.webServer.register`）：
  - `{ kind: 'prefix', path: route }`：仅接受 `POST`；body 为 `{ method, ...args }`；
    每个 `method` 映射一个领域操作；`appendConversation` 额外读取
    `ctx.get('sessionQuery')` 以把指定消息的「用户提问 + 回答」格式化成 markdown 追加。
  - `{ kind: 'exact', path: `${route}/icon.svg` }`：GET 返回 `assets/dsh-md-notes.svg`（`image/svg+xml`），
    供 client 用 `<img>` 引用；exact 表先于 prefix 匹配，不会被 API 路由拦截。
- 所有副作用（路由注册）都包在 `ctx.effect(..., label)` 内，HMR 安全。

### Host API 端点

| method | body | 返回 |
|---|---|---|
| `list` | — | `{ ok, notes: [{ name, title, updatedAt }], dir }` |
| `read` | `{ name }` | `{ ok, name, content }` |
| `write` | `{ name, content }` | `{ ok, name }` |
| `create` | `{ title }` | `{ ok, name }`（空标题自动用"未命名笔记"） |
| `delete` | `{ name }` | `{ ok, name }` |
| `appendConversation` | `{ noteName, sessionId, messageId }` | `{ ok, name }` |

## 4. Client 半（src/client/）

- 入口 `index.ts`（无 JSX，用 `React.createElement`）：`inject: ['slots', 'locale']`；`apply` 里
  注册 `md-notes` locale 字典（`ctx.locale.register`），创建共享 `NotesStore` 并注册三个 slot
  （每个注册带 `locale: 'md-notes'`，组件 props 自动注入 `t`）：
  - `sidebar.footer.action` → 侧边栏入口（独占一行、位于底部区域最上一行，JS 强制父 flex 换行）；
  - `conversation.chat.assistant-actions` → 记入笔记图标；
  - `shell.overlay` → 笔记管理器（列表 + 编辑/预览）与记入笔记选择弹窗。
- **i18n**：所有 UI 文案放在 `features/locales/`（`zh.ts` 为源字典、`en.ts` 用映射类型强制同键，
  在 `@deepseek-ai/dsh-client-ui-slots` 的 `LocaleNamespaceMap` 里合并 `md-notes` 命名空间）；
  组件从 slot 注入的 `t(key, params)` 读取文案，随 dsh 语言设置（`locale/change`）自动重渲染；
  flash/status 等状态只存 key，渲染时才翻译。占位符用 `{name}` 模板。
- 图标：`<img src="/plugins/md-notes/icon.svg">` 直接引用 host serve 的 SVG 文件（`api.ts` 导出
  `ICON_URL`），不内联任何 path —— 单一事实来源，改 `assets/dsh-md-notes.svg` 即生效。
- 目录约定：功能模块放在 `features/` 下，**每个功能一个子目录**，`index.tsx` 与 `styles.module.css` 成对；
  共享模块（`api.ts` / `store.ts` / `markdown.ts`）与共享样式 `styles.module.css` 直接放在 `features/` 根。
- 样式用 **CSS Modules**：`import styles from './styles.module.css'`，构建时编译为哈希类名并注入
  `<style data-plugin-css="dsh-md-notes/<file>">`（tsdown 的 `dsh-md-notes-css-modules` 插件，
  `sourceAssetPath` 把 `lib/client/` 下的导入映射回 `src/client/`）。
- markdown 预览用内置轻量渲染器（先 HTML 转义，再逐行渲染标题/列表/引用/代码块/内联样式）。
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
  覆盖默认 checkout 路径（默认解析为脚本目录上两级目录下的 `deepseek-harness`）。
- **host 与 client 必须两个 tsc program**：host 侧 `dsh-session` 与浏览器侧
  `dsh-client-runtime` 对 `Context.sessions` 的声明不同，同一 program 内会冲突；
  host program `exclude: ["src/client"]`，client program 只编译浏览器侧。
- client bundle 协议（`tsdown.config.ts`）：输出 CJS closure-factory，经
  `window.__ModuleLoader__.load({ id, factory })` 加载；平台模块保持 external，
  其余依赖内联。

## 6. 配置

```yaml
# 在 profile 的 cordis.patch.yml 或更高层覆盖（会整体替换该行的 config）
- id: md-notes
  config:
    root: '/abs/path/to/notes'   # 最终笔记目录；默认 <cwd>/.dsh-notes
    route: '/plugins/md-notes'   # HTTP API 前缀；默认即可
```

本机部署（web profile）已在 `~/.dsh/profiles/web/cordis.patch.yml` 配置，
`root` 指向本机工作区下的 `.dsh-notes` 目录（示例，按需替换）：

```yaml
- id: md-notes
  config:
    root: '<工作区>/.dsh-notes'
    route: '/plugins/md-notes'
```

## 7. 实现要点与约定

- 笔记是普通 `.md` 文件，可直接在文件系统编辑；`meta.json` 为最佳努力缓存，
  缺失/损坏时按文件名回退标题。
- `appendConversation` 只取消息 content 的 `text`（`reasoning` 以引用块、`image` 以占位符呈现）。
- 删除文件用 `node:fs/promises` 的 `rm`；目录创建用 `mkdir({ recursive: true })`。
- 样式使用主题 CSS 变量（`--dsw-alias-*`），同时带静态兜底值，明暗主题均可读。
