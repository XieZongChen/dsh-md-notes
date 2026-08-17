# 笔记加入对话上下文（可被引用）设计

> 本文档设计「把笔记作为可引用的上下文注入 dsh 对话」——TODO 第 2 项的实现蓝图。
> 功能总览见 [features.md](features.md)，架构见 [architecture.md](architecture.md)。

## 0. 实现状态

> 最后更新 2026-08-17。✅ 已实现；⏳ 待真实会话联调确认。

### 已确认（dsh 源码调研）

- ✅ `@` 引用管线（`ui-input-trigger`：registerSource / candidates / onPick / ReferenceCodec）
- ✅ fs 沙箱只拦写入、读放行 → 跨工作区读取无授权障碍
- ✅ `tool-fs` 核心挂载，`read` 工具默认对 agent 可用
- ✅ chip 与候选菜单为 dsh 硬编码，插件不可定制渲染（工作区信息走候选 label 文本）
- ✅ **纯文本 `@笔记名` 仅装饰**（textRef 高亮），不产生 chip、不注入上下文；引用必须走菜单 chip
- ✅ **serialize 失败阻断发送**（源码 "serialize failure blocks the send"）——引用失效需用户移除
- ✅ **textRef 匹配 `[\w-]+`** → 跨工作区文本触发仅支持 ASCII 工作区名
- ✅ **候选 icon 实测结论**：`MenuView` 把 `InputTriggerCandidate.icon` 作为**纯文本**渲染在
  16px 槽位（`{item.icon}` 字符串子节点）——**URL/SVG 无法渲染成图片**，会显示字面 URL 文本。
  因此候选 icon 用 📝 emoji 替代插件 SVG（见 §3.2）。

### 已实现（0.3.0）

- ✅ 对话输入 `@` 引用笔记（候选菜单 / chip / 提交序列化）
- ✅ 模型上下文注入（`ReferenceCodec.serialize` 输出路径引用，模型自主 `read`）
- ✅ 纯文本 `@笔记名` 装饰（`lexicon` 热快照，仅 ASCII 标题生效）
- 🚧 知识库式自动检索（超出 dsh 原生能力，需自定义，见 §4）

### 待实测（真实会话）

- ⏳ `@` 选笔记（含 `@工作区名/` 跨工作区）→ 发送 → 模型 `read` 读取并在回答中引用
- ⏳ 引用失效路径：删除笔记后发送被阻断，提示「<笔记名> 无法找到，请删除引用」

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
| `ReferenceInsert` | 插入 U+FFFC 占位符（UI 渲染为 chip） | `source: 'md-notes'`、`ref: 笔记绝对路径`、`label: 标题` |
| `ReferenceCodec` | 提交时把引用**序列化为模型文本** | `serialize(ref)` → 输出**路径 + 标题**（见 §3.3） |
| `warm(session)` | 会话诞生时预取数据 | 预取笔记名列表（配合 lexicon） |
| `lexicon(session)` | 纯文本 `@笔记名` 高亮装饰（同步热快照） | 返回笔记标题数组；**仅装饰，不参与引用语义**（见 §3.1） |
| `matchEnter` | Enter 时解析整行 | 可选：支持 `/引用 笔记名` 等命令式 |

**关键**：`ReferenceCodec.serialize` 的输出就是进入模型上下文的内容——这是"注入"的
真正落点，UI 的 chip 只是表象。`ReferenceInsert.ref` 携带**笔记绝对路径**（含工作区信息），
`label` 才是显示文本——serialize 阶段不再丢失工作区信息。

### 2.1 渲染定制能力（已确认，有限制）

- **引用 chip**：dsh 硬编码渲染（`InputBar` 内 `css.chip` + `chipLabel`，显示 `ReferenceInsert.label`），
  **插件无法定制样式/结构**（无 slot 注入点）。
- **`@` 候选菜单**：dsh 硬编码渲染（`MenuView` 按 source 分组候选行），插件无法改面板结构；
  但**候选内容本身可携带任意 label/description**，可在文本里体现工作区信息
  （如 `「工作区名」笔记标题`）。
- **模型 `read` 工具**：`tool-fs` 在 base/web bundle 核心挂载，`read` **默认对 agent 可用**（无需额外配置）。

## 3. 方案设计（B：路径引用，对话自主读取）

