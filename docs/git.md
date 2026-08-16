# Git 同步功能设计（v3：笔记固定 .dsh-notes + 互斥仓库模式）

> 本文档梳理 dsh-md-notes 的**设置项体系**与 **Git 同步**的功能设计，是
> [TODO.md](TODO.md) 第 1 项的实现蓝图。功能设计总览见 [features.md](features.md)，
> 架构与现状见 [architecture.md](architecture.md)。

## 0. 实现状态

> 最后更新 2026-08-16。✅ 已实现（slice 1/2 + v3 模型重构）；🚧 设计已定、未实现；⏳ 待实测确认。

### 已实现

- ✅ **v3 笔记模型**：笔记本地**永远**保存在各工作区 `<ws>/.dsh-notes`；git 仓库是独立的同步目标，不再决定笔记位置（§4）
- ✅ **互斥仓库模式**（用户定案）：
  - `gitMode: 'shared'` —— 一个共享仓库（`gitCentral`），所有工作区笔记推到其 **main** 分支、以**工作区名**命名的子目录
  - `gitMode: 'own'` —— 无共享仓库；每个工作区独立配置 **仓库路径 / 分支 / 仓库内子路径** 三件套（分支默认 main、子路径默认仓库根）
  - 二选一且互斥；`gitMode: 'on'`（旧值）自动归一化：有共享仓库 → shared，否则 → own
- ✅ 三层配置模型：schema 默认 → cordis Config（L2 yaml）→ settings 命名空间 `md-notes`（L3），host 侧逐层合并
- ✅ git 执行（subprocess 收集输出）+ **授权门禁**：沙箱外仓库必须 `authorized=true`，持久化于每仓库记录
- ✅ API：`gitStatus` / `gitInit` / `gitPush` / `gitPull` / `gitAuthorize` / `gitRevoke` / `gitConfig` / `gitSync` / `gitSettings`
- ✅ **推送 = 同步**：把 `<ws>/.dsh-notes` 的 `.md` 复制到仓库目标目录（`<repo>/<subdir>`，subdir 空 = 仓库根），`git add <subdir>` → commit → push `branch` → 回拉
- ✅ **更新 = 反向同步**：pull 仓库后把 `<repo>/<subdir>` 的 `.md` 复制回本地，**不覆盖本地已修改的文件**（保守，冲突交用户）
- ✅ 提交身份解析：仓库自身 git 配置优先 → 插件 `gitAuthorName/Email` 兜底 → 都没有时明确报错
- ✅ non-fast-forward 冲突：`gitPush` 返回错误码 + client「合并远端并重试」（`gitSync`，用户触发，不自动处理）
- ✅ session→工作区路由、分组 `list`（多工作区视图）
- ✅ Client 管理器：按工作区分组、编辑器头部 更新/推送、commit 弹层面板、打开笔记自动拉取（受 `gitAutoPull` 开关控制）、底部状态行（分支/子路径/未提交/最近提交）、冲突解决 UI、i18n 中英
- ✅ **dsh 设置面板「MD 笔记」分区**（`settings.section`）：三态模式选择（off/shared/own）+ 各模式互斥的配置区（共享仓库区 / 每工作区三件套）+ 自动拉取/作者 + 仓库路径/分支/子路径文本输入 + 授权/撤销
- ✅ **授权按钮 UI**（设置面板内，shared + 各工作区仓库）：`gitAuthorize` / `gitRevoke`，持久化

### 未实现（slice 3+）

- 🚧 管理器「同步区」独立配置表单（当前配置入口在 dsh 设置面板）
- 🚧 授权走 `approval.request` 审批（当前为界面确认后直接置 `authorized`）
- 🚧 自动拉取限频（同一仓库 30s 内不重复）

### 待实测 / 待确认

- ⏳ 设置面板三态模式在真实运行中的渲染与保存（待重启验证）
- ⏳ 共享仓库模式下多工作区子目录的首次推送（`--allow-unrelated-histories` 兜底路径）

