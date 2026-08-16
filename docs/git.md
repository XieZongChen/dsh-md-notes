# Git 同步功能设计（设置项梳理 + 仓库模型）

> 本文档梳理 dsh-md-notes 的**设置项体系**与 **Git 同步**的功能设计，是
> [TODO.md](TODO.md) 第 1 项的实现蓝图。功能设计总览见 [features.md](features.md)，
> 架构与现状见 [architecture.md](architecture.md)。

## 0. 实现状态

> 最后更新 2026-08-16。✅ 已实现（slice 1 随 `b20a367` 提交；slice 2 待提交）；🚧 设计已定、未实现；⏳ 待实测确认。

### 已实现（slice 1 + slice 2）

- ✅ 三层配置模型：schema 默认 → cordis Config（L2 yaml）→ settings 命名空间 `md-notes`（L3），host 侧逐层合并
- ✅ 仓库解析：工作区独立仓库 / 总仓库（central）/ **无仓库时各工作区独立 `.dsh-notes`（互相隔离）**（§3.3、§4）
- ✅ git 执行（subprocess 收集输出）+ **授权门禁**：沙箱外仓库必须 `authorized=true`，持久化于每仓库记录
- ✅ API：`gitStatus` / `gitInit` / `gitPush` / `gitPull` / `gitAuthorize` / `gitRevoke` / `gitConfig` / `gitSync` / `gitSettings`
- ✅ 提交身份解析：仓库自身 git 配置优先 → 插件 `gitAuthorName/Email` 兜底 → 都没有时明确报错
- ✅ non-fast-forward 冲突：`gitPush` 返回错误码 + client「合并远端并重试」（`gitSync`，用户触发，不自动处理）
- ✅ session→工作区路由、分组 `list`（多工作区视图）
- ✅ Client 管理器：按工作区分组、编辑器头部 更新/推送、commit 弹层面板、打开笔记自动拉取（**受 `gitAutoPull` 开关控制**）、底部状态行、central 全局按钮、冲突解决 UI、i18n 中英
- ✅ **dsh 设置面板「MD 笔记」分区**（`settings.section`）：gitMode / 分支 / 自动拉取 / 作者 / 总仓库（路径+远程+授权）/ 按工作区仓库（路径+远程+授权）的完整表单（`gitSettings` 读 + `gitConfig` 写）
- ✅ **授权按钮 UI**（设置面板内，central + 各工作区仓库）：`gitAuthorize` / `gitRevoke`，持久化

### 未实现（slice 3+）

- 🚧 管理器「同步区」独立配置表单（当前配置入口在 dsh 设置面板）
- 🚧 授权走 `approval.request` 审批（当前为界面确认后直接置 `authorized`）
- 🚧 工作区改名跟随（`.dsh-workspaces.json` 的 `git mv`，当前文件夹名首次创建后锁定）
- 🚧 笔记目录迁移确认（off→on / 切换仓库时已有笔记处理，§4.1）
- 🚧 自动拉取限频（同一仓库 30s 内不重复）

### 待实测 / 待确认

- ⏳ host 进程内 fs 是否受命令沙箱限制（决定授权是否需同时覆盖 notes 读写，§6）
- ⏳ git 子进程经 `subprocess` 服务 + 沙箱模式覆盖的组合（当前为插件自身门禁，无沙箱强制）
- ⏳ 跨机工作区 title 一致性（影响改名跟随设计）
- ⏳ schemastery `s.dict` 在真实 settings 服务的序列化（已通过冒烟测试，待完整运行验证）
- ⏳ 设置面板分区在真实运行中的渲染与保存（待重启验证）

## 1. 目标

让笔记目录成为一个可同步的 Git 仓库：支持一键提交、推送到远程（GitHub/GitLab 等），
换机器 clone 后继续用同一份笔记。仓库组织遵循**统一模型**：

