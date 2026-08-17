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

## 3. 方案设计（B：路径引用，对话自主读取）

> **核心决策**：序列化只输出**文件路径 + 标题**（不把全文塞进上下文），让模型通过
> dsh 的 `read` 工具按路径自行读取。dsh 的 fs 沙箱**只拦截写入**（read 全放行，
> 源码：fs-sandbox "Reads pass through untouched: every mode permits reading"），
> 因此对话读任何路径——包括**其他工作区**的笔记——都不受授权限制，跨工作区自然成立。
> 同时避免"整篇笔记占用上下文"的长度问题。

### 3.1 交互流程（用户视角）

1. 在对话输入框输入 `@` → 弹出菜单，列出笔记（标题 + 文件名 hint），**可跨工作区**。
2. 上下键选择 / 点击选中 → 输入框出现一个笔记 chip（占位符），可多选（多篇笔记）。
3. 发送消息 → 每个 chip 经 `codec.serialize` 序列化为**路径 + 标题**（见 §3.3）。
4. 模型看到路径后调用 `read` 工具读取笔记内容（读放行，跨工作区可读），回答时引用。

纯文本输入 `@笔记名`（不弹菜单直接打字）也能被装饰成 chip，前提是 `warm` 已预取
（lexicon 同步匹配）。

### 3.2 候选数据源（含跨工作区）

- **默认范围**：当前会话工作区的笔记（`api('list', { sessionId })`）。
- **跨工作区**：`list` 不带 sessionId 时返回全部工作区；候选可加**工作区分组**——
  每个候选携带 `workspaceId`，序列化时解析为该工作区的 `.dsh-notes/<name>.md` 绝对路径。
- **候选**：`{ name: 文件名（去 .md）, description: 笔记标题（+ 工作区名）, hint: 更新时间 }`。
- **实时性**：`warm` 在会话诞生时预取；笔记增删后经 `subscribeLexicon` 通知刷新。

### 3.3 序列化格式（进入模型的文本）

`ReferenceCodec.serialize(ref)` 返回**路径引用**（不包含全文）：

```markdown
<note ref="<工作区>/.dsh-notes/xxx.md">笔记标题</note>
```

- `ref` 为笔记的**绝对路径**（解析到具体工作区的 `.dsh-notes`），模型据此调用 `read` 读取。
- 标题作为 chip/序列化的可读标签；路径即"授权"——读放行，跨工作区无碍。
- 标签语言跟随界面语言（新增 `context.noteOpen` / `context.noteClose` 之类 key，中英各一份）。
- 失败（笔记不存在）→ 序列化为空占位并提示，不阻断发送。
- **摘要（暂缓）**：未来可在序列化中附带"标题 + 前 N 字符摘要"（模型先看摘要、
  需要全文再 `read`），减少不必要的读取。本期不实现，见 TODO。

### 3.4 实现位置

- **client**：新增 `features/ContextSource/`（`ContextSource.tsx` + css），在 `apply` 里
  `ctx.get('inputTriggers')?.registerSource(...)`（挂 `ctx.effect`，HMR 安全）。
- **host**：需要两个小扩展：
  - `list` 已支持返回全部工作区（不带 sessionId）；
  - 新增 `resolveNotePath(workspaceId, name)`（或复用现有解析）返回笔记**绝对路径**，
    供 client 序列化 `ref` 使用。

### 3.5 与「记入笔记」的闭环

| 方向 | 现状 |
|---|---|
| 对话 → 笔记 | ✅ 已实现（`appendConversation`，回答下方 📝） |
| 笔记 → 对话 | 🚧 本设计（`@` 引用 + 路径序列化，对话自主读取） |

### 3.6 跨工作区引用的授权说明

- dsh 的 fs 沙箱**只约束写入**（`workspace-write` 拒绝在工作区外写文件），**读取全放行**。
- 因此引用**任何工作区**的笔记路径，对话的 `read` 工具都能读——无需额外授权流程。
- 这与既有 git 同步的授权模型一致（仓库在插件管理目录、无授权），读方向天然开放。

## 4. 知识库式自动检索（超出 dsh 原生，可选阶段）

- **现状**：dsh 无知识库/RAG 机制；引用是用户主动选择，非自动检索。
- **可选增强 1（关键词检索候选）**：host 新增 `contextSearch(q)` API，按标题/内容
  关键词过滤笔记，作为 `@` 候选的扩展（输入更多字符时过滤）。
- **可选增强 2（自动注入）**：把"当前工作区全部笔记"拼接进系统提示——插件无法直接改
  模型请求，需 dsh 提供上下文片段注入接口（**依赖 dsh 平台能力，本期不做**）。

## 5. 验收标准

- 输入 `@` 弹出笔记候选（含**跨工作区**分组）；选中后显示 chip；可多篇。
- 发送后序列化输出**路径 + 标题**；模型能调用 `read` 读取笔记并在回答中引用内容。
- **跨工作区**：引用其他工作区的笔记，模型 `read` 正常读到（无授权障碍）。
- 纯文本 `@笔记名` 可装饰成 chip 并正常序列化。
- 无工作区时 `@` 菜单提示先新建工作区（与现有无工作区提示一致）。
- i18n：菜单空态/提示/序列化标签中英双语。
- HMR 安全：`registerSource` 挂在 `ctx.effect`，卸载自动清理。

## 6. 实现步骤

1. **依赖确认**：`@deepseek-ai/dsh-client-ui-input-trigger` 加入 link-deps 与
   tsdown external（client 侧类型 + 运行时服务）。
2. **host**：`resolveNotePath(workspaceId, name)` 返回笔记绝对路径（跨工作区候选用它）。
3. **Client source**：`features/ContextSource/` 实现 `InputTriggerSource`
   （`candidates` / `onPick` / `codec` / `warm` / `lexicon`）；codec 输出路径引用。
4. **i18n**：新增 `context.*` 前缀 key（菜单标题、空态、序列化标签、无工作区提示）。
5. **联调**：真实会话中 `@` 选笔记（含跨工作区）→ 发送 → 验证模型 `read` 读取并引用。
6. **文档**：实现后更新 features.md（新增 §2.7）+ architecture.md（目录与 slot 说明）。

## 7. 风险与取舍

- **上下文长度**：路径引用方案下，全文不进上下文——模型按需 `read`，长度风险基本消除。
  残余风险：模型可能读入大量内容，由模型自身权衡（`read` 有窗口限制）。
- **多篇笔记**：序列化多篇时按插入顺序拼接，各加 `<note ref=...>` 标签分隔。
- **跨工作区路径**：`ref` 输出绝对路径，可能暴露工作区目录结构——但 dsh 会话本就
  知道工作区路径（cwd），风险可接受。
- **模型不会主动读**：路径引用依赖模型自主调用 `read`；若模型不读，只拿到标题。
  摘要功能（未来）可缓解（见 TODO）。
