# Git 同步功能设计（v4：笔记固定 .dsh-notes + URL 驱动仓库 + 互斥双模式）

> 本文档梳理 dsh-md-notes 的**设置项体系**与 **Git 同步**的功能设计。功能设计
> 总览见 [features.md](features.md)，架构与现状见 [architecture.md](architecture.md)。

## 0. 实现状态

> 最后更新 2026-08-16。✅ 已实现；🚧 设计已定、未实现；⏳ 待实测确认。

### 已实现

- ✅ **v4 笔记模型**：笔记本地**永远**保存在各工作区 `<ws>/.dsh-notes`；git 仓库是独立同步目标（§4）
- ✅ **URL 驱动仓库**：仓库只通过 **git URL** 标识，插件在 `$DSH_HOME/md-notes-repos/<url-hash>/`
  管理本地 clone —— **用户不填路径，无授权流程**（§3）
- ✅ **互斥仓库模式**：
  - `gitMode: 'shared'` —— 一个共享仓库（URL + 可选分支），所有工作区笔记推到该分支、
    以**工作区名**命名的子目录（分支默认 main）
  - `gitMode: 'own'` —— 无共享仓库；每个工作区独立配置 **URL / 分支 / 仓库内子路径**
    （分支默认 main、子路径默认仓库根）
  - 二选一且互斥；`gitMode: 'on'`（旧值）自动归一化：有共享 URL → shared，否则 → own
- ✅ 三层配置模型：schema 默认 → cordis Config（L2 yaml）→ settings 命名空间 `md-notes`（L3）
- ✅ API：`gitStatus` / `gitInit` / `gitPush` / `gitPull` / `gitConfig` / `gitSync` / `gitSettings`
- ✅ **推送 = 镜像同步**：`git clone`（首次）→ 确保目标分支 → 把 `<ws>/.dsh-notes` 的 `.md`
  复制到 clone 的目标目录（`<subdir>`，空 = 仓库根）→ **删除远端有而本地无的 `.md`（删除同步）**
  → `git add -A <subdir>` → commit → push `branch`
- ✅ **更新 = 反向同步**：先 `git fetch origin` 再对齐分支 → 把 `<subdir>` 的 `.md` 复制回本地，
  **不覆盖本地已修改的文件**（保守）；`changed` 返回「远端有本地无/同名不同内容」的笔记名单
- ✅ **推送冲突检测**：推送前比较远端与本地同名笔记（`changedNotes`）+ 远端独有文件
  （`remoteOnlyNotes`），有差异返回 `remote-changed` + 变更名单，弹页面内 Modal 确认后覆盖/删除
- ✅ 提交身份解析：仓库自身 git 配置优先 → 插件 `gitAuthorName/Email` 兜底 → 都没有时明确报错（错误码 `identity`）
- ✅ non-fast-forward 冲突：`gitPush` 返回错误码 + client「合并远端并重试」（`gitSync`，用户触发）
- ✅ **i18n 错误码**：host 错误返回 `{ code, detail }`（`no-repo` / `sync-branch` / `git-failed` /
  `identity` / `non-fast-forward` / `remote-changed` 等），client 用 `gitErrorText` 渲染中英文案
- ✅ **页面内确认弹窗**：删除/推送覆盖/更新覆盖统一用 `Modal`（不依赖原生 confirm），
  推送按钮「用本地覆盖远端」、更新按钮「用远端覆盖本地」
- ✅ **分支空串回退**：仓库分支留空自动回退 `main`（`??` 不兜底空串的坑已修）
- ✅ **拉取后刷新列表**：静默/手动更新成功后会重新 list，远端新增笔记立即出现在左侧面板
- ✅ session→工作区路由、分组 `list`（多工作区视图）
- ✅ Client 管理器：按工作区分组、编辑器头部 更新/推送、commit 弹层面板、打开笔记自动拉取
  （受 `gitAutoPull` 控制）、底部状态行（分支/子路径/未提交/最近提交）、冲突解决 UI、i18n 中英
- ✅ **dsh 设置面板「MD 笔记」分区**（`settings.section`）：三态模式选择 + 互斥配置区
  （共享仓库区：URL+分支；独立仓库区：每工作区 URL+分支+子路径）+ 自动拉取/作者

### 未实现（slice 3+）