## 1. 目标

**笔记永远在本地各工作区 `<ws>/.dsh-notes`**（v3 核心）：用户无需配置"笔记保存到哪里"，
笔记就是工作区里的普通 `.md` 文件。Git 同步是可选的**独立目标**：把笔记推送到用户指定
的仓库（分支/子路径），或从远端拉回——仓库位置、分支、仓库内路径**与笔记位置完全解耦**。

组合能力（用户原话）：
- **一个仓库维护不同工作区**：共享仓库模式，每个工作区一个以工作区名命名的子目录；
- **不同工作区用不同仓库**：独立仓库模式，每个工作区配自己的仓库/分支/子路径；
- **随便组合**：两种模式互斥，模式内按工作区自由配置。

## 2. 设置项总梳理（三层配置模型）

插件的设置分布在三个地方，按**优先级从低到高**叠加：

| 层 | 载体 | 谁能改 | 用途 |
|---|---|---|---|
| L1 schema 默认 | 代码里 schemastery schema | 开发者 | 兜底默认值 |
| L2 **cordis Config** | profile 的 `cordis.patch.yml`（yaml） | 部署者/管理员 | 部署级默认（目录、API、模式开关） |
| L3 **settings 命名空间 `md-notes`** | dsh 设置文档（Host 持久化） | 用户（设置面板） | 用户级偏好，覆盖 L2 |

读取时**逐层合并**：`生效值 = { ...L2, ...L3 }`（host 侧在 apply/读取时合并）。

### 2.1 设置项总表

| 设置项 | L2 Config 键 | L3 命名空间字段 | 默认 | 说明 |
|---|---|---|---|---|
| 无工作区会话的笔记目录 | `root` | —（部署级） | `<cwd>/.dsh-notes` | 仅"无工作区"会话使用；有工作区一律 `<ws>/.dsh-notes`（§4） |
| API 前缀 | `route` | —（部署级） | `/plugins/md-notes` | HTTP API 前缀；图标由 `<route>/icon.svg` 提供 |
| Git 模式 | `gitMode` | `gitMode` | `'off'` | `'off'` 无 git；`'shared'` 共享仓库；`'own'` 独立仓库。旧值 `'on'` 归一化为 shared/own |
| 共享仓库 | `gitCentralPath` | `gitCentral` | `{}` | shared 模式：`{ path?, remote, authorized }`；所有工作区推送到其 **main** 分支 + 工作区名子目录 |
| 工作区独立仓库 | — | `gitRepos` | `{}` | own 模式：`{ [workspaceId]: { path, branch?, subpath?, remote, authorized } }`；分支默认 main、子路径默认仓库根 |
| 自动拉取 | `gitAutoPull` | `gitAutoPull` | `true` | 打开笔记时先拉取远端版本（§5.4） |
| 作者名 | `gitAuthorName` | `gitAuthorName` | `''` | 空 = 用 git 全局配置（`user.name`） |
| 作者邮箱 | `gitAuthorEmail` | `gitAuthorEmail` | `''` | 空 = 用 git 全局配置（`user.email`） |

- L2 全部可写进 `cordis.patch.yml`；L3 字段都能在**设置面板**编辑。
- 无环境变量、无密钥项。若远程需要 HTTPS 凭据，交给 git 自身的凭据助手，插件不存密码。

### 2.2 两个修改入口（用户视角）

1. **dsh 设置面板「MD 笔记」分区**（`settings.section`，主入口）：
   - 三态模式选择（关闭 / 共享仓库 / 独立仓库）；
   - **共享仓库**模式：仓库路径（文本输入）+ 远程 + 授权；
   - **独立仓库**模式：每工作区 仓库路径 + 分支 + 仓库内子路径 + 远程 + 授权（文本输入）；
   - 全局：默认分支、自动拉取、作者名/邮箱。