- 每个 dsh 工作区**最多配置一个独立仓库**（可选）；未配置独立仓库的工作区，**默认使用总仓库**；
- **总仓库**一个，收纳所有工作区的笔记，每个工作区一个**以工作区名命名的子目录**
  （工作区改名时，总仓库内的目录跟随改名）。

## 2. 设置项总梳理（三层配置模型）

插件的设置分布在三个地方，按**优先级从低到高**叠加：

| 层 | 载体 | 谁能改 | 用途 |
|---|---|---|---|
| L1 schema 默认 | 代码里 schemastery schema | 开发者 | 兜底默认值 |
| L2 **cordis Config** | profile 的 `cordis.patch.yml`（yaml） | 部署者/管理员 | 部署级默认（目录、API、模式开关） |
| L3 **settings 命名空间 `md-notes`** | dsh 设置文档（Host 持久化） | 用户（设置面板 / 笔记同步区 UI） | 用户级偏好，覆盖 L2 |

读取时**逐层合并**：`生效值 = { ...L2, ...L3 }`（host 侧在 apply/读取时合并，不依赖
`ctx.settings.register` 的 base 机制，行为直观可控）。

### 2.1 设置项总表

| 设置项 | L2 Config 键 | L3 命名空间字段 | 默认 | 说明 |
|---|---|---|---|---|
| 笔记目录 | `root` | —（部署级） | `<cwd>/.dsh-notes` | Git 关闭时的笔记根目录（现状行为） |
| API 前缀 | `route` | —（部署级） | `/plugins/md-notes` | HTTP API 前缀；图标由 `<route>/icon.svg` 提供 |
| Git 总开关 | `gitMode` | `gitMode` | `'off'` | `'off'` 关闭 Git；`'on'` 开启（工作区用自己仓库，未配置则用总仓库） |
| 总仓库 | `gitCentralPath` | `gitCentral` | `{}` | 总仓库（**默认不启用**）；L3 `gitCentral` = `{ path?, remote, authorized }`——`path` 覆盖 L2 默认路径，`remote` 为该仓库的远程，`authorized` 记录沙箱外授权（§2.3）；未配置独立仓库且已授权的工作区，笔记存到 `<central>/<工作区名>/` |
| 工作区独立仓库 | — | `gitRepos` | `{}` | 按工作区：`{ [workspaceId]: { path, remote, authorized } }`；**一个工作区最多一个**；未配置 → 用总仓库 |
| 远程 URL | —（per-repo） | `gitCentral.remote` / `gitRepos[ws].remote` | `''` | 每个仓库各自的远程（独立仓库与总仓库可不同）；空 = 仅本地提交，不推送 |
| 默认分支 | `gitBranch` | `gitBranch` | `'main'` | `git init -b` 与检出用 |
| 自动拉取 | `gitAutoPull` | `gitAutoPull` | `true` | 打开笔记时先拉取远程版本（见 §5.4） |
| 作者名 | `gitAuthorName` | `gitAuthorName` | `''` | 空 = 用 git 全局配置（`user.name`） |
| 作者邮箱 | `gitAuthorEmail` | `gitAuthorEmail` | `''` | 空 = 用 git 全局配置（`user.email`） |

- L2 全部可写进 `cordis.patch.yml`；L3 字段都能在**设置面板**与**笔记管理面板同步区**编辑。
- 无环境变量、无密钥项。若远程需要 HTTPS 凭据，交给 git 自身的凭据助手，插件不存密码。

### 2.2 三个修改入口（用户视角）

1. **笔记管理面板「同步区」**（日常主入口）：
   - 展示**当前工作区**的仓库（独立仓库或总仓库）、分支、未提交数量、最后提交时间、远程状态；
   - 远程 URL（按仓库）输入 + 保存；提交 / 推送 / 拉取按钮。
   - 读写 L3 命名空间（`settingsScope.bind('md-notes')`）。
