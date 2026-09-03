# Changelog

> 中文 · [English](CHANGELOG.md)

本项目版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。
仅记录用户可见的功能性改动（不记录文档、代码重构、构建/工具链调整）。

**记录规则**：

- 分类固定为 **Breaking（破坏式变更）→ Added（新功能）→ Fixed（修复）** 三种，按此顺序排列；
  记录时若该改动归属的分类不存在，则**添加分类**；若某分类下没有任何记录，则**删除分类**。
- 某个功能在当前版本加入时，只在 **Added** 记录一次；**同一版本内**对该功能的修复
  **不再记入**（那是构建该功能的一部分，不是对已发布行为的修复）。
- **Fixed** 只记录对**历史版本**已有功能的修复。
- **dsh 版本适配**：升级适配某个 deepseek-harness 版本时，在对应版本的 **Added** 加一条
  「适配 deepseek-harness `<版本>`」，说明迁移内容（依赖 / 符号 / API 变更）。它表达
  「该插件版本已验证支持该 dsh 版本」，与[兼容性对照表](docs/compatibility.zh.md)互补——
  表记「哪个插件版本 ↔ 哪个 dsh 版本」的组合，CHANGELOG 记「这次适配改了什么」。
- **不写操作介绍**——一条改动只写功能说明，并链接到[使用文档](docs/usage.zh.md)对应章节
  （链接精确到标题）。用法说明放在使用文档里，不放进 CHANGELOG；若文档还没有该功能，
  先补进文档，再引用。
- 未发布的改动写入顶部 **`## NEXT_VERSION`** 块；发版时执行
  `npm run changelog:release -- <版本号>`——脚本会把 `NEXT_VERSION` 改名为 `[<版本号>] - <日期>`，
  **不新增** `NEXT_VERSION`（开发空窗期不留空块）。写入改动时先检查是否存在 `NEXT_VERSION`
  块——没有就先添加一个，再在块下记录新改动。

## NEXT_VERSION

### Breaking（破坏式变更）

- 移除从未被使用的 `gitSuggest` API 方法（及其 client 封装）：插件内无任何
  调用方，且它向任意调用者暴露工作区路径。
- 移除 `route` 配置项。HTTP API 前缀在两半都固定为常量 `/plugins/md-notes`：
  浏览器半部本就硬编码该值，覆盖 host 侧前缀只会断开 client↔host 链接。
  已有配置里的 `route` 键不会导致加载失败（schemastery 放行未知键，值被忽略）。

### Added（新功能）

- 新增 `checkUpdate` 配置（默认 `true`）：设为 `false` 后 host 不再访问
  registry.npmjs.org——离线/受管部署下，此前的版本检查是无条件外呼。

### Fixed

