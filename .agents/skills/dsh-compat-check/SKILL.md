---
name: dsh-compat-check
description: dsh 兼容性校验。用户说"dsh 兼容性校验"、"兼容性检查"、"校验 dsh 兼容性"、"检查 dsh 兼容性"时触发——先拉取 dsh main（master）分支代码，对比兼容性对照表（docs/compatibility.zh.md 最新一行）最后验证的 deepseek-harness 版本到当前最新版本的变更，判断是否影响插件功能：有影响则将影响范围写成兼容 todo 放入 TODO 文档最上方；无影响则更新兼容性对照表（docs/compatibility.zh.md 主表顶部追加一行 + 反查表同步，英文版 compatibility.md 跟随翻译）并把 README 兼容性章节刷新为主表最新三行（含备注列）的对应表格。
---

# dsh 兼容性校验（Compatibility Check）

插件（dsh-md-notes）依赖 dsh 宿主的多处契约（host API、注入机制、UI 组件、插件子系统）。
dsh 发版后需校验：自兼容性对照表（`docs/compatibility.zh.md` 最新一行）最近一次验证的
deepseek-harness 版本以来，dsh 的变更是否影响插件功能。**有影响 → 写兼容 todo；
无影响 → 更新兼容性对照表 + README 兼容性表格。**

## 流程总览

1. 拉取 dsh 仓库最新代码（默认分支）
2. 读取兼容性对照表（`docs/compatibility.zh.md`，中文版为主）与插件 README（中英两份）
   兼容性表格，确定上次验证的 dsh 版本与插件版本
3. 收集「上次验证版本 → 当前最新」区间内 dsh 的变更
4. 分析这些变更是否影响插件功能（对照插件依赖的 dsh 契约面）
5. 分支处理（**以中文版为主，英文版在中文版定稿后原样翻译**）：
   - **有影响** → 在 `docs/TODO.md` 最上方写入兼容 todo（受影响功能 + 影响范围）
   - **无影响** → 更新兼容性对照表 + README 兼容性表格：**先写 `docs/compatibility.zh.md`
     （中文版）与 `README.zh.md`（中文为主）**，**再对照中文翻译 `docs/compatibility.md`
     与 `README.md`（英文）**
6. 提交 + push，向用户汇报判定与改动

## 1. 拉取 dsh 最新代码

dsh 仓库本地路径：`/Users/xiezongchen/space/deepseek/deepseek-harness/`
（若该路径不存在，用 glob 查找 `deepseek-harness` 或询问用户）。**注意 dsh 默认分支是
`master` 而非 `main`**：

```sh
DSH=/Users/xiezongchen/space/deepseek/deepseek-harness
git -C "$DSH" fetch origin
git -C "$DSH" pull --ff-only origin master
```

若 `pull` 因本地未提交改动失败，改用 `git -C "$DSH" reset --hard origin/master`（会丢弃
该仓库的本地改动，先确认）；或仅 fetch 后基于 `origin/master` 分析、不重置本地。

拉取后记录当前最新 dsh 版本：

```sh
grep '"version"' "$DSH/package.json"
# 或看最近 release 提交：
git -C "$DSH" log --oneline -5 --grep="release(dsh)"
```

## 2. 读取兼容性信息（对照表 + README 表格）

**上次验证的 dsh 版本 / 插件版本 = `docs/compatibility.zh.md` 主表最新一行**。对照表按时间
追加（最新行 = 最近一次验证），是兼容性数据的**唯一数据源**（中文版为主，英文版
`docs/compatibility.md` 跟随翻译，两版内容一致）；README 兼容性表格只保留最新三个插件
版本，可作快速参考，但判定起点以 `docs/compatibility.zh.md` 为准。

- `docs/compatibility.zh.md`：中文版，主表（插件版本 → dsh 版本）+ 反查表（dsh 版本 →
  已验证插件版本）；
