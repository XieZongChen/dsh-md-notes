<p align="center">
  <img src="assets/dsh-md-notes.png" width="96" alt="dsh-md-notes" />
</p>

<h1 align="center">dsh-md-notes</h1>

<p align="center">
  <a href="README.md">English</a>
</p>

<p align="center">
  DSH 第三方插件（bundle）：<b>MD 笔记管理</b>
  <br />
  <a href="docs/features.md">功能设计</a> · <a href="docs/architecture.md">架构设计</a> · <a href="CHANGELOG.zh.md">变更记录</a>
</p>

---

## 概述（Overview）

一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的笔记插件：在 Web 侧边栏增加 **MD 笔记** 入口，并在每条回答下方提供「发送到笔记」操作，把对话一键记入普通 `.md` 文件，随时可用任意编辑器打开修改。

**适合谁**：DSH Web 用户，想要本地、基于文件的笔记（无数据库、无云）——一键把对话存进笔记，之后在任意编辑器里继续编辑。

- **侧边栏笔记入口** → 笔记管理界面（列表 + 编辑/预览）
- **回答操作栏**（复制按钮旁）→ 把该段对话记入指定笔记
- 笔记以普通 `.md` 文件存储，可直接在文件系统编辑
- UI 文案跟随 dsh 语言设置（中 / 英）

## 兼容性（Compatibility）

- **插件版本**：0.2.0（历史见 [CHANGELOG.zh.md](CHANGELOG.zh.md)）。
- **要求**：`dsh` CLI（含 `plugin` 子命令）与 `web` profile。
- **最后验证**：2026-08-16，针对 deepseek-harness mainline checkout（dsh CLI `0.1.0-rc.x` 时期）。
- 插件未绑定具体 mainline commit；如需固定组合，请在安装时固定插件版本。运行时依赖（`@deepseek-ai/*`、`react`）以可选 peer 依赖声明，从 dsh 安装中解析。

## 安装 / 卸载（Install / Uninstall）

前置：已安装 `dsh` CLI，目标 profile 为 `web`。

从 npm 安装（推荐）：

```sh
dsh plugin --profile web add dsh-md-notes
```

然后**重启 dsh web**（bundle 层与 client 包元数据在进程内缓存，必须重启才生效）。

升级：

```sh
dsh plugin --profile web update dsh-md-notes
```

同样需要重启 dsh web 生效。

卸载：

```sh
dsh plugin --profile web remove dsh-md-notes
```

> 从源码调试（开发用）：在插件工程目录的上一级执行
> `dsh plugin --profile web add ./dsh-md-notes`。

## 快速开始（Quick start）

1. 安装插件（见上），重启 dsh web。
2. **新建笔记**：点击侧边栏底部（设置上方）的笔记入口 → 在「新笔记标题…」输入标题 → **新建** → 编辑内容 → **保存**。
3. **记入对话**：在某条回答下方点笔记图标（复制按钮旁）→ 选择目标笔记（或现场新建）→ **写入笔记**。该回答及对应的用户提问会带时间戳分段追加到笔记末尾。

笔记文件存放在本机配置的目录（默认 `<cwd>/.dsh-notes/`），随时可以直接用任意编辑器打开修改。

## 配置（Configuration）

所有选项都是插件 Config 键，可在 profile 的 `cordis.patch.yml` 中覆盖（patch 会整体替换该行的 `config`）：

```yaml
- id: md-notes
  config:
    root: '/abs/path/to/notes'   # 笔记目录；默认 <cwd>/.dsh-notes
    route: '/plugins/md-notes'   # HTTP API 前缀；默认即可
```

| 键 | 默认值 | 含义 |
|---|---|---|
| `root` | `<cwd>/.dsh-notes` | 笔记（`.md` 文件 + `meta.json`）存放目录。 |
| `route` | `/plugins/md-notes` | 插件提供的 HTTP API 前缀；图标同时由 `<route>/icon.svg` 提供。 |

插件配置**不含环境变量，也不涉及任何密钥**。

## 权限与数据（Permissions & data）

- **文件系统**：只读写配置的 `root` 目录下的笔记（普通 `.md` 文件 + `meta.json` 标题/更新时间缓存），不触碰其他内容。
- **网络**：仅本机回环 HTTP API（`POST <route>`，浏览器 ↔ 本地 dsh 服务）与同源图标请求。**无外部网络调用、无遥测。**
- **凭据**：不收集、不传输任何凭据。

## 故障排查（Troubleshooting）

| 现象 | 处理 |
|---|---|
| 安装/升级后改动不生效 | 重启 dsh web —— bundle 层与 client 元数据缓存在进程内。 |
| 图标没更新 | 强制刷新页面；图标以 `no-cache` 提供，每次请求都会反映 `assets/dsh-md-notes.svg` 的最新内容。 |
| 插件没加载 | 验证层：`dsh --profile web --dump-config`，查找 `md-notes` 行。 |
| 从 git 安装且 `add` 失败 | pnpm ≥10 默认拦截构建脚本；把打印出的包键加入 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds`，然后重跑 `add`。 |
| 笔记无法创建/保存 | 确认配置的 `root` 指向存在且可写的目录。 |

回滚：`dsh plugin --profile web remove dsh-md-notes` 即可恢复（笔记文件不受影响）。

## 开发（Development）

```sh
npm install --legacy-peer-deps   # 首次或依赖变化后
npm run link-deps                # 链接 deepseek-harness checkout 类型（改代码前）
npm run build                    # 构建 lib/index.js + lib/client.js
```

改完代码、构建成功后，重启 dsh web 生效。

常用脚本：

| 命令 | 作用 |
|---|---|
| `npm run build` | 完整构建（tsc host → tsc client → tsdown） |
| `npm run typecheck` | 仅类型检查（两个 program） |
| `npm run link-deps` | 重链 `@deepseek-ai/*` 类型到 checkout |
| `npm run bundle` | 仅构建 client bundle |

欢迎贡献：先开 issue 讨论，再提 PR。设计文档：[docs/features.md](docs/features.md) · [docs/architecture.md](docs/architecture.md)。

## 仓库结构（Repository structure）

| 路径 | 内容 |
|---|---|
| `src/` | 源码（host 半 + client 半） |
| `src/host/` | 笔记领域逻辑（`notes.ts`）+ HTTP 层（`http.ts`） |
| `src/client/` | 浏览器半：入口（`index.ts`）+ `features/` 下的功能模块 |
| `src/client/features/locales/` | 中/英 UI 字典（dsh locale 命名空间 `md-notes`） |
| `assets/` | 插件图标（SVG 源文件 + PNG） |
| `docs/` | 设计文档：`features.md`（功能）、`architecture.md`（架构）、`TODO.md` |
| `scripts/` | 开发工具（如 `link-deps.mjs`） |
| `lib/` | 构建产物（gitignored；npm 发布内容） |

## 许可证与安全（License & security）

使用 **MIT 许可证**（见 [LICENSE](LICENSE)）。

安全问题：请通过仓库的 [Security Advisory](https://github.com/XieZongChen/dsh-md-notes/security/advisories) **私下**报告，而不是公开 issue，以便在披露前处理。