> **核心决策**：序列化只输出**文件路径 + 标题**（不把全文塞进上下文），让模型通过
> dsh 的 `read` 工具按路径自行读取。dsh 的 fs 沙箱**只拦截写入**（read 全放行，
> 源码：fs-sandbox "Reads pass through untouched: every mode permits reading"），
> 因此对话读任何路径——包括**其他工作区**的笔记——都不受授权限制，跨工作区自然成立。
> 同时避免"整篇笔记占用上下文"的长度问题。

### 3.1 交互流程（用户视角）

1. 在对话输入框输入 `@` → 弹出菜单，列出**当前工作区**的笔记（标题 + 文件名 hint，插件图标）。
2. 上下键选择 / 点击选中 → 输入框出现一个笔记 chip（占位符），可多选（多篇笔记）。
3. **跨工作区**：输入 `@工作区名/`（如 `@dsh-plugin/`，**仅支持 ASCII 工作区名**）扩展到
   该工作区的笔记；候选 label 显示笔记标题，description 可带工作区名（§3.2）。
4. 发送消息 → 每个 chip 经 `codec.serialize` 序列化为**路径 + 标题**（§3.3）。
5. 模型看到路径后调用 `read` 工具读取笔记内容（读放行，跨工作区可读），回答时引用。

> **纯文本 `@笔记名` 仅为装饰**（lexicon 高亮），**不注入上下文**——dsh 源码确认 textRef
> 只是显示层装饰，不产生 chip occurrence，发送时仍是字面 `@笔记名`。真正引用必须通过
> 菜单选中（chip）。因此**不依赖 lexicon 做引用语义**（lexicon 仅可选地提供高亮）。
> 由于 chip 的 `ref` 是**工作区 + 名称**的绝对路径，跨工作区/同名笔记天然无歧义。

### 3.2 候选数据源（含跨工作区）

- **默认范围**：当前会话工作区的笔记（`api('list', { sessionId })`）——`@` 默认只列当前工作区，
  避免菜单杂乱。
- **跨工作区触发（方式 A）**：输入 `@工作区名/`（触发词前缀）时，candidates 根据 `query`
  识别工作区前缀，返回该工作区的笔记；label 为笔记标题，description 可附工作区名。
  **仅支持 ASCII 工作区名**（`[\w-]+`，dsh 的 textRef 匹配约束；中文/空格工作区名无法
  用文本触发——跨工作区引用受限，可后续提供菜单内全工作区列选）。
- **候选**：`{ name: 笔记标题, description: 文件名（去 .md）, icon: '📝', hint: 无 }`；
  跨工作区候选 `description` 为 `工作区名 · 文件名`。
  `icon` 实测为**纯文本渲染**（16px 槽位），URL/SVG 无法显示为图片，故用 📝 emoji 替代
  插件 SVG（§0 实测结论）。
- **无工作区**：`warm`/`candidates` 返回空（`@` 不到笔记）——不弹菜单，静默无候选。
- **实时性**：`warm` 在会话诞生时预取；笔记增删后经 `subscribeLexicon` 通知刷新
  （lexicon 仅用于可选的高亮装饰，不影响引用语义）。

### 3.3 序列化格式（进入模型的文本）

`ReferenceCodec.serialize(ref)` 返回**路径引用**（不包含全文）。跨工作区时 ref 带工作区限定：

```markdown
<note ref="<工作区>/.dsh-notes/xxx.md">笔记标题</note>
```

- `ref` 为笔记的**绝对路径**（含工作区），形如 `<工作区>/.dsh-notes/xxx.md`——**工作区 + 名称**
  天然唯一，跨工作区/同名笔记无歧义；模型据此调用 `read` 读取。
- 标题作为 chip/序列化的可读标签；路径即"授权"——读放行，跨工作区无碍。
- **标签 `<note>` 固定英文**：它是面向模型的协议 token（机器可读、需确定性），不随界面
  语言变化——中英文界面发出同样的 `<note ref=...>`，模型解析一致（§3.3 原文「标签语言跟随
  界面语言」为早期草案，实现时按协议稳定性定为固定 `<note>`）。
- **引用失效处理**：被引用的笔记若已删除/移动，`serialize` 失败会**阻断发送**（dsh 源码：
  "serialize failure blocks the send"）。此时向用户提示
  **「<笔记名> 无法找到，请删除该引用」**，保留 draft 与 chip 让用户移除后重发。
- **摘要（暂缓）**：未来可在序列化中附带"标题 + 前 N 字符摘要"（模型先看摘要、
  需要全文再 `read`），减少不必要的读取。本期不实现，见 TODO。

### 3.4 实现位置