- `docs/compatibility.md`：英文版，跟随中文版翻译（含中英互切链接）；
- `README.zh.md` 的 `## 兼容性`：只展示**主表最新三行**（含备注列，不做去重）的对应表格；
- `README.md`（英文）：跟随中文版翻译的同一表格。

英文版不单独维护字段结构：**跟随中文版原样翻译即可**。

## 3. 收集 dsh 变更（版本区间）

以第 2 步提取的 dsh 版本为起点（记为 `<VER>`），当前拉取的 `origin/master` 为终点。

先定位 `<VER>` 对应的 release 提交：

```sh
git -C "$DSH" log --all --format='%h' --grep="release(dsh): <VER>" | head -1
```

若找到（记为 `<START>`），区间内变更：

```sh
git -C "$DSH" log --oneline <START>..origin/master
```

若找不到对应 release 提交（对照表版本比 dsh 仓库历史旧得多或写法不一致），用
`git -C "$DSH" log --oneline --grep="<VER>" --all` 找最近的可达点，或询问用户确认起点。
若区间为空（dsh 没有新提交），直接进入第 5 步「无影响」分支（仍需更新对照表与 README 的插件版本行）。

## 4. 影响分析

逐个浏览区间内提交（重点看合并 PR、`release(dsh)` 提交、Breaking/重构/行为变更），
对照**插件依赖的 dsh 契约面**判断是否受影响：

- **host API / 注入机制**：`agent/pre-step`、上下文注入行、`contextProvenance`、
  source kind / name（`notes` / `md-notes`）——见 `docs/context.md`。
- **notesApiHandler 契约**：`list` / `save` / `delete` / `create` / `gitSync` 等 deps
  签名、`list` 返回结构（`workspaces` 分组）——见 `docs/architecture.md`。
- **UI 组件与样式**：`DshInput` / `DshSelect` / `Modal` / `LoadingIndicator` /
  `DisclosureRow`、主题 token、locale 字典（`md-notes` 命名空间）。
- **@ 触发与 chip**：输入框触发词、候选菜单、chip 渲染（`DshChipCell`）。
- **插件子系统**：bundle 加载、`dsh plugin --profile web add/update`、client 包元数据缓存。
- **会话 / 工作区**：`workspaceId`、会话工作区相对路径解析。

判定原则：

- 区间内有**触及上述契约面的 Breaking / 重构 / 行为变更** → 有影响。
- 纯新增、bug 修复、不触及契约的内部重构 → 无影响。
- **不确定时保守视为有影响**，列入 todo 并标注「待验证」。

可辅助定位（按 dsh 仓库结构调整路径，如 `apps/web`、`packages/*`）：

```sh
git -C "$DSH" log --oneline <START>..origin/master -- apps/web packages
```

## 5. 分支处理

### 5.1 有影响 → 写兼容 todo（docs/TODO.md 最上方）

在 `docs/TODO.md` 的标题与引用说明之后、现有第一条目之前，插入兼容性条目。每条列：

- **标题**：`## dsh 兼容性（dsh <旧版本> → <新版本>，<日期>）`（编号风格贴合文档现状）。
- **受影响功能与影响范围**：逐条列出受影响的插件功能 + 具体影响（哪个契约变了、
  现象可能是什么）。
- **需要的动作**：插件侧要做的适配（如改 deps 调用、换 UI 组件、更新注入格式）。
- **阻塞项 / 待验证**：不确定的影响点单独标注。
- **验收标准**：受影响功能在最新 dsh 上行为正常。

风格参考 `docs/TODO.md` 现有条目（目标 / 现状 / 设想 / 验收标准）。写完后保留原条目不动。

### 5.2 无影响 → 更新兼容性对照表 + README 表格（以中文版为主）

**先更新 `docs/compatibility.zh.md`（中文版，数据源）与 `README.zh.md`（中文为主），定稿后
英文版 `docs/compatibility.md` 与 `README.md` 跟随中文版原样翻译。**