2. **dsh 设置面板「MD 笔记」分区**（`settings.section` 注册）：
   - 完整设置表单：总开关、**按工作区的独立仓库（`gitRepos`）**、分支、
     自动拉取开关、作者名/邮箱、远程 URL；
   - 另有一块**总仓库区域**——始终显示，但未授权时呈锁定态：写明
     "仓库在沙箱之外，需授权后才能使用"，并带「授权」按钮（§2.3 / §5.5）。
   - 读写同一个 L3 命名空间，两个 UI 天然同步。
3. **cordis Config（yaml）**：
   - 部署级默认与开关；设置面板未覆盖时生效。适合"管理员预配置、用户微调"的部署。

### 2.3 授权模型（沙箱外仓库）

dsh 的命令沙箱以**会话工作区（cwd）为边界**：工作区内的文件读写无需额外授权，
工作区外的路径默认被拒（`sandbox file access denied`）。git 仓库可能落在边界两侧：

| 仓库位置 | 是否需要授权 | 说明 |
|---|---|---|
| 工作区内（如 `<cwd>/.dsh-notes` 或工作区内路径） | **否** | 即现有笔记目录，沙箱默认放行 |
| 工作区外（**总仓库**、或配置在工作区外的独立仓库） | **是** | 默认不可写，需用户显式授权 |

**总仓库默认不启用**：`gitMode=on` + 配置远程时，只有**工作区独立仓库**生效；
总仓库是 **opt-in**——用户必须在设置面板（§5.5）完成两步才能启用：

1. **配置沙箱外路径**：填写 `gitCentralPath`（仓库须已存在或可创建，且在工作区之外）；
2. **授权**：点击该区域的「授权」按钮 → 触发 dsh 审批流程（`approval.request`，
   浏览器弹出确认）→ 批准后该路径的 git 操作放行（`sandboxPolicy.resolve({ mode })`
   模式覆盖）；授权状态在 UI 上即时反映，未授权时 git 按钮禁用并提示。

**授权持久化**：批准后授权记入**对应仓库记录**（`gitCentral.authorized` /
`gitRepos[ws].authorized`，宿主设置文档，随 `md-notes` 命名空间持久化）——
**重启 dsh 后仍生效，不会重复弹审批**；host 每次执行沙箱外仓库的 git 操作前读取记录，
并按需应用模式覆盖。撤销授权 = 将对应 `authorized` 置回 `false`（§5.5），
下一条命令即恢复拒绝。

> 配置在工作区外的**独立仓库**同样走这套授权；工作区内的独立仓库（默认场景）不需要。

## 3. 仓库模型（统一）

### 3.1 工作区独立仓库（可选，一个工作区最多一个）

为某工作区配置 `gitRepos[workspaceId].path` 后，该工作区的笔记存放在**它自己的仓库**里：

```
<ownRepo>/                            # gitRepos[ws].path（= 该工作区笔记根目录）
├── .git/
├── <note-name>.md
└── meta.json
```

- 每个工作区**只能配置一个**独立仓库；提交/推送只影响该工作区。
- 未配置独立仓库的工作区走总仓库（§3.2）。

### 3.2 总仓库（opt-in，需授权）

**默认不启用**：总仓库是可选功能——需在设置面板配置**沙箱外路径**并**授权**（§2.3）
后才生效。启用后，所有未配置独立仓库的工作区，笔记统一存进总仓库 `gitCentralPath`，
**每个工作区一个以工作区名命名的文件夹**：

```
<gitCentralPath>/                     # 总仓库
├── .git/
├── .dsh-workspaces.json              # 工作区 id → 文件夹名 映射（入库，跨机一致）
├── <工作区A 名>/
│   ├── <note>.md
│   └── meta.json
└── <工作区B 名>/
    └── ...
```

- **文件夹以工作区名（title）命名**；非法字符清洗，重名冲突追加 `-<id前8位>` 消歧。
- **工作区改名时目录跟随改名**：`.dsh-workspaces.json` 记录 `workspaceId → folder`，
  检测到 title 变化时执行 `git mv <旧名>/ <新名>/` 并提交（保留提交历史）；
  映射随仓库提交，跨机一致。