- **client**：新增 `features/ContextSource/`（`ContextSource.tsx` + css），在 `apply` 里
  `ctx.get('inputTriggers')?.registerSource(...)`（挂 `ctx.effect`，HMR 安全）。
- **host**：`list` API **透出每个工作区的 `notesDir`**（WorkspaceEntry 已有该字段，http 层
  补返回即可）——client 用 `notesDir + 文件名` 拼绝对路径，**零新增 API**。
  跨工作区候选也由 `list`（不带 sessionId）全量返回，各带 `notesDir`。

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

- 输入 `@` 弹出笔记候选（**默认当前工作区**，候选带插件图标）；选中后显示 chip；可多篇。
- 发送后序列化输出**路径 + 标题**；模型能调用 `read` 读取笔记并在回答中引用内容。
- **跨工作区**：输入 `@工作区名/`（ASCII）触发该工作区候选；序列化 ref 为 `<工作区>/笔记名.md`；
  模型 `read` 正常读到。
- **引用失效**：被引用笔记删除/移动后发送 → 提示「<笔记名> 无法找到，请删除引用」，
  draft 与 chip 保留，不静默丢弃。
- 纯文本 `@笔记名` 仅装饰、不注入上下文（不依赖 lexicon 语义）。
- 无工作区时 `@` 无候选（静默）。
- i18n：菜单空态/提示/序列化标签/失效提示中英双语。
- HMR 安全：`registerSource` 挂在 `ctx.effect`，卸载自动清理。
- ✅ 已实测确认：`InputTriggerCandidate.icon` 在菜单中渲染为**纯文本**（16px 槽位），
  URL/SVG 不能显示为图片 → 候选图标用 📝 emoji（§0 实测结论）。

## 6. 实现步骤

1. **依赖确认**：`@deepseek-ai/dsh-client-ui-input-trigger` 加入 link-deps 与
   tsdown external（client 侧类型 + 运行时服务）。✅
2. **host**：`list` API 透出每工作区 `notesDir`（供 client 拼 ref 绝对路径）。✅
3. **Client source**：`features/ContextSource/` 实现 `InputTriggerSource`
   （`candidates` / `onPick` / `codec` / `warm` / `lexicon`）：
   - `ref` = 笔记**绝对路径**（`notesDir + 文件名`），`label` = 标题；
   - `candidates` 解析 `query`：`@工作区名/` 前缀 → 该工作区候选，否则当前工作区；
   - `icon` = 📝 emoji（实测 icon 为纯文本渲染，见 §0）。✅
4. **i18n**：新增 `context.*` 前缀 key（**引用失效提示**、校验失败提示）。✅
5. **联调**：真实会话中 `@` 选笔记（含 `@工作区名/` 跨工作区）→ 发送 → 验证模型 `read` 读取并引用。⏳
6. **文档**：features.md §2.7 + architecture.md（目录与 slot 说明）+ 本文状态。✅

## 7. 风险与取舍

- **上下文长度**：路径引用方案下，全文不进上下文——模型按需 `read`，长度风险基本消除。
  残余风险：模型可能读入大量内容，由模型自身权衡（`read` 有窗口限制）。
- **多篇笔记**：序列化多篇时按插入顺序拼接，各加 `<note ref=...>` 标签分隔。
- **引用失效**：笔记删除/移动后发送被阻断（dsh 源码行为）——按 §3.3 提示用户移除引用，
  不静默降级。
- **模型主动读**：`tool-fs` 核心挂载、`read` 默认可用（已确认），模型通常会在引用后读取；
  但依赖模型自主行为——若模型不读，用户只拿到标题。摘要功能（未来）可缓解（见 TODO）。
- **渲染不可定制**：chip 与候选菜单为 dsh 硬编码，插件无法改样式/结构——工作区信息只能
  通过候选 label 文本体现（§2.1）。
- **lexicon 全局合并**：`@` 的 lexicon 是多个 source 合并的名称数组，纯文本装饰可能与其他
  source 重名——但引用语义不依赖 lexicon（仅装饰），chip 的 ref 是工作区+名称绝对路径，无歧义。
- **ASCII 限制**：跨工作区文本触发仅支持 ASCII 工作区名（`[\w-]+`）；中文/空格工作区名需
  其他方式（后续可加菜单内全工作区列选）。
- ✅ **icon 结论**：候选 icon 为纯文本渲染，插件 SVG 无法显示——用 📝 emoji 替代
  （16px 槽位内可见），不再依赖 `ICON_URL`。