2. **cordis Config（yaml）**：部署级默认与开关；设置面板未覆盖时生效。

### 2.3 授权模型（沙箱外仓库）

dsh 的命令沙箱以**会话工作区（cwd）为边界**：工作区内的文件读写无需额外授权，
工作区外的路径默认被拒。git 仓库可能落在边界两侧：

| 仓库位置 | 是否需要授权 | 说明 |
|---|---|---|
| 工作区内（如 `<ws>/.dsh-notes` 或工作区内路径） | **否** | 沙箱默认放行 |
| 工作区外（**共享仓库**、或配置在工作区外的独立仓库） | **是** | 默认不可写，需用户显式授权 |

- 授权状态记入**对应仓库记录**（`gitCentral.authorized` / `gitRepos[ws].authorized`，
  宿主设置文档持久化）——重启后仍生效；host 每次执行沙箱外仓库的 git 操作前读取记录。
- 撤销授权 = 将对应 `authorized` 置回 `false`，下一条命令即恢复拒绝；仓库里的笔记
  留在原地不自动迁移。

## 3. 仓库模型（互斥双模式）

### 3.1 共享仓库模式（`gitMode: 'shared'`）

配置一个共享仓库（`gitCentral.path` + `remote`，需授权）。**所有工作区**的笔记都
推送到该仓库的 **main 分支**，每个工作区一个**以工作区名命名的子目录**：

```
<sharedRepo>/                      # gitCentral.path
├── .git/
├── <工作区A 名>/                  # 工作区名（sanitize 后）
│   └── <note>.md
└── <工作区B 名>/
    └── ...
```

- 分支**固定 main**（用户定案：存到这个仓库的 main 分支下）；
- 子目录名 = 工作区 title（非法字符清洗）；重名冲突追加 `-<id前8位>` 消歧；
- 一次 commit 可同时同步多个工作区的笔记；适合"统一备份/单远程多机同步"。

### 3.2 独立仓库模式（`gitMode: 'own'`）

**无共享仓库**。每个工作区要使用 git 同步，**必须配置** `gitRepos[ws]` 三件套：
仓库路径 + 分支 + 仓库内子路径（用户定案）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `path` | —（必填才启用） | 该工作区的 git 仓库目录 |
| `branch` | `'main'` | 推送/拉取的分支 |
| `subpath` | `''`（仓库根） | 仓库内子路径；笔记同步到 `<repo>/<subpath>/` |
| `remote` | `''` | 远程 URL；空 = 仅本地提交 |
| `authorized` | — | 沙箱外仓库的授权标记 |

组合示例（用户原话）：设置 **A 项目 / B 分支 / C 路径** → 笔记推送到 A 项目仓库的
B 分支下 C 路径文件夹。未配置的工作区不做 git 同步（笔记仍是本地普通 `.md`）。

### 3.3 仓库解析

| 配置 | 仓库 | 笔记目录（不变） |
|---|---|---|
| `gitMode: 'off'` | 无 | `<ws>/.dsh-notes` |
| `gitMode: 'shared'` + 已授权 | 共享仓库，main 分支，`<工作区名>/` 子目录 | `<ws>/.dsh-notes` |
| `gitMode: 'own'` + `gitRepos[ws].path` | 该工作区仓库，`branch`/`subpath` | `<ws>/.dsh-notes` |
| `gitMode: 'own'` 未配置 | 无仓库 | `<ws>/.dsh-notes`（git 按钮隐藏） |

## 4. 笔记目录解析逻辑

**笔记操作（list/read/write/create/delete/append）一律解析到 `<ws>/.dsh-notes`**，
与 git 模式/仓库配置完全无关（v3 定案：`resolveNotesDir` 恒为 `join(ws.path, '.dsh-notes')`）：

