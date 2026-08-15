# TODO（功能规划）

> 未来功能规划清单，按优先级排序。每项实现后请移入 [CHANGELOG.md](../CHANGELOG.md)
> （只记用户可见的功能性改动）。

## 1. 接入 Git：笔记可提交到仓库，方便多端同步

**目标**：让笔记目录成为一个可同步的 Git 仓库——支持一键提交、推送到远程（GitHub/GitLab 等），
换机器 clone 后继续用同一份笔记。

**思路**：

- Host 侧新增 `git` 相关 API method（沿用现有 `POST /plugins/md-notes` 分发）：
  - `gitInit`：若笔记目录还不是仓库则 `git init`（生成默认 `.gitignore`，如忽略 `meta.json` 或按需保留）
  - `gitStatus`：返回未提交改动数（供 UI 显示"有 N 处未提交"）
  - `gitCommit`：`git add -A && git commit`，提交信息默认「笔记更新」+ 时间戳
  - `gitPush` / `gitPull`：推送到 / 拉取远程（需配置 remote URL，如 `git remote add origin ...`）
- UI 侧：笔记管理面板顶部/底部加一个同步区——远程地址输入、提交/推送/拉取按钮、最近提交状态展示。
- 配置：Config 增加可选 `gitRemote`（默认空 = 不启用 Git 功能，避免非 Git 用户被干扰）。

**待定问题**：

- 提交时机：手动提交 vs 保存后自动提交（自动提交可能产生噪音，倾向手动 + 状态提示）。
- 沙箱与权限：host 执行 git 命令依赖 `subprocess`/`shell` 服务与文件沙箱策略，需确认插件上下文可用性。
- `meta.json`（标题/更新时间缓存）是否入库：入库可跨机同步标题，但可能造成提交噪音。
- 多端冲突：并发编辑冲突由 git 自身处理，UI 只需透出冲突提示。

## 2. Markdown 解析测试

**目标**：为笔记的 markdown 渲染与领域逻辑补上自动化测试，防止解析器改动破坏现有渲染。

**范围**：

- `src/client/features/markdown.ts`（渲染器，纯函数）：标题 / 无序有序列表 / 引用 / 代码块 /
  内联样式（粗体、斜体、行内代码、链接）/ HTML 转义（XSS 安全）等输入→HTML 快照或断言。
- `src/host/notes.ts`（领域逻辑，纯函数）：`sanitizeName`（非法字符、保留名）、`titleOf`（元数据缺失回退）、
  `blocksToText`（reasoning 引用块 / image 占位）、`appendConversation` 的分段格式。

**方案**：

- 引入 `vitest`（与 deepseek-harness 测试栈一致），加 `npm test` 脚本。
- 渲染器用例：一组「输入 markdown → 期望 HTML」的表格化用例；XSS 用例单独一组。
- 领域逻辑用例：目录/文件操作用临时目录（`fs.mkdtemp`）跑真实读写，断言文件内容与 `meta.json`。
- 可选：渲染器做快照测试（vitest `toMatchSnapshot`），变更时人工确认 diff。

**验收标准**：`npm test` 全绿；新增/修改解析规则时，先加用例再实现。