- 🚧 管理器「同步区」独立配置表单（当前配置入口在 dsh 设置面板）
- 🚧 自动拉取限频（同一仓库 30s 内不重复）

### 待实测 / 待确认

- ⏳ 首次 `git clone` 的凭据交互（HTTPS 走 git credential helper；SSH key 由用户预先配置）
- ⏳ 共享仓库模式多工作区子目录的首次推送（`--allow-unrelated-histories` 兜底路径）
- ⏳ 同一 URL 的共享/独立仓库共用 clone 目录的行为

## 1. 目标

**笔记永远在本地各工作区 `<ws>/.dsh-notes`**：用户无需配置"笔记保存到哪里"，笔记就是
工作区里的普通 `.md` 文件。Git 同步是可选能力：**填一个 git URL**，插件自动 clone 并在
推送/更新时把笔记与仓库目标目录（分支/子路径）双向同步。

组合能力（用户定案）：
- **共享仓库**：一个 URL，所有工作区推到同一仓库（各自以工作区名命名的子目录）；
- **独立仓库**：每个工作区自己的 URL（+ 分支 + 仓库内子路径）；
- **随便组合**：两种模式互斥，模式内自由配置。

## 2. 设置项总梳理（三层配置模型）

| 层 | 载体 | 谁能改 | 用途 |
|---|---|---|---|
| L1 schema 默认 | 代码里 schemastery schema | 开发者 | 兜底默认值 |
| L2 **cordis Config** | profile 的 `cordis.patch.yml`（yaml） | 部署者/管理员 | 部署级默认 |
| L3 **settings 命名空间 `md-notes`** | dsh 设置文档（Host 持久化） | 用户（设置面板） | 用户级偏好，覆盖 L2 |

读取时**逐层合并**：`生效值 = { ...L2, ...L3 }`。

### 2.1 设置项总表

| 设置项 | L2 Config 键 | L3 命名空间字段 | 默认 | 说明 |
|---|---|---|---|---|
| 无工作区会话的笔记目录 | `root` | —（部署级） | `<cwd>/.dsh-notes` | 仅"无工作区"会话使用；有工作区一律 `<ws>/.dsh-notes` |
| API 前缀 | `route` | —（部署级） | `/plugins/md-notes` | HTTP API 前缀 |
| Git 模式 | `gitMode` | `gitMode` | `'off'` | `'off'` / `'shared'` / `'own'`；旧值 `'on'` 归一化 |
| 共享仓库 | `gitCentralRemote` | `gitCentral` | `{}` | shared：`{ remote?, branch? }`；所有工作区推送到该分支 + 工作区名子目录 |
| 工作区独立仓库 | — | `gitRepos` | `{}` | own：`{ [workspaceId]: { remote?, branch?, subpath? } }` |
| 自动拉取 | `gitAutoPull` | `gitAutoPull` | `true` | 打开笔记时先拉取远端版本 |
| 作者名 | `gitAuthorName` | `gitAuthorName` | `''` | 空 = 用 git 全局配置 |
| 作者邮箱 | `gitAuthorEmail` | `gitAuthorEmail` | `''` | 空 = 用 git 全局配置 |

### 2.2 配置入口（用户视角）

**dsh 设置面板「MD 笔记」分区**（主入口）：
- 三态模式选择（关闭 / 共享仓库 / 独立仓库）；
- **共享仓库**：仓库 URL + 分支（可不填，默认 main）；
- **独立仓库**：每工作区 仓库 URL + 分支（可不填，默认 main）+ 仓库内路径（可不填，默认仓库根）；
- 全局：自动拉取、作者名/邮箱。

## 3. 仓库模型（URL 驱动 + 互斥双模式）

### 3.1 本地 clone 由插件管理

仓库只通过 URL 标识；插件在 `$DSH_HOME/md-notes-repos/<sha1(url)[:12]>/` 维护本地 clone：

```
$DSH_HOME/md-notes-repos/<url-hash>/      # git clone <url> 的结果
├── .git/
├── <工作区A 名>/                          # shared 模式：每个工作区一个子目录
│   └── <note>.md
└── <note>.md                              # own 模式 subpath=''：直接放仓库根
```

