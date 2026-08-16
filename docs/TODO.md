# TODO（功能规划）

> 未来功能规划清单，按优先级排序。每项实现后请移入 [CHANGELOG.md](../CHANGELOG.md)
> （只记用户可见的功能性改动）。

## 1. 接入 Git：笔记可提交到仓库，方便多端同步

**状态**：设计已完成，见 [git.md](git.md)（设置项三层模型、工作区/总仓库双模式、API/UI、实现步骤）。

**实现要点回顾**：

- 三层配置：cordis Config（部署默认）→ settings 命名空间 `md-notes`（用户 UI）→ 生效值合并。
- 两种模式：`gitMode: workspace`（每工作区独立仓库）/ `central`（总仓库 `<gitCentralPath>/<ws>/`）。
- Host：`ctx.settings.register('md-notes', schema)` + git 命令经 `subprocess`/`shell` 执行。
- UI：笔记管理面板「同步区」（gitStatus/提交/推送/拉取 + 远程输入）+ dsh 设置面板「MD 笔记」分区。
- 待确认：git 命令沙箱/网络权限、central 模式下笔记请求的 `workspaceId` 路由、`meta.json` 是否入库、
  自动提交防抖。

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