```
resolveNotesDir(ws) = <ws.path>/.dsh-notes        // 有工作区：永远
无工作区会话       = config.root ?? <cwd>/.dsh-notes  // 兜底
```

- **工作区识别**：host 用 `ctx.workspaceRegistry.resolveByPath(session.cwd)` 拿到
  `{ id, path, title }`（缺失/未注册时回退：用 `cwd` 的 basename 作 key）。
- **git 目标解析**（`resolveWorkspaceRepo`）：按当前模式返回 `{ repoDir, subdir, branch, remote, external, authorized }`，
  subdir = 共享模式的工作区名 / own 模式的 `subpath`；无仓库 → `undefined`（git 按钮隐藏）。
- **推送目标目录** `repoTargetDir(repo)` = `repoDir`（subdir 空）或 `join(repoDir, subdir)`。

### 4.1 笔记位置不再随 git 配置变化

v3 起笔记位置**恒定** `<ws>/.dsh-notes`：切换模式、配置/修改仓库都不改变笔记文件位置，
**不存在目录迁移问题**（旧版"笔记住在仓库里"的迁移逻辑已删除）。仓库只是同步目标。

## 5. API 与 UI 设计

### 5.1 API method（沿用 `POST <route>`）

| method | body | 返回/行为 |
|---|---|---|
| `gitStatus` | `{ workspaceId? }` | 目标仓库状态：`{ ok, repoDir, subdir, branch, uncommitted, lastCommit?, remote }` |
| `gitPush` | `{ workspaceId?, message }` | 把该工作区 `.dsh-notes` 的 `.md` 同步到仓库目标目录 → commit → push `branch` → 回拉 |
| `gitPull` | `{ workspaceId? }` | 拉取仓库（有远程时）→ 把目标目录 `.md` 复制回本地（**不覆盖本地已修改文件**） |
| `gitInit` | `{ workspaceId? }` | 按目标初始化仓库（缺 `.git` 时自动执行；`.gitignore` 忽略 `meta.json`） |
| `gitAuthorize` | `{ workspaceId? }` | 置对应仓库 `authorized=true`（持久化） |
| `gitRevoke` | `{ workspaceId? }` | 置对应仓库 `authorized=false` |
| `gitSync` | `{ workspaceId? }` | 用户触发：合并远端（`--allow-unrelated-histories` 兜底） |
| `gitConfig` | 白名单 L3 keys | 保存设置（含 `gitMode`/`gitCentral`/`gitRepos` 三件套） |
| `gitSettings` | — | 返回当前 L3 设置（设置表单用） |

- **git 操作一律仓库级**：更新/推送作用于整个目标仓库（`add` 范围 = 该工作区子目录
  或仓库根），不是单个笔记文件。
- **推送后回拉**：`gitPush` 成功后再执行一次 `gitPull`（同目标），保持本地与远端同步。
- **无远程**：`remote` 为空时推送仅做本地 commit（不 push），按钮可用。
- 笔记读写 API（list/read/write/create/delete/append）不变，目录解析见 §4。

### 5.2 交互语义

| 按钮 | 行为 | 说明 |
|---|---|---|
| **保存** | 当前笔记写入本地 `<ws>/.dsh-notes/*.md` | 只写本地，不碰 git |
| **推送** | 本地 `.dsh-notes` → 仓库目标目录（覆盖）→ commit → push `branch`（先弹 commit 面板） | 推送成功后自动回拉 |
| **更新** | 拉取仓库（有远程时）→ 目标目录 `.md` → 复制回本地 | **不覆盖本地已修改的文件**（同名内容不同则跳过并计数）；冲突交用户 |

> **冲突交用户决定**：推送被拒（non-fast-forward）→ 提示「合并远端并重试」
> （`gitSync`，用户触发）；更新时本地已修改的文件**保守跳过**，绝不自动覆盖。

### 5.3 UI 布局