- 一次 commit 可同时同步多个工作区的笔记；适合"统一备份/单远程多机同步"。

### 3.3 仓库解析

每个工作区的仓库 = `gitRepos[ws].path`（有）→ 工作区独立仓库；否则 → 总仓库
（`gitCentral.path ?? gitCentralPath`）（`gitMode=off` 时无仓库）：

| 配置 | 仓库 | 笔记目录 |
|---|---|---|
| `gitMode=off` | 无 | `config.root`（绝对覆盖原样生效；相对 root 按工作区解析） |
| `gitMode=on`，且 `gitRepos[ws].path` 有值 | 工作区独立仓库 | `<ownRepo>/` |
| `gitMode=on`，未配置，但总仓库**已授权** | 总仓库 | `<gitCentralPath>/<工作区名>/` |
| `gitMode=on`，未配置且总仓库未授权/未配置 | 无仓库 | `<ws>/.dsh-notes`（**该工作区自己的目录，与其他工作区隔离**；git 按钮隐藏） |

> 默认 `gitMode: 'off'`，完全不影响现有非 Git 用户。

## 4. 笔记目录解析逻辑

笔记操作（list/read/write/create/delete/append）的目录由当前会话的工作区决定：

```
resolveNotesDir(ws):
  gitMode=off                    → config.root（绝对覆盖原样生效；相对 root 按工作区解析）
  gitRepos[ws.id].path           → 该工作区独立仓库路径（即笔记根目录）
  总仓库已配置且已授权          → gitCentralPath/<wsFolder(ws)>/
  否则（无可用仓库）            → <ws>/.dsh-notes（该工作区自己的目录，与其他工作区隔离；git 按钮隐藏）
```

- **工作区识别**：host 用 `ctx.workspaceRegistry.resolveByPath(session.cwd)` 拿到
  `{ id, path, title }`（缺失/未注册时回退：用 `cwd` 的 basename 作 key）。
- **总仓库目录名 `wsFolder(ws)`**：读 `.dsh-workspaces.json` 映射（无则按当前 title 创建）；
  title 变更时 `git mv` 并更新映射（§3.2）。
- **请求路由**：单笔记操作（read/write/create/delete/append）携带 `workspaceId`（或 host
  从 sessionId 反查 cwd），host 据此解析到 `resolveNotesDir`；**`list` 是例外**——独立仓库
  模式列出当前工作区；总仓库模式扫整个 `gitCentralPath` 根、按工作区分组返回
  （§5.1）。当前 API 是固定目录的 `notesApiHandler(dir, ...)`，需改成按请求解析。

### 4.1 笔记目录迁移（off→on / 切换仓库 / 启用 central 时）

笔记目录会在下列情况下切换：`gitMode` 由 off 转 on、给工作区配置/修改独立仓库、启用或
撤销 central 授权。切换时处理已有笔记：

- **检测**：`resolveNotesDir` 解析结果变化，且旧目录存在 `.md` 笔记时，视为一次迁移。
- **交互**：弹确认「笔记目录已切换，旧笔记位于 `<旧路径>`（N 篇），是否复制到新目录？」
  ——用户确认后**复制**（保留旧文件不动，不做 `git mv`，因为跨仓库/跨目录）；
  取消则仅切换目录，旧笔记留在原处，由用户自行处理。
- **原则**：**绝不自动删除或移动**用户文件；迁移只在目录首次切换时提示一次，之后目录稳定。

> 注：这是"新目录为空/全新仓库"的情况。若新目录已有内容（如 clone 下来的仓库），
> 直接指向它即可，不迁移。

## 5. API 与 UI 设计

### 5.1 新增 API method（沿用 `POST <route>`）