1. **`docs/compatibility.zh.md`（唯一数据源，中文版）**：
   - 主表（插件版本 → dsh 版本）顶部追加一行：
     `<插件版本> | <dsh 版本> | <验证日期> | <备注>`——**保留历史行，不删**；
   - 反查表（dsh 版本 → 已验证插件版本）同步更新目标 dsh 版本那一行的插件版本列表
     （新 → 旧排列，含日期列更新）；
   - 定稿后，**英文版 `docs/compatibility.md` 跟随中文版原样翻译**（同一表格 + 互切链接）。
2. **中文版 `README.zh.md`（`## 兼容性`，只保留**主表最新三行**的表格，含备注列）**：
   - **直接取 `docs/compatibility.zh.md` 主表最上面的三行**（含插件版本、dsh 版本、
     验证日期、备注四列），**不做去重**——同一插件版本可能因适配了多个 dsh 版本而
     占据多行（如 `0.10.0` 同时对应 `alpha.3` 与 `alpha.2` 两行）；
   - 表格下方保留完整历史链接：`[docs/compatibility.zh.md](docs/compatibility.zh.md)`。
3. **英文版 `README.md`**：中文版定稿后**跟随中文版原样翻译**（同一表格 + 链接
   `docs/compatibility.md`）。

## 6. 提交 + push

```sh
git add README.md README.zh.md docs/compatibility.md docs/compatibility.zh.md docs/TODO.md
git commit -m "docs: dsh 兼容性校验 — 验证到 deepseek-harness <新版本>（插件 <插件版本>）；无影响/有影响→兼容 todo"
git push
```

（按实际改动文件调整 `git add`。）

## 7. 汇报

向用户说明：

- 拉取到的 dsh 最新版本；
- 区间内 dsh 变更概览（几条 / 主要方向）；
- **影响判定**：有影响 → 列出的受影响功能与 todo 位置；无影响 → 已更新对照表哪些行
  （`docs/compatibility.zh.md` 主表新增行 + 反查表行，英文版 `compatibility.md` 同步）
  与 README 表格哪些行；
- 提交 hash 与推送状态。

## 注意事项

- **默认分支是 master**：dsh 仓库默认分支为 `master`，拉取时不要写死 `main`。
- **起点要准**：对比起点是 `docs/compatibility.zh.md` 主表**最新一行**（最近一次验证）的
  dsh 版本，不是任意旧版本；找不到对应 release 提交时先确认起点，不要跳过。
- **保守判定**：影响与否拿不准时按「有影响」处理，写进 todo 并标注待验证，
  不要静默更新对照表/README 声称已验证。
- **表格只记已验证**：**有影响（未适配/未验证）时，不要**把新 dsh 版本写进
  `docs/compatibility.zh.md` / `docs/compatibility.md` 或 README 表格——那是「声称已验证」；
  只写兼容 todo，适配完成、冒烟通过后再入表。
- **中英顺序：以中文版为主，英文版跟随翻译**：兼容性对照表先写/更新中文版
  （`docs/compatibility.zh.md`），英文版（`docs/compatibility.md`）在中文版定稿后
  **原样翻译**；README 兼容性表格先写/更新中文版（`README.zh.md`），英文版（`README.md`）
  跟随翻译。不要先写英文或两份并行臆造。TODO 兼容条目本身只有中文版（`docs/TODO.md`），
  无需英文翻译。
- **文档语言一致性**：中文文档里的跳转指向**中文文档**（如 `docs/compatibility.zh.md`、
  `README.zh.md`），英文文档里的跳转指向**英文文档**（如 `docs/compatibility.md`、
  `README.md`）；只有单语版本的文档（如 `docs/TODO.md`、`docs/features.md`）中英两版都
  直接引用同一文件。
- **不改 NEXT_VERSION**：对照表与 README 写的是**已发布**的插件版本，与 CHANGELOG 的
  `NEXT_VERSION`（未发布）无关；不要写 NEXT_VERSION。