- **左侧面板（按工作区）**：笔记列表按工作区分组；每个工作区头部显示工作区名。
- **编辑器头部**：笔记所在工作区配置了仓库时，「保存」左侧出现 **更新**、右侧出现
  **推送**（都作用于该工作区仓库目标）。
- **管理器头部（共享仓库已配置时）**：全局「更新」「推送」按钮——对共享仓库整仓操作。
- **commit 弹层面板**：点「推送」后按钮旁弹出小面板（popover）：提交信息输入框
  （默认「笔记更新 <时间>」）+ 确认/取消；失败显示 git 错误原文 + 中文提示。
- **底部状态行**：当前工作区仓库的分支、仓库内子路径、未提交 N 处、最近提交
  （来自 `gitStatus`）。
- **dsh 设置面板「MD 笔记」分区**：三态模式 + 互斥配置区（§2.2/§5.5）。

### 5.4 自动拉取（默认开启）

- 打开一篇笔记时（`open()`），若其工作区有仓库且设置 `gitAutoPull = true`：
  先执行 `gitPull(workspaceId)`（拉取仓库 + 复制目标目录回本地），再读取文件内容。
- 自动拉取失败/跳过（本地有修改）**不阻断打开**：显示提示，仍读取本地版本。
- 设置项 `gitAutoPull` 可在设置面板关闭。

### 5.5 dsh 设置面板「MD 笔记」分区

- `settings.section` 注册（`id: 'md-notes'`，order 10）。
- **模式三态选择**（select）：
  - **关闭**：提示"笔记仅保存在本地 `.dsh-notes`，不与 git 同步"；
  - **共享仓库**：仓库路径（文本输入）+ 远程 + 授权；提示"推到 main 分支 + 工作区名子目录"；
  - **独立仓库**：每工作区 仓库路径 + 分支 + 子路径 + 远程 + 授权（文本输入）；
    提示"推送 = 同步到该分支/子路径；更新 = 拉回（不覆盖本地修改）"。
- 全局字段：默认分支、自动拉取、作者名/邮箱；保存写 L3 命名空间。
- **tip 面板**（顶部，随模式切换文案）：说明笔记保存位置与同步目标。
- i18n：`git.*` 前缀 key（`md-notes` 命名空间，中英各一份）。

## 6. 实现步骤与定案

### 已定案

- **笔记位置恒定** `<ws>/.dsh-notes`（v3 核心，§4）：不再有"笔记住在仓库里"与目录迁移。
- **互斥模式**（§3）：shared / own 二选一；`gitMode: 'on'` 归一化兼容。
- **推送 = 同步、更新 = 反向同步且保守**（§5.2）：`gitPush` 复制本地 `.md` 到仓库目标
  目录（覆盖）→ commit → push；`gitPull` 拉取后复制回本地，同名内容不同**跳过**。
- **沙箱/授权（opt-in）**：工作区内仓库无需授权；沙箱外仓库（共享仓库、工作区外的
  独立仓库）需设置面板显式授权，持久化于每仓库记录；撤销立即生效；笔记留在原地。
- **`meta.json` 不入库**：本地缓存；远程 clone 后可重建；`.gitignore` 忽略。
- **提交身份**：仓库自身 git config 优先 → 插件兜底 → 明确报错。
- **non-fast-forward**：`gitPush` 返回错误码 + `gitSync`（用户触发合并重试）。
- **自动提交本期不实现**：`gitAutoCommit` 已从设置项移除；不做保存后自动 commit。
- **自动拉取**：受 `gitAutoPull` 开关控制；保守跳过本地已修改文件；限频留待 slice 3。
- **授权流程**：当前为界面确认后直接置 `authorized`；`approval.request` 审批接入
  留待 slice 3。

### 待实现（slice 3+）

- 管理器「同步区」独立配置表单（当前入口在 dsh 设置面板）；
- `approval.request` 审批接入授权流程；
- 自动拉取限频（同一仓库 30s 内不重复）。