| method | body | 返回/行为 |
|---|---|---|
| `gitStatus` | `{ workspaceId? }` | 目标仓库状态：`{ ok, mode, repoPath, branch, uncommitted, lastCommit?, remote, behind? }` |
| `gitPush` | `{ workspaceId?, message }` | **单工作区**：提交该工作区仓库 → push → **回拉**；**全局**（不传 workspaceId）：`git add -A` 提交总仓库全部 → push → 回拉 |
| `gitPull` | `{ workspaceId? }` | 目标仓库拉取（**整仓**，不是单文件） |
| `gitInit` | `{ workspaceId? }` | 按目标初始化仓库（缺 `.git` 时自动执行；默认 `.gitignore` 忽略 `meta.json`） |
| `gitAuthorize` | `{ workspaceId? }` | 触发沙箱外仓库授权：host 发起 `approval.request` 审批，批准后置对应仓库 `authorized=true`（持久化） |
| `gitRevoke` | `{ workspaceId? }` | 撤销授权：置对应仓库 `authorized=false`（§2.3 撤销清理） |

- **目标仓库（单工作区 vs 全局）**：
  - 传 `workspaceId` → **该工作区仓库**：工作区有独立仓库（`gitRepos[ws].path`）时作用于它
    （`git add -A`）；否则作用于总仓库中该工作区的文件夹（`git add <central>/<工作区名>/`）；
  - 不传 `workspaceId` → **总仓库全局**：`git add -A` 作用于整个总仓库（所有工作区一起）。
- **git 操作一律仓库级**：更新/推送不再有"只动单个笔记文件"的说法——按钮可见性按
  笔记所在工作区是否配置仓库决定，执行的都是整个仓库的 git（见 §5.3）。
- **⚠️ 拉取是整仓的**：central 归集的工作区，`gitPull(workspaceId)` 在 git 层面就是整仓
  pull——**单工作区「更新」会拉取整个总仓库（影响所有归集工作区）**，与全局按钮执行
  同一操作（区别仅在 push 的 `add` 范围）。UI 文案需提示这一点。
- **`list` 扩展**：笔记列表按工作区分组返回 `{ workspaces: [{ workspaceId, name, notes }] }`
  （总仓库归集多个工作区时，左侧面板按工作区展示；`list` 的目标目录见 §4）。
- **推送后回拉**：`gitPush` 成功后再执行一次 `gitPull`（同目标），避免本地与远程提交不同步。
- **无远程**：目标仓库的 `remote`（`gitCentral.remote` / `gitRepos[ws].remote`）为空时，
  更新/推送按钮隐藏或禁用（见 §5.3）。
- L3 设置的读写不经过 API：client 直接用 `settingsScope`（与设置面板同源）。

### 5.2 交互语义

| 按钮 | 行为 | 说明 |
|---|---|---|
| **保存** | 当前笔记写入本地文件 | 只写本地 `.md`，不碰 git |
| **推送** | **整个仓库** commit + push（先弹 commit 面板） | 单工作区：提交该工作区仓库；全局：提交总仓库全部；推送成功后自动回拉 |
| **更新** | **整个仓库**拉取远端版本 | 单工作区 / 总仓库全局，取决于按钮所在位置 |

> **冲突交用户决定**：更新（手动或自动）若与本地未提交改动冲突，插件**不自行决定**
> （不自动 stash、不自动覆盖）——手动「更新」弹确认让用户选择（如"用远程版本覆盖" /
> "取消，保留本地改动"）；自动拉取在可能冲突时保守跳过（§5.4）。
> **推送后回拉同样受此约束**：`gitPush` 后的回拉若遇到远端新提交冲突，不自动 rebase/
> 覆盖——提示用户按「更新」的确认流程处理。

> 打开笔记时的自动拉取（§5.4）已隐含一次「更新」；手动「更新」按钮用于强制刷新。

### 5.3 UI 布局

**左侧面板（按工作区）**：笔记列表**按工作区分组**展示（总仓库模式下会出现多个工作区）——
每个工作区头部显示工作区名 + **更新 / 推送**按钮（作用于该工作区仓库）。

