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
  <a href="docs/usage.zh.md">使用文档</a> · <a href="docs/features.md">功能设计</a> · <a href="docs/architecture.md">架构设计</a> · <a href="docs/context.md">上下文引用</a> · <a href="docs/TODO.md">路线规划</a> · <a href="CHANGELOG.zh.md">变更记录</a>
</p>

---

## 概述（Overview）

一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的笔记插件：提供完整的 **MD 笔记管理器** 和 **MD 笔记编辑器**，对话内容可快速记入笔记。笔记可同步 Git 仓库维护。对话时可将笔记加入上下文。

**适合谁**：DSH Web 用户，想要本地、基于文件的笔记（无数据库、无云）——一键把对话存进笔记，之后在任意编辑器里继续编辑，并可用 Git 仓库备份 / 多端同步。

**当前功能**：

- **侧边栏笔记入口** → 全屏笔记管理器：按工作区分组的笔记列表（可折叠）、markdown 编辑/预览、保存、删除（页面内确认）、一键新建。
- **回答操作栏**（复制按钮旁）→ 选择或新建一篇笔记，把该段对话（用户提问 + 回答）**即时**追加进去——文本直接取自对话本身，无需等待；分段标签跟随界面语言（思考内容不记入，只保留最终回答）。
- **对话引用笔记（`@`）**：输入 `@` 选择笔记（支持跨工作区），发送时 host 把笔记内容注入模型上下文——模型直接引用，无需提示它读取文件。
- **Git 同步**（可选，URL 驱动）：**共享仓库**模式（一个仓库管所有工作区，按工作区分子目录）或**独立仓库**模式（每工作区：URL + 分支 + 子路径）。推送 = 镜像同步（含删除）；更新 = 拉取 + 冲突确认；打开笔记自动拉取；推送被拒可「合并远端并重试」。
- **设置面板**（dsh 设置 → MD 笔记）：模式、仓库 URL / 分支 / 子路径、自动拉取、提交作者——表单控件与 dsh 原生一致。
- **主题与国际化**：token 化配色适配明暗主题；UI 文案跟随 dsh 语言（中 / 英）；错误信息本地化。
- **版本更新提示**：npm 有新版时显示黄色「有新版本需要更新」tag。

**规划中**（见 [docs/TODO.md](docs/TODO.md)）：Git 冲突渲染与可视化解决、笔记能力增强（搜索 / 标题目录 / 互链反链等）、交互体验优化（未推送提醒、记入后台化等）。

## 兼容性（Compatibility）

- **已验证插件版本**：0.6.0（历史见 [CHANGELOG.zh.md](CHANGELOG.zh.md)）。
- **已验证dsh版本**：deepseek-harness mainline `0.1.1-rc.2`。
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
2. **新建笔记**：点击侧边栏底部（设置上方）的笔记入口 → 在工作区行点「+」（自动生成「未命名笔记 <日期>」标题）→ 编辑内容 → **保存**。
3. **记入对话**：在某条回答下方点笔记图标（复制按钮旁）→ 选择目标笔记（或现场新建）→ **写入笔记**。该回答及对应的用户提问会以「会话标题 -- 时间戳」分段追加到笔记末尾。
4. **引用笔记**：在输入框输入 `@` 选择笔记（可跨工作区），发送后笔记内容自动进入模型上下文。

笔记文件存放在各工作区的 `.dsh-notes/` 目录（`<工作区>/.dsh-notes`），随时可以直接用任意编辑器打开修改。Git 同步为可选功能——配置一个仓库 URL 即可把笔记同步到远程（共享仓库或每工作区独立仓库）。

> 关于插件的全部功能与使用方式——笔记管理、记入对话、Git 同步（共享 / 独立仓库）、推送与更新、冲突处理、设置面板——请参阅 [使用文档](docs/usage.zh.md)。

## 配置（Configuration）

所有选项都是插件 Config 键，可在 profile 的 `cordis.patch.yml` 中覆盖（patch 会整体替换该行的 `config`）：

```yaml
- id: md-notes
  config:
    route: '/plugins/md-notes'   # HTTP API 前缀；默认即可
    gitMode: 'off'               # 'off' | 'shared' | 'own'
    gitAutoPull: true            # 打开笔记时自动拉取远程
```

| 键 | 默认值 | 含义 |
|---|---|---|
| `route` | `/plugins/md-notes` | 插件提供的 HTTP API 前缀；图标同时由 `<route>/icon.svg` 提供。 |
| `gitMode` | `'off'` | Git 同步模式：`'off'` 关闭 / `'shared'` 共享仓库 / `'own'` 每工作区独立仓库。 |
| `gitAutoPull` | `true` | 打开笔记时是否自动拉取远程版本。 |

插件配置**不含环境变量，也不涉及任何密钥**。

## 权限与数据（Permissions & data）

- **文件系统**：只读写各工作区 `.dsh-notes` 目录下的笔记（普通 `.md` 文件 + `meta.json` 缓存；笔记深度绑定工作区）；git 操作只触碰 `$DSH_HOME/md-notes-repos/` 下插件管理的 clone。
- **网络**：仅本机回环 HTTP API（`POST <route>`，浏览器 ↔ 本地 dsh 服务）与同源图标请求。**无外部网络调用、无遥测。**
- **凭据**：不收集、不传输任何凭据。

## 故障排查（Troubleshooting）

| 现象 | 处理 |
|---|---|
| 安装/升级后改动不生效 | 重启 dsh web —— bundle 层与 client 元数据缓存在进程内。 |
| 图标没更新 | 强制刷新页面；图标以 `no-cache` 提供，每次请求都会反映 `assets/dsh-md-notes.svg` 的最新内容。 |
| 插件没加载 | 验证层：`dsh --profile web --dump-config`，查找 `md-notes` 行。 |
| 从 git 安装且 `add` 失败 | pnpm ≥10 默认拦截构建脚本；把打印出的包键加入 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds`，然后重跑 `add`。 |
| 笔记无法创建/保存 | 先在 dsh 侧边栏新建工作区，确认其 `.dsh-notes` 目录存在且可写。 |

回滚：`dsh plugin --profile web remove dsh-md-notes` 即可恢复（笔记文件不受影响）。

## 贡献（Contributing）
详细内容见 [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md)。

## 仓库结构（Repository structure）

| 路径 | 内容 |
|---|---|
| `src/` | 源码（host 半 + client 半） |
| `src/host/` | 笔记领域（`notes.ts`）+ Git（`git.ts`）+ HTTP 层（`http.ts`）+ 上下文注入（`context-inject.ts`）+ 写入互斥（`keyed-lock.ts`） |
| `src/client/` | 浏览器半：入口（`index.ts`）+ `features/` 下的功能模块 |
| `src/client/features/locales/` | 中/英 UI 字典（dsh locale 命名空间 `md-notes`） |
| `assets/` | 插件图标（SVG 源文件 + PNG） |
| `docs/` | 文档：`usage.md`/`usage.zh.md`（使用）、`features.md`（功能）、`architecture.md`（架构）、`context.md`（@ 引用）、`git.md`（Git 同步）、`state.md` / `write-lock.md`（状态与写锁设计）、`TODO.md` |
| `scripts/` | 开发工具（如 `link-deps.mjs`） |
| `lib/` | 构建产物（gitignored；npm 发布内容） |

## 许可证与安全（License & security）

使用 **MIT 许可证**（见 [LICENSE](LICENSE)）。

安全问题：请通过仓库的 [Security Advisory](https://github.com/XieZongChen/dsh-md-notes/security/advisories) **私下**报告，而不是公开 issue，以便在披露前处理。
