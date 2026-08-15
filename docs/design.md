# dsh-md-notes 设计文档

DSH 第三方插件（bundle）"MD 笔记管理"的设计说明：架构、目录结构、开发环境、配置与实现细节。

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
├── tsconfig.json         # host program（exclude src/client）
├── tsconfig.client.json  # client program（jsx: react-jsx）
├── tsdown.config.ts      # client bundle 构建（复刻仓库 tsdown.client.ts 协议）
├── docs/
│   └── design.md         # 本文档
├── scripts/
│   └── link-deps.mjs     # 开发期链接 deepseek-harness checkout 类型
└── src/
    ├── index.ts          # host 入口：函数插件 + HTTP API
    └── client/
        ├── index.tsx     # 浏览器入口：三个 slot + fetch
        └── styles.ts     # 注入的样式（CSS 字符串）
```

## 3. Host 半（src/index.ts）

- 插件导出：`name`（`md-notes`）、`inject`（`webServer`）、`Config`（schemastery schema：
  `root`、`route`）、`apply(ctx, config)`。
- 笔记目录解析规则（`notesDir`）：
  - `config.root` 显式给出 → 直接作为最终目录；
  - 未配置 → 回退到 `join(process.cwd(), '.dsh-notes')`。
- 文件名规范化（`sanitizeName`）：去除路径分隔符/非法字符，强制 `.md` 后缀。
- HTTP 路由（`ctx.webServer.register({ kind: 'prefix', path: route, handler })`）：
  - 仅接受 `POST`；body 为 `{ method, ...args }`；
  - 每个 `method` 映射一个文件操作；`appendConversation` 额外读取
    `ctx.get('sessionQuery')` 以把指定消息的「用户提问 + 回答」格式化成 markdown 追加。
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

## 4. Client 半（src/client/index.tsx）

- `inject: ['slots']`；`apply` 里注入样式（`<style data-plugin="dsh-md-notes">`）并注册三个 slot：
  - `sidebar.footer.action` → 📓 侧边栏入口（独占一行、位于底部区域最上一行，JS 强制父 flex 换行）；
  - `conversation.chat.assistant-actions` → 📝 记入笔记图标；
  - `shell.overlay` → 笔记管理器（列表 + 编辑/预览）与记入笔记选择弹窗。
- 组件间通过 `apply` 闭包里的 `NotesStore`（pub/sub）共享打开状态。
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
  覆盖默认的 `/Users/xiezongchen/space/deepseek/deepseek-harness`。
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

本机部署（web profile）已在 `~/.dsh/profiles/web/cordis.patch.yml` 配置：

```yaml
- id: md-notes
  config:
    root: '/Users/xiezongchen/space/deepseek/dsh-work/.dsh-notes'
    route: '/plugins/md-notes'
```

## 7. 实现要点与约定

- 笔记是普通 `.md` 文件，可直接在文件系统编辑；`meta.json` 为最佳努力缓存，
  缺失/损坏时按文件名回退标题。
- `appendConversation` 只取消息 content 的 `text`（`reasoning` 以引用块、`image` 以占位符呈现）。
- 删除文件用 `node:fs/promises` 的 `rm`；目录创建用 `mkdir({ recursive: true })`。
- 样式使用主题 CSS 变量（`--dsw-alias-*`），同时带静态兜底值，明暗主题均可读。