- 安全：插件 HTTP API 与图标路由接入与 dsh 官方 `/api` 通道相同的信任栅栏
  （`connection.requestRejection`）——无已认证浏览器会话的请求返回 401、不可信
  Host/Origin 返回 403，在任何笔记/Git 操作或设置写入分发之前拒绝（见
  [architecture §3](docs/architecture.md#3-host-半src)）。无 connection 服务的
  profile（如 Electron IPC）行为不变。
- 安全：`gitStatus` 不再返回原始 git remote URL——展示副本中内嵌凭据
  （`https://user:token@…`）脱敏为 `https://***@…`（设置表单仍编辑原始值）。

## [0.10.1] - 2026-09-03

### Fixed

- 修复 @ 引用跨工作区时，选中工作区自动补全后候选菜单不重新打开（re-track 迁移到新输入 API：
  从废弃的 `conversation.input.track/snapshot` 迁到 `inputTriggers.sessionOf().track()`）。

## [0.10.0] - 2026-09-01

### Added

- **Git 卡片交互改版**：工作区行去掉折叠箭头，改放 **git 状态图标**（脱色随主题 + 红/黄
  双圆点指示本地未推送/远端更新 + tooltip）；Git 卡片默认收起、点图标展开，折叠工作区时
  卡片一并收起；卡片信息行（分支/子路径/最近提交）不换行、超出省略号、hover 显示完整；
  未配置仓库的工作区不显示 git 图标。见
  [使用文档 §5 — Git 同步](docs/usage.zh.md#5-git-同步可选)。
- **推送交互改版**：点「推送」后按钮行切换为**提交信息行**（替代原 commit 弹层），
  成功/取消切回，失败（含 non-fast-forward）不切回。见
  [使用文档 §5.2 — 推送笔记](docs/usage.zh.md#52-推送笔记)。
- **弹窗关闭按钮统一 dsh 同款**：笔记管理器与记入笔记弹窗的关闭按钮改用 dsh 同款
  closeBtn（`IconCloseOutline16`）。见 [使用文档 §2 — 打开笔记管理器](docs/usage.zh.md#2-打开笔记管理器)。
- **适配 deepseek-harness `0.1.2-alpha.2`**：移除已删除的 `settingsNamespace` 依赖，
  `MD_NOTES_NS` 改用纯字符串（register 内校验）。

## [0.9.0] - 2026-08-29

### Breaking

- **共享仓库子目录改由映射固定（工作区改名安全）**：shared 模式改用仓库根
  `.dsh-notes-workspaces.json`（以工作区 id 为 key）固定每个工作区的子目录名——改名后目录不再
  移动、不再孤儿化，同名工作区也不再互相覆盖。**迁移影响**：仅「升级前已改过名」的工作区受影响——
  旧子目录留在远端（插件不再读写），本地笔记**不受影响**（笔记始终在本地 `<工作区>/.dsh-notes/`，
  Git 同步只是镜像）；清理时删除远端旧目录即可，不删也无害。

### Added

- **笔记预览互链**：笔记正文里的 `[[笔记名]]`（wiki）与 `` `笔记名` ``（反引号）会渲染成
  可点链接，点击跳转到目标笔记（支持跨工作区）。按标题或文件名匹配（大小写不敏感），
  同名跨工作区时优先当前工作区；跨区重名可用 `[[工作区名/笔记名]]` 精确消歧，同工作区
  标题重名时 hover 提示「N 篇同名标题，建议用文件名区分」。见
  [使用文档 §2 — 打开笔记管理器](docs/usage.zh.md#2-打开笔记管理器)。
- **新建笔记弹窗**：标题与文件名在创建时解耦——可显式填文件名（留空按标题自动生成；
  非法字符转 `-`、强制 `.md` 后缀），弹窗实时显示「将创建」+ 重名红字提示并禁用创建；
  管理器与记入笔记面板两处新建都复用此弹窗。见
  [使用文档 §2 — 打开笔记管理器](docs/usage.zh.md#2-打开笔记管理器)。
- **适配 deepseek-harness `0.1.2-alpha.1`**：`@deepseek-ai/dsh-client-runtime` 包被删除、
  拆分到多个包——迁移依赖（新增 `dsh-client-store` / `dsh-client-ui-chat` /
  `dsh-client-ui-renderer`，`dsh.client.inject` 改为 renderer / locale / conversation /
  input-trigger / chat）；符号迁移（`createSnapshotStore`→store、`ConversationSnapshot`/
  `AssistantBlock`/`ConversationNode`→ui-conversation、`SessionId`→session、
  `ClientContext`→cordis `Context`）；`assistant-actions` slot 迁至 ui-chat；`inputTriggers`
  改为 `inject` 硬依赖；`InputTriggerCandidate.icon` 收紧为 `'file' | 'folder' | 'session'`、
  `Modal` 的 `headless` 分支禁止 `closeLabel`、`MarkdownText` 新增必填 `labels`。

### Fixed

- 记入笔记对 `noteName` 消毒，堵住路径穿越。
- git 操作按 clone 目录串行化，消除并发 push / pull 竞态。
- 修复 `mergeSettings` 丢弃 L2 配置的 shared / own 模式。

## [0.8.0] - 2026-08-25

### Added

- **Git 卡片远端更新检测**：`gitStatus` 拉取远端并返回 `remoteAhead`，远端有新提交时
  Git 卡片提示「远端有更新，需手动更新」。见
  [使用文档 §5 — Git 同步](docs/usage.zh.md#5-git-同步可选)。

### Fixed

- **覆盖弹窗改为三向冲突判定**（base / local / remote）：内容不同不再一律弹窗，仅真正的
  三方冲突才询问。见 [使用文档 §5 — Git 同步](docs/usage.zh.md#5-git-同步可选)。
- **修复侧边栏笔记入口样式**：不再依赖 footer 的 flex-wrap / flex-basis，改为普通全宽行，
  `.notesRow` 对齐 ui-cordis（不被 footer 其他入口压缩）。见
  [使用文档 §2 — 打开笔记管理器](docs/usage.zh.md#2-打开笔记管理器)。

## [0.7.1] - 2026-08-23

### Fixed

- **修复侧边栏笔记入口的样式污染**：入口只调整直接父级 flex-wrap，不再向上写祖先
  内联样式污染 SidebarRoot（改用注入的 `:has()` CSS 规则）。见
  [使用文档 §2 — 打开笔记管理器](docs/usage.zh.md#2-打开笔记管理器)。

## [0.7.0] - 2026-08-23

### Added

- **笔记面板改版**：管理器左栏每工作区新增 **Git 同步卡片**（分支 / 子路径 / 最后提交 /
  「已同步」或「未推送 N 处」状态、更新 / 推送入口），与笔记操作分层；头部新增全局 Git
  状态汇总条（`{ws} 个工作区 · {pending} 个待同步`）。见
  [使用文档 §2 — 打开笔记管理器](docs/usage.zh.md#2-打开笔记管理器)。
- **@ 引用 chip 显示插件 logo**：选中笔记后输入框 chip 前置插件图标（保留
  `appearance='notes'` 作用域）。见 [使用文档 §4.1 — 选择笔记](docs/usage.zh.md#41-选择笔记)。
- **meta.json 缺失自动重建**：缓存文件缺失时从笔记标题与文件 mtime 重建，无需手动修复。见
  [使用文档 §1 — 笔记存在哪里](docs/usage.zh.md#1-笔记存在哪里)。

### Fixed

- **共享仓库 Git 状态与提交按工作区子目录隔离**：修复共享仓库模式下跨工作区状态 / 提交
  串扰。见 [使用文档 §5 — Git 同步](docs/usage.zh.md#5-git-同步可选)。
- **Git 卡片未推送计数修正**：按本地与仓库差异（`unpushed`）计算，不再误报。
- **@ 引用路径 fallback 用标题生成**：工作区改名后引用不再指向不存在位置。见
  [使用文档 §4.2 — 引用其他工作区的笔记](docs/usage.zh.md#42-引用其他工作区的笔记)。

## [0.6.0] - 2026-08-20

### Added

- **笔记写入互斥（写锁）**：对笔记的写操作（保存 / 记入笔记 / 删除）**跨会话互斥**——某笔记
  写入期间，任何会话对其再写都会被拒绝（host 键控锁，错误码 `note-writing`）；写入中状态
  全界面可见：记入弹窗中该笔记不可选中并显示行尾 loading，管理器行尾 loading（隐藏删除）、
  编辑 / 更新 / 保存 / 推送禁用并提示「正在写入文件」，笔记入口显示 loading 且 hover
  提示「{count} 个笔记正在写入」。写入完成后所有位置自动还原。设计见
  [docs/write-lock.md](docs/write-lock.md)；状态约定见 [docs/state.md](docs/state.md)。

### Fixed

- **记入笔记即时响应、不再卡住面板**：提问 / 回答 / 会话标题改为 client 端从浏览器
  会话快照提取（与复制按钮同源）后随请求传给 host，host 只做格式化 + 写文件——此前
  的 `sessionQuery.readSession` 会全量读会话日志（深拷贝 + replay 校验），长会话时同步
  阻塞事件循环，导致面板的列表 / 内容请求一直 loading 直到写入完成。
- **修复 Git 同步拉取/更新失效**：gitPull 不再被 remoteAhead 误判短路（判断移到
  checkout 之前），手动更新在「本地落后但 git 引用已同步」时也能拉到远端内容。见
  [使用文档 §5 — Git 同步](docs/usage.zh.md#5-git-同步可选)。
- **修复跨工作区 @ 引用报「笔记不存在」**：跨工作区 / 嵌套工作区场景下引用路径解析
  失效导致序列化报错——已修复。见
  [使用文档 §4.2 — 引用其他工作区的笔记](docs/usage.zh.md#42-引用其他工作区的笔记)。

## [0.5.0] - 2026-08-19

### Added

- **记入笔记的分段格式优化**：时间戳标题改为「会话标题 -- 时间戳」，角色标签升级为
  `### 👤 用户` / `### 🤖 DSH` 小节标题（预览中提问与回答一眼可分）；**思考内容
  （reasoning）不记入**，只保留最终回答（与 dsh 界面一致）。
- **引用笔记序列化为标准 markdown 链接**：被引用笔记在消息里显示为
  `引用笔记 [标题](路径)`（中）/ `Referenced note [title](path)`（英）——标题与路径绑定为
  结构化 token，模型解析可靠，任何 markdown 渲染器（包括未来的笔记跳转功能）都能识别为链接。
- **笔记预览改用 dsh `MarkdownText`**：笔记管理器的预览 Tab 改用 dsh 自带的
  MarkdownText 渲染（micromark 生态：GFM 表格 / 任务列表 / 有序列表、TeX 公式、代码高亮，
  XSS 安全内置），与 dsh 聊天渲染一致。见
  [使用文档 §2 — 打开笔记管理器](docs/usage.zh.md#2-打开笔记管理器)。
- **笔记管理器打开行为优化**：点击已有笔记默认打开**预览**（预览 Tab 前置），
  新建笔记后直接进入**编辑**模式。见
  [使用文档 §2 — 打开笔记管理器](docs/usage.zh.md#2-打开笔记管理器)。

### Fixed

- 修复远端更新检测误报：改为基于 git 引用比较（rev-list 领先数）而非内容比对——本地有
  编辑未推送时不再误报「远端有更新」；手动更新在远端无新提交时不覆盖本地改动。
  见 [使用文档 §5 — Git 同步](docs/usage.zh.md#5-git-同步可选)。

## [0.4.0] - 2026-08-18

### Added

- **对话中引用笔记（`@`）**：在输入框输入 `@` 选择笔记，发送时 host 端把被引用笔记的
  内容注入模型请求（`agent/pre-step`，不依赖模型自觉 `read`），支持跨工作区引用。用法见
  [使用文档 §4 — 引用笔记进对话](docs/usage.zh.md#4-引用笔记进对话-引用)。
- **记入笔记弹窗增强**：列表改为按工作区分组/折叠（与笔记管理器左侧一致），支持跨工作区
  记入；每个工作区行「+」按钮可现场新建笔记；列表加载时显示进度提示。用法见
  [使用文档 §3 — 把对话记入笔记](docs/usage.zh.md#3-把对话记入笔记)。
- **工作区行更新/推送快捷按钮**：笔记管理器左栏每个工作区行提供更新/推送图标按钮
  （工作区删空后仍可更新/推送）。用法见 [使用文档 §2 — 打开笔记管理器](docs/usage.zh.md#2-打开笔记管理器)。

## [0.3.0] - 2026-08-16

### Breaking（破坏式变更）

- **移除 `root` 配置**——笔记改为深度绑定工作区（`<工作区>/.dsh-notes`）；原先 `root` 指向的
  笔记目录被忽略，**已有笔记不会自动迁移**（请手动复制到对应工作区的 `.dsh-notes`）。无工作区时
  无法读写笔记（界面提示先新建工作区）。
- **`list` API 返回结构变更**——由 `{ ok, notes, dir }`（单一固定目录）改为
  `{ ok, workspaces: [{ workspaceId, name, notes }], noWorkspaces }`（按工作区分组）。
- **`notesApiHandler` 签名变更**——由固定 `dir` 改为 deps 对象按工作区解析目录
  （内部 host API；打包的 client 已同步更新）。

### Added

- **Git 同步**（URL 驱动）：配置仓库 URL，插件自动管理本地 clone；支持共享 / 独立仓库两种
  互斥模式、镜像同步推送、冲突处理与自动拉取。用法见
  [使用文档 §5 — Git 同步](docs/usage.zh.md#5-git-同步可选)（模式
  [§5.1](docs/usage.zh.md#51-两种模式二选一)、推送 [§5.2](docs/usage.zh.md#52-推送笔记)、
  更新 [§5.3](docs/usage.zh.md#53-更新笔记拉取)、自动拉取
  [§5.4](docs/usage.zh.md#54-打开笔记时的自动拉取)、推送被拒 [§5.5](docs/usage.zh.md#55-推送被拒绝时)）。
- Git 设置面板（dsh 设置 → MD 笔记）——见 [使用文档 §6](docs/usage.zh.md#6-设置面板)。
- **版本更新提示**：加载时检查 npm 版本，有新版时显示「有新版本需要更新」tag——
  见 [使用文档 §7](docs/usage.zh.md#7-版本更新提示)。
- 笔记深度绑定工作区（`<工作区>/.dsh-notes`），无工作区时界面提示先新建——
  见 [使用文档 §1](docs/usage.zh.md#1-笔记存在哪里)。
- 界面文案全面国际化：host 错误返回错误码 + detail，client 渲染本地化文案（`gitErrorText`）。
- dsh 风格表单控件（DshInput / DshSelect）与笔记管理器整体改版（标题栏设置按钮、
  按工作区分组/折叠、状态行）。

### Fixed

- 英文界面记入笔记时此前写入中文分段标签（「用户」/「DSH」）——现本地化为 "User" / "DSH"。
- 主按钮（保存/确认）暗黑模式下白字白底——改用主题 token。
- 记入笔记弹窗「新建」按钮被挤到单独一行（输入框占满整行）——已修复。
- 文案标点规范化（中文去掉句尾句号；英文句子型文案补句号）。

## [0.2.0] - 2026-08-16

### Added

- UI 文案接入 dsh 的 locale 机制：全部界面文案（侧边栏入口、操作栏 tooltip、两个弹窗、按钮）抽成
  `md-notes` 命名空间字典，跟随宿主应用语言设置在中/英之间自动切换
  （见 [使用文档 §8](docs/usage.zh.md#8-小贴士)）。

## [0.1.1] - 2026-08-16

仅文档发布，无功能性改动。README 与 CHANGELOG 默认语言切换为英文（中文版见 `README.zh.md` / `CHANGELOG.zh.md`）。

## [0.1.0] - 2026-08-16

### Added

- 正式 bundle 插件（可随 dsh 常驻，重启不丢），经 `dsh plugin --profile web add` 安装
- **侧边栏入口**与**笔记管理界面**（新建 / 编辑 / 预览 / 删除）——
  见 [使用文档 §2](docs/usage.zh.md#2-打开笔记管理器)
- **记入笔记**：在回答操作栏一键把「提问 + 回答」记入笔记——
  见 [使用文档 §3](docs/usage.zh.md#3-把对话记入笔记)
- 笔记以普通 `.md` 文件存储（默认 `<cwd>/.dsh-notes`，可用 Config `root` 覆盖）；
  `meta.json` 记录标题与更新时间