- 同一 URL → 同一 clone 目录，共享仓库与独立仓库共用 URL 时保持一致；
- 首次 git 操作自动 `git clone`；凭据交给 git 自身（HTTPS credential helper / SSH key）；
- **不需要授权**：clone 在插件管理的 DSH_HOME 下，用户从未指定路径。

### 3.2 共享仓库模式（`gitMode: 'shared'`）

配置共享仓库 URL（`gitCentral.remote`）+ 可选分支（`gitCentral.branch`，默认 main）。
**所有工作区**的笔记都推送到该仓库的该分支，每个工作区一个**以工作区名命名的子目录**。

### 3.3 独立仓库模式（`gitMode: 'own'`）

**无共享仓库**。每个工作区配置 `gitRepos[ws]`：

| 字段 | 默认 | 说明 |
|---|---|---|
| `remote` | —（必填才启用） | 该工作区的 git 仓库 URL |
| `branch` | `'main'` | 推送/拉取的分支 |
| `subpath` | `''`（仓库根） | 仓库内子路径；笔记同步到 `<clone>/<subpath>/` |

组合示例：**A 仓库 / B 分支 / C 路径** → 笔记推送到 A 仓库的 B 分支下 C 路径文件夹。

### 3.4 仓库解析

| 配置 | 仓库 | 笔记目录（不变） |
|---|---|---|
| `gitMode: 'off'` | 无 | `<ws>/.dsh-notes` |
| `gitMode: 'shared'` + URL | 共享仓库，`branch`/`<工作区名>/` | `<ws>/.dsh-notes` |
| `gitMode: 'own'` + `gitRepos[ws].remote` | 该工作区仓库，`branch`/`subpath` | `<ws>/.dsh-notes` |
| `gitMode: 'own'` 未配置 | 无仓库 | `<ws>/.dsh-notes`（git 按钮隐藏） |

## 4. 笔记目录解析逻辑

**笔记操作一律解析到 `<ws>/.dsh-notes`**，与 git 模式/仓库配置无关
（`resolveNotesDir` 恒为 `join(ws.path, '.dsh-notes')`）：

```
resolveNotesDir(ws) = <ws.path>/.dsh-notes        // 有工作区：永远
无工作区会话       = config.root ?? <cwd>/.dsh-notes  // 兜底
```

- **git 目标解析**（`resolveWorkspaceRepo`）：按模式返回 `{ repoDir, subdir, branch, remote }`，
  repoDir = URL 的 clone 目录；无仓库 → `undefined`（git 按钮隐藏）。
- **推送目标目录** `repoTargetDir(repo)` = clone 根（subdir 空）或 `join(repoDir, subdir)`。
- **笔记位置恒定**：切换模式/配置仓库都不改变笔记文件位置，不存在目录迁移问题。

## 5. API 与 UI 设计

### 5.1 API method（沿用 `POST <route>`）

| method | body | 返回/行为 |
|---|---|---|
| `gitStatus` | `{ workspaceId? }` | 目标仓库状态：`{ ok, repoDir, subdir, branch, uncommitted, lastCommit?, remote }` |
| `gitPush` | `{ workspaceId?, message }` | 把该工作区 `.dsh-notes` 的 `.md` 同步到仓库目标目录 → commit → push `branch` |
| `gitPull` | `{ workspaceId? }` | 拉取远端分支 → 把目标目录 `.md` 复制回本地（**不覆盖本地已修改文件**） |
| `gitInit` | `{ workspaceId? }` | 按 URL 确保 clone 存在（缺 `.git` 时自动 `git clone`） |
| `gitSync` | `{ workspaceId? }` | 用户触发：合并远端（`--allow-unrelated-histories` 兜底） |
| `gitConfig` | 白名单 L3 keys | 保存设置（`gitMode`/`gitCentral`/`gitRepos`） |
| `gitSettings` | — | 返回当前 L3 设置（设置表单用） |

### 5.2 交互语义

| 按钮 | 行为 | 说明 |
|---|---|---|
| **保存** | 当前笔记写入本地 `<ws>/.dsh-notes/*.md` | 只写本地，不碰 git |
| **推送** | 本地 `.dsh-notes` **镜像同步**到仓库目标目录（覆盖 + 删除本地已删文件）→ commit → push `branch`（先弹 commit 面板） | 首次自动 clone；推送前检测远端差异 |
| **更新** | 先 `fetch` 对齐分支 → 目标目录 `.md` → 复制回本地 | 手动「更新」force 覆盖（确认后）；自动拉取保守跳过本地修改 |

