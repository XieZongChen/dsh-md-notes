# 笔记加入对话上下文（可被引用）设计

> 本文档设计「把笔记作为可引用的上下文注入 dsh 对话」——TODO 第 2 项的实现蓝图。
> 功能总览见 [features.md](features.md)，架构见 [architecture.md](architecture.md)。

## 0. 实现状态

> 最后更新 2026-08-16。🚧 设计已定、未实现；⏳ 待实测确认。

### 未实现

- 🚧 对话输入 `@` 引用笔记（候选菜单 / chip / 提交序列化）
- 🚧 模型上下文注入（`ReferenceCodec.serialize` 输出笔记内容）
- 🚧 纯文本 `@笔记名` 装饰（`lexicon` 热快照）
- 🚧 知识库式自动检索（超出 dsh 原生能力，需自定义）

## 1. 目标

在 dsh 对话中输入框里，通过 **`@` 触发器引用笔记**：选中一篇笔记后，其内容随该条
消息进入**模型上下文**，让模型在回答时能利用笔记内容。与既有「记入笔记」形成闭环：
**对话可写入笔记（已实现），笔记也可引用进对话（本设计）**。

不追求"自动把笔记灌进每轮上下文"（那需要改动模型请求注入层，插件无法做到）；
本设计采用 dsh 原生的**用户主动精确引用**模型——用户 `@` 选择哪篇，哪篇进上下文。

## 2. dsh 提供的机制（已确认）

`ui-input-trigger` 是 dsh 官方的 **slash / 引用触发管线**，插件可直接接入：

| 机制 | 作用 | 笔记插件的用法 |
|---|---|---|
| `InputTriggerService.registerSource` | 注册一个 `@` 触发源 | `trigger: '@'`，命名 `md-notes` |
| `candidates(session, req)` | 菜单候选列表 | 从 host `list` 拉当前工作区笔记 → `{ name, description, icon, hint }` |
| `onPick(pick)` | 选中回调 | 返回 `ReferenceInsert { source, ref, label, clipboardText }` |
| `ReferenceInsert` | 插入 U+FFFC 占位符（UI 渲染为 chip） | `source: 'md-notes'`、`ref: 文件名`、`label: 标题` |
| `ReferenceCodec` | 提交时把引用**序列化为模型文本** | `serialize(ref)` → 读笔记全文 markdown |
| `warm(session)` | 会话诞生时预取数据 | 预取笔记名列表（配合 lexicon） |
| `lexicon(session)` | 纯文本 `@笔记名` 装饰（同步热快照） | 返回笔记标题数组；未 warm 时返回 undefined（不触发 fetch） |
| `matchEnter` | Enter 时解析整行 | 可选：支持 `/引用 笔记名` 等命令式 |

**关键**：`ReferenceCodec.serialize` 的输出就是进入模型上下文的内容——这是"注入"的
真正落点，UI 的 chip 只是表象。

## 3. 方案设计

### 3.1 交互流程（用户视角）

1. 在对话输入框输入 `@` → 弹出菜单，列出**当前会话工作区**的笔记（标题 + 文件名 hint）。
2. 上下键选择 / 点击选中 → 输入框出现一个笔记 chip（占位符），可多选（多篇笔记）。
3. 发送消息 → 每个 chip 经 `codec.serialize` 序列化为笔记内容，随请求进入模型上下文。
4. 模型回答时可见笔记内容，可引用/总结/续写。

纯文本输入 `@笔记名`（不弹菜单直接打字）也能被装饰成 chip，前提是 `warm` 已预取
（lexicon 同步匹配）。

### 3.2 候选数据源

- **范围**：当前会话工作区的笔记（与「记入笔记」弹窗一致，`api('list', { sessionId })`）。
- **候选**：`{ name: 文件名（去 .md）, description: 笔记标题, hint: 更新时间 }`。
- **实时性**：`warm` 在会话诞生时预取；笔记增删后经 `subscribeLexicon` 通知刷新。

### 3.3 序列化格式（进入模型的文本）

`ReferenceCodec.serialize(ref)` 返回：

```markdown
<note name="笔记文件名">
# 笔记标题

<笔记 markdown 全文>
</note>
```

- 内容来自 host `read` API（读 `<工作区>/.dsh-notes/<name>.md`）。
- 标签语言跟随界面语言（复用 i18n，如 `picker.labelUser` 等约定；此处新增
  `context.noteOpen` / `context.noteClose` 之类 key，中英各一份）。
- 失败（笔记不存在 / 读失败）→ 序列化为空占位并提示，不阻断发送。

### 3.4 实现位置

- **client**：新增 `features/ContextSource/`（`ContextSource.tsx` + css），在 `apply` 里
  `ctx.get('inputTriggers')?.registerSource(...)`（挂 `ctx.effect`，HMR 安全）。
- **host**：无需新 API——复用现有 `list` / `read`（按 workspaceId/sessionId 路由）。

### 3.5 与「记入笔记」的闭环

| 方向 | 现状 |
|---|---|
| 对话 → 笔记 | ✅ 已实现（`appendConversation`，回答下方 📝） |
| 笔记 → 对话 | 🚧 本设计（`@` 引用 + codec 序列化） |

## 4. 知识库式自动检索（超出 dsh 原生，可选阶段）

- **现状**：dsh 无知识库/RAG 机制；引用是用户主动选择，非自动检索。
- **可选增强 1（关键词检索候选）**：host 新增 `contextSearch(q)` API，按标题/内容
  关键词过滤笔记，作为 `@` 候选的扩展（输入更多字符时过滤）。
- **可选增强 2（自动注入）**：把"当前工作区全部笔记"拼接进系统提示——插件无法直接改
  模型请求，需 dsh 提供上下文片段注入接口（**依赖 dsh 平台能力，本期不做**）。

## 5. 验收标准

- 输入 `@` 弹出笔记候选；选中后显示 chip；可多篇。
- 发送后模型能引用笔记内容（回答中体现笔记信息）。
- 纯文本 `@笔记名` 可装饰成 chip 并正常序列化。
- 无工作区时 `@` 菜单提示先新建工作区（与现有无工作区提示一致）。
- i18n：菜单空态/提示/序列化标签中英双语。
- HMR 安全：`registerSource` 挂在 `ctx.effect`，卸载自动清理。

## 6. 实现步骤

1. **依赖确认**：`@deepseek-ai/dsh-client-ui-input-trigger` 加入 link-deps 与
   tsdown external（client 侧类型 + 运行时服务）。
2. **Client source**：`features/ContextSource/` 实现 `InputTriggerSource`
   （`candidates` / `onPick` / `codec` / `warm` / `lexicon`）。
3. **i18n**：新增 `context.*` 前缀 key（菜单标题、空态、序列化标签、无工作区提示）。
4. **联调**：真实会话中 `@` 选笔记 → 发送 → 验证模型上下文包含笔记内容。
5. **文档**：实现后更新 features.md（新增 §2.6）+ architecture.md（目录与 slot 说明）。

## 7. 风险与取舍

- **上下文长度**：长笔记会占用模型上下文——序列化时做**截断**（如前 N 字符 + 提示
  "已截断"）或由用户选择"全文/摘录"。
- **多篇笔记**：序列化多篇时按插入顺序拼接，各加标签分隔。
- **权限**：复用现有沙箱/授权模型（笔记在工作区 `.dsh-notes`，无额外授权需求）。