**编辑器头部**：笔记所在工作区配置了仓库时，「保存」按钮**左侧**出现 **更新**、
**右侧**出现 **推送**（都作用于**该工作区仓库**，而非单个笔记文件）。

**管理器头部（总仓库已配置时，关闭按钮左侧）**：**全局「更新」「推送」**按钮——
对总仓库整仓操作（所有归入总仓库的工作区笔记一起管理）。

**commit 弹层面板（不是弹窗）**：点「推送」后在按钮旁弹出**小面板**（锚定 popover，
无全屏遮罩）：
- 提交信息输入框（默认占位「笔记更新 <时间>」）；
- 「确认」→ 调 `gitPush(目标, message)` → commit + push → 回拉；进行中禁用并显示进度；
- 「取消」关闭；失败显示 git 错误原文 + 中文提示（i18n）。

**状态行（可选）**：管理器底部一条——当前工作区仓库的分支、「未提交 N 处」、最后提交、
远程状态（来自 `gitStatus`）。

### 5.4 自动拉取（默认开启）

- 打开一篇笔记时（`open()`），若其工作区仓库配置了远程且设置 `gitAutoPull = true`：
  先对该工作区执行 `gitPull(workspaceId)`，成功后再读取文件内容。
- 自动拉取失败（网络/冲突）**不阻断打开**：显示提示，仍读取本地版本。
- **冲突保护**：若本地有未提交改动、更新可能覆盖或冲突，**自动拉取保守跳过**并提示
  （绝不自动覆盖）——用户可手动点「更新」按钮，按 §5.2 的确认流程决定。
- **频率**：central 归集时每次打开笔记都是整仓 fetch/pull，建议**限频**（如同一仓库
  30s 内不重复自动拉取），避免频繁网络请求；实现细节见 §6。
- 设置项 `gitAutoPull`（§2.1）可在设置面板关闭。

### 5.5 dsh 设置面板「MD 笔记」分区

- `settings.section` 注册（`id: 'md-notes'`，order 置于 General 之后）。
- 表单字段 = §2.1 L3 列出的字段（含 `gitAutoPull`）；保存即写命名空间，笔记面板立即反映。
- **总仓库授权**：总仓库区域未授权时显示说明（"仓库在沙箱之外，需授权后才能读写"）
  与「授权」按钮——点击调 `gitAuthorize`（§5.1），host 发起 approval 审批，批准后该仓库
  `authorized=true`；已授权路径显示「已授权」态，可一键**撤销**（调 `gitRevoke`，沙箱外
  读写恢复拒绝）。授权结果**持久化**（对应仓库的 `authorized` 标记，见 §2.3）：重启后
  仍生效、不重复弹审批。
- i18n：新增 key 前缀 `git.*` 与 `settings.*`（沿用 `md-notes` 命名空间，中英各一份）。

## 6. 实现步骤与定案

1. **依赖与基础**：`@deepseek-ai/dsh-settings`、`@deepseek-ai/dsh-client-ui-settings`
   加入 peerDependencies / link-deps / tsdown external。
2. **Host**：
   - `apply` 里 `ctx.settings.register('md-notes', schema)`（L3 字段）；
   - 读取时 `{ ...config, ...scope.get() }` 合并；
   - git 命令经 `subprocess`/`shell` 服务执行（`git init -b <branch>`、`add`、`commit`、
     `push`/`pull`），作者参数用 `-c user.name=... -c user.email=...` 注入。
3. **Client**：左侧面板按工作区分组 + 各工作区更新/推送按钮 + 编辑器头部更新/推送 +
   总仓库已配置时管理器头部全局按钮 + commit 弹层面板（popover）+ 打开笔记自动拉取 +
   设置面板分区 + i18n 补 key。