> **冲突交用户决定**：
> - 推送前检测到远端同名笔记不同/远端独有文件 → 弹页面内 Modal「远端有以下笔记与本地不同或
>   本地已删除：{names}，是否用本地版本覆盖/删除远端？」→「用本地覆盖远端」/取消；
> - 更新时本地已修改的文件**保守跳过**，静默拉取时在更新按钮左侧提示「远端有更新，需手动更新」；
> - 手动「更新」检测到差异 → 弹 Modal「远端有 N 个笔记与本地不同，是否用远端版本覆盖本地？」
>   →「用远端覆盖本地」/取消；
> - 推送被拒（non-fast-forward）→ 提示「合并远端并重试」（`gitSync`，用户触发）。

### 5.3 UI 布局

- **左侧面板（按工作区）**：笔记列表按工作区分组。
- **编辑器头部**：笔记所在工作区配置了仓库时，「保存」左侧出现 **更新**、右侧出现 **推送**。
- **commit 弹层面板**：点「推送」后按钮旁弹出小面板（popover）：提交信息输入框 + 确认/取消。
- **底部状态行**：当前工作区仓库的分支、仓库内子路径、未提交 N 处、最近提交。
- **dsh 设置面板「MD 笔记」分区**：三态模式 + 互斥配置区（§2.2/§5.5）。

### 5.4 自动拉取（默认开启）

- 打开一篇笔记时（`open()`），若其工作区有仓库且 `gitAutoPull = true`：
  先 `gitPull(workspaceId)`（保守，不覆盖本地修改），再读取文件内容；
  拉取成功后重新 `list`，远端新增笔记立即出现在左侧面板。
- 自动拉取失败/跳过（本地有修改）**不阻断打开**：显示提示，仍读取本地版本；
  同名内容不同时在更新按钮左侧提示「远端有更新，需手动更新」。

### 5.5 dsh 设置面板「MD 笔记」分区

- `settings.section` 注册（`id: 'md-notes'`，order 10），表单控件用 **DshInput / DshSelect**
  （与 dsh 原生表单一致，token 化配色适配暗黑模式）。
- **模式三态选择**（select）+ 互斥配置区：
  - **关闭**：提示"笔记仅保存在本地 `.dsh-notes`"；
  - **共享仓库**：仓库 URL + 分支（默认 main）；提示"推到该分支 + 工作区名子目录"；
  - **独立仓库**：每工作区 仓库 URL + 分支（默认 main）+ 仓库内子路径（默认仓库根）；
    提示"推送 = 同步到该分支/子路径；更新 = 拉回（不覆盖本地修改）"。
- 全局字段：自动拉取、作者名/邮箱；保存写 L3 命名空间。
- **tip 面板**（顶部，固定文案）：说明笔记本地保存在 `<工作区>/.dsh-notes`，Git 同步
  只是推送/拉取，不影响本地保存位置（路径以 code 样式渲染，中英文各自术语）。
- i18n：`git.*` 前缀 key（`md-notes` 命名空间，中英各一份）；错误经错误码本地化。

## 6. 定案

- **笔记位置恒定** `<ws>/.dsh-notes`（§4）：不存在目录迁移。
- **URL 驱动**（§3）：仓库只配 URL；插件管理 clone（DSH_HOME 下）；无路径、无授权。
- **互斥模式**（§3.2/3.3）：shared / own 二选一；`gitMode: 'on'` 归一化兼容。
- **推送 = 镜像同步**（§5.2）：本地与仓库目标目录双向复制，**本地删除同步到远端**
  （`deleteMissingNotes`，删除前经冲突确认）。
- **`meta.json` 不入库**：本地缓存；`.gitignore` 忽略。
- **提交身份**：仓库自身 git config 优先 → 插件兜底 → 明确报错（错误码 `identity`）。
- **冲突交用户**：推送/更新覆盖均弹页面内 Modal 确认；`non-fast-forward` 返回错误码 +
  `gitSync`（用户触发合并重试）。
- **i18n 错误码**：host 返回 `{ code, detail }`，client `gitErrorText` 渲染中英文案。
- **自动提交本期不实现**；**自动拉取**受 `gitAutoPull` 开关控制、保守跳过本地已修改文件。