4. **定案**：
   - **沙箱/权限（策略已改为 opt-in）**：工作区内的仓库无需授权；**沙箱外路径（总仓库、
     或配置在工作区外的独立仓库）默认不可写**，需用户在设置面板显式授权（§2.3）。
     已定案：
     - **存储粒度（B）**：授权记在每仓库记录（`gitCentral.authorized` /
       `gitRepos[ws].authorized`），跟随仓库配置——改路径笔误不丢授权；
     - **覆盖时机（A）**：host 统一经 `runGit(repo, args)` 助手执行 git，每次按授权
       状态 `sandboxPolicy.resolve({ mode })` 解析，无持久 override——撤销后下一条
       命令即拒绝，零残留；
     - **网络权限（按建议）**：实现时先实测沙箱 mode 是否含网络；若网络单独控制，
       则并入同一授权流程（同一按钮、同一持久化记录），授权文案写明"可读写该仓库
       并可推送到其远程"；凭据仍由 git 自身的 credential helper 管理，插件不存密码；
     - **撤销清理（按建议）**：置 `authorized=false` + 后续命令立即拒绝 + 外部仓库
       里的笔记**留在原地不自动迁移** + UI 提示（可重新授权或手动迁移）。
   - **目录路由（已定案）**：client 请求携带 `workspaceId`（client runtime 暴露当前会话
     工作区时优先使用）；host 兜底用 `sessionId → session.cwd → workspaceRegistry.resolveByPath`；
     无工作区归属的会话用 `cwd` basename 作 key。
   - **工作区改名跟随（已定案）**：检测时机 = 每次打开笔记/同步前比对 title 与
     `.dsh-workspaces.json`；改名目标被占用 → 自动追加 `-<id前8位>` 消歧并在 UI 提示。
   - **更新冲突（已定案：交用户决定）**：`gitPull` 前先检查本地未提交改动；若更新会覆盖或
     冲突，**插件不自行决定**（不自动 stash / 不自动覆盖）——手动「更新」弹确认让用户选择；
     打开笔记的自动拉取在可能冲突时**保守跳过**并提示（§5.2 / §5.4）。
   - **提交范围（已定案）**：单工作区推送 = 工作区仓库级（独立仓库 `git add -A`；总仓库
     归集时 `git add <central>/<工作区名>/`），重命名/删除等跨文件操作天然覆盖。
   - **`meta.json` 不入库（已定案）**：本机缓存，入库会制造提交噪音；远程 clone 后可重建。
   - **自动提交本期不实现**：`gitAutoCommit` 已从设置项移除（§2.1）；不做保存后自动 commit，
     后续需要时再评估（含防抖）。
   - **改名提交归属（已定案）**：工作区改名的 `git mv` + `.dsh-workspaces.json` 更新
     **只暂存不自动 commit**，随该工作区下一次推送（单工作区 push 时同时 `git add`
     `.dsh-workspaces.json`）或全局推送一并提交；永不推送则改动留在工作树，无破坏。
   - **实现前必须先实测（沙箱语义）**：
     - host **进程内 fs**（笔记读写用的 `node:fs`）是否受命令沙箱限制——决定授权是
       "只覆盖 git 子进程"还是"也需覆盖 notes API 的沙箱外读写"（矛盾点 2 的答案）；
     - git 子进程经 `subprocess` 服务 + `sandboxPolicy.resolve({ mode })` 的执行组合是否
       能真正放行沙箱外路径与网络推送。
   - **跨机工作区 title 一致性（待确认）**：`.dsh-workspaces.json` 的 folder 名跟随本地
     title；若不同机器的工作区 title 不一致，会触发互相改名。需确认 dsh 工作区是否跨机
     同步；若不同步，改名跟随仅限"本地修改映射的那台机器"，或 folder 名首次创建后固定。
   - **schemastery 支持（待确认）**：`gitRepos` 的任意 key 嵌套对象需 schemastery
     dict schema（如 `s.dict(...)`）支持；若不支持，退化为设置面板按工作区逐项维护的
     JSON 字段（schema 宽松 + UI 校验）。
   - **自动拉取限频（已定案）**：同一仓库 30s 内不重复自动拉取（§5.4）。
