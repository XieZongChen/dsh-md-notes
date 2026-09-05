# TODO（功能规划）

> 插件的规划与平台问题追踪：§0 是 dsh 开放能力的历史盘点，其后是**平台问题清单**（等 dsh 开放），
> §1–§4 是功能规划（按主题分组，组内标优先级 高/中/低）。
> 状态标记：✅ 已完成 · 🚧 部分落地 · ⏸ 暂缓 · 未标记即待做。
> **完全完结**的条目：实现后移入 [CHANGELOG.md](../CHANGELOG.md)（只记用户可见的功能性改动），
> 并从本文删除；**部分落地**的条目保留，标注已完成部分与剩余工作。

## 0. dsh 开放能力盘点（历史快照：2026-08-27，迁移 0.1.2-alpha.1 时）

> 迁移时顺带盘点当时对外放出、可优化插件体验的能力。此后 dsh 迭代到 alpha.5，本节仅作
> 历史记录与教训留存；新的能力缺口记在下面「平台问题」一节。

**可用（推荐用）**：

- **`MarkdownText.fileMentions` / `MarkdownFileMentions`**（ui-primitives）：`resolve(value)`
  命中后把**行内代码 token（反引号）**渲染成可点击链接（`open()`/`label`/`title`）。→ 解决
  §3「3.3 笔记互链」里「MarkdownText 不接受自定义 mdast 节点渲染器」的根因。⚠️ 仍只对
  反引号 token 生效，`@笔记名`/`[[…]]` 语法需先预处理成反引号。
- **`InputTriggerCandidateIcon` 语义化**：收紧为 `'file' | 'folder' | 'session'`，dsh 渲染
  真实字形（替代 emoji）。✅ 迁移时已适配。
- **新 slot（可选入口）**：`conversation.chat.node`（按 `ChatNodeKind` 自定义聊天节点）、
  `conversation.message.images`（图片渲染，§3「3.6 图片」）、`conversation.composer.dock` /
  `conversation.input.left/right/dock`（输入区扩展）、`conversation.session.header.utilities`
  （会话头部工具）、`settings.action`/`settings.header`（设置区动作）、`tool.call.toolview`
  （工具卡片）。

**教训留存**：

- **`chatFileMentions` 服务不可用**（2026-08 实测）：该服务是 `ui-deliverables` 独占的单例，
  第三方插件 `ctx.provide('chatFileMentions', …)` 会触发 cordis「service has been registered」
  冲突、导致插件加载失败（已回退 commit `098fc05`）。对话内笔记引用可点需另寻扩展点
  （上游开放多 provider 或用户消息渲染扩展点）。
- **动态样式的合规口径**（issue #2 兜底之后确立）：`[data-slot]` 锚点是 harness 官方给动态
  样式预留的接缝（ui-renderer scoped-slots.tsx 注释明示），**允许且只允许**经锚点定位注入
  样式（示范：`client/index.ts` 的 sidebar-footer 规则）；不碰 css-modules 哈希类名、不写
  任何祖先 inline 样式（历史反例见 [issue #1](https://github.com/XieZongChen/dsh-md-notes/issues/1)）。

## 已知平台问题 / 未开放能力（待 dsh）

格式：**问题** → 现状（含插件侧缓解）→ 根治条件。均需 dsh 上游开放，插件侧只能缓解或等待。

- **sidebar footer 多入口挤压**：
  - 问题：dsh 的 `.footerActions`（`sidebar.footer.action` 容器，
    `packages/client/ui-sidebar/src/client/SidebarRoot.module.css`）是 `display: flex` row+nowrap，
    而默认 web bundle 自带 `ui-cordis` 入口与本插件入口都是 `width:100%; flex:none`——
    两个不可压缩的全宽子项互相挤压/溢出（[issue #2](https://github.com/XieZongChen/dsh-md-notes/issues/2)）。
  - 现状（插件侧已兜底）：`client/index.ts` 注入
    `div:has(> [data-slot='sidebar.footer.action']) { flex-direction: column }`——单入口视觉
    无变化、多入口各占一行、`:has()` 不支持时静默退回现状。
  - 根治：dsh 把 `.footerActions` 改为 `flex-direction: column`（或 `flex-wrap: wrap`）——
    待向 dsh 提 issue/PR；**上游落地后删除插件侧兜底规则**。
- **设置面板「打开并跳到某 section」无导航 API**：`openSettingsDocument` 是 settings 文档的
  Remote（host→client 拉配置），非「打开面板到某分区」。插件 `openDshSettings` 目前靠
  `querySelector` 模拟两次点击跳「MD 笔记」分区（脆弱，耦合 dsh DOM）——待 dsh 开放设置
  导航/跳转 API 后替换。
- **插件级快捷键注册无公开 API**：composer 的 keymap 是 `ui-conversation` 内部实现。§3「3.5
  编辑体验」与 §4「4.2 保存快捷键」的 Cmd/Ctrl+S 只能插件内自监听 `keydown`（需避免与 dsh
  冲突），待 dsh 开放快捷键注册扩展点。
- **@ 引用 chip 尺寸/结构不可定制**：chip 为 4em 硬编码（`DshChipCell` 字体），且 chip DOM
  无 `[data-slot]` 锚点（非 slot 渲染点），合规注入路径也不可用；`conversation.chat.node`
  是节点级扩展点、非 chip 级。更宽的 chip 标签区需 dsh 开放 chip 尺寸/渲染扩展点。

## 1. 笔记引用进对话的细化（@ 引用已实现）

### 1.1 引用摘要 ⏸

- 在注入时只放「标题 + 前 N 字符摘要」（而不是全文），模型需要细节时再按路径 `read` 全文，
  减少注入内容的上下文占用。
- **暂缓**：当前注入的是全文（context.md §3.7），摘要可缓解长笔记占上下文的问题——需要
  权衡「模型直接拿全文」与「摘要 + 按需 read」的可靠性差异后再定。

### 1.2 引用笔记的样式优化（待做）

**目标**：把「笔记引用」在三个展示面上的观感从「能用」提升到「好看、可识别」。

**现状**：

- 输入框 chip：dsh 硬编码胶囊（蓝底、原生 4em 单元格），插件已做标签前置截断（>4 字符 → 前 4 + …）
  并在 chip 前置插件 logo；
- 发送后的消息行：`引用笔记 [标题](.dsh-notes/xxx.md)`（标准 markdown 链接语法，标题与路径
  结构化绑定；dsh 用户气泡是纯文本渲染，暂不可点击）；
- 注入上下文行：通用「上下文注入」DisclosureRow（来源标 `md-notes`，内容头部带一行
  「引用约定：回答中引用用 markdown 链接」），无笔记专属外观。

**设想**（各受 dsh 渲染机制约束，见 context.md §2.1/§3.3/§3.7）：

1. **输入框 chip**：
   - 跨工作区引用的 chip 能看出工作区来源（如标签带 `工作区·` 前缀，或 hover tooltip 显示完整路径）；
   - 截断上限按 chip 实际像素宽自适应（当前 4 字符对中英混排偏保守）；
   - **菜单内全工作区列选**：带空格的工作区名无法用文本触发（dsh 触发 token 遇空白截断），
     在候选菜单里提供「全工作区」浏览/列选入口（不依赖文本触发词）。
   - 受限点：chip 尺寸 4em 固定、无锚点不可合规注入（见上面平台问题最后一条），曾用
     `DshChipCell` 字体覆盖放大（6em/10em）已按规范移除——更大标签区需平台开放 chip 扩展点。
2. **注入上下文行**：
   - 来源标签显示**笔记标题**而非 `md-notes`（受 `contextProvenance` 的 kind 映射约束，
     需在 source 里携带标题字段或选用 dsh 已有 form/provenance 通道）；
   - 行内摘要（标题 + 前 N 字）与更贴合的图标/配色（当前走通用 `OpaqueBody`）；
   - **手动删除持久化**：注入的笔记内容会一直留在会话历史里（直到 compaction）。在注入
     上下文行上加「删除」按钮：host 新增 API（如 `contextRemove(sessionId, path)`），按
     `source.kind === 'md-notes'` + `path` 定位该消息，用 surface `{ op: 'replace', start, end }`
     把它从模型可见历史中移除（compaction 同款机制）；只删注入内容、不动用户自己的消息；
     删除后不会复活（pre-step 只扫描新提交消息找引用）。

**验收标准**：三个展示面都能一眼识别「这是一篇笔记引用」及其来源工作区/标题；
明暗主题下样式一致；不破坏现有引用功能（候选/chip/注入）。

## 2. Git 冲突渲染及可视化解决

**目标**：推送/更新遇到 git 冲突时，不再只给纯文本错误，而是可视化展示并引导解决。

**🚧 AI 语义合并已落地（2026-09-04，见 [ai-conflict.md](ai-conflict.md)）**：push 拦截与更新
冲突的确认弹窗新增「AI 解决」按钮——插件在冲突工作区新建会话，把三方内容（本地版/基线/
远端版 sidecar，检测点当场写入 `.dsh-notes/.conflicts/`）提交给模型做**语义合并**（非选边；
判断不了的合并点经 `ask_user` 问用户）；完成后 AI 调用 `push_notes` 工具推送，工具经 dsh
**原生审批面板**两级确认（推送/覆盖）；推送成功自动清理 sidecar。随附修复：`gitSync`
合并冲突后 clone 永久卡死（MERGE_HEAD 未清理，现入口预清理 `merge --abort`）。

**仍待做（可视化部分）**：需要**本地/远端交叉编辑合并**（逐块选边 + 手动微调合并结果），
方案定稿（2026-08 调研）采用可编辑的合并编辑器：

- **首选：CodeMirror 6 + [`@codemirror/merge`](https://www.npmjs.com/package/@codemirror/merge)**
  （MIT）：并排两路 diff + 冲突块 **accept/reject 按钮**（逐块接受左/右/两边），结果区
  可自由编辑；三路模式有 ours/theirs/combined。体积可控（~300KB gzip 级），可内嵌管理器，
  tsdown 内联进 bundle。
- **备选**：Monaco diff editor（功能更强但体积大，需裁剪 worker/语言包）。
- **只读备选**：diff2html（~20KB，仅「查看差异 + 二选一」，**不支持交叉编辑合并**——不满足
  本项目标，仅作只读预览用）。

**设想**：

- 冲突检测已具备（`remote-changed`、`non-fast-forward` 错误码，sidecar 已落盘可复用）；在此基础上：
  - **冲突渲染**：管理器内嵌 CodeMirror merge 面板，渲染**远端 vs 本地**对比（sidecar 即
    数据源），逐文件查看差异。
  - **可视化解决**：冲突块逐块接受/拒绝（ours/theirs/combined）+ 合并结果直接编辑，写回本地
    （可经 git 提交）；保留「用远端覆盖 / 用本地覆盖」整篇快捷操作；AI 解决（已落地）与
    可视化合并互为补充——AI 产出也可进入可视化面板微调。
  - 合并（`gitSync`）的结果展示合并状态与剩余冲突。

**验收标准**：推送/更新遇冲突时，管理器展示冲突列表与可编辑的差异视图，用户可逐块选择
保留/合并并保存结果。

## 3. 笔记能力增强

**目标**：围绕「记、查、找、读」提升笔记使用体验——从纯文件编辑升级为顺手的信息管理。
笔记量大了之后，检索、导航、互链与快速访问比渲染细节更影响日常体验，优先做这些。

**设想**（按优先级）：

- **3.1 笔记搜索**（高）：管理器加搜索框，跨工作区**全文搜索**（标题 + 内容），输入即时
  过滤、命中高亮，结果按工作区 / 笔记分组展示命中位置。host 侧只读遍历各工作区
  `.dsh-notes` 下的 `.md`（规模小每次现扫，量大再考虑索引 / 防抖）。
  验收：多笔记工作区秒级定位；结果展示命中上下文。

- **3.2 标题目录（TOC）**（高）：预览顶部 / 侧栏按笔记标题生成目录，点击锚点跳转。
  约束：`MarkdownText` 标题渲染无锚点（dsh 未开放 heading 定制）——先评估 dsh 是否有
  heading id / 滚动定位扩展点；若无，降级为提取标题列表、点击 `scrollIntoView` 定位
  （需自建轻量标题提取，与 MarkdownText 输出并行）。
  验收：长笔记可一键跳到任意标题。

- **3.3 笔记互链 + 反链**（中）。🚧 **互链已实现（2026-08，commit `116aec4`+`196ddc8`）**：
  预览里 `` `笔记名` ``（反引号）与 `[[笔记名]]`（wiki，代码围栏外预处理成反引号）两种拼写
  都会渲染成可点链接，点击经 `open()` 跳转（含跨工作区切换）。解析按「标题 / 文件名（去
  `.md`、大小写不敏感）」匹配，未命中 token 保持惰性（`[[…]]` 保留原样、反引号呈普通代码）。
  实现见 `note-links.ts`（`resolveNoteLink` / `preprocessWikiLinks`）。
  - **渲染链路**：dsh 0.1.2-alpha.1 的 `MarkdownText.fileMentions`（`resolve(value) → { open,
    label, title }`）把行内代码 token 渲染成可点链接——原「不接受自定义 mdast 节点渲染器」的
    根因已解除；`[[…]]` 经预处理喂给 fileMentions。
  - **匹配规则（2026-08-27 增强）**：标题或文件名；未限定 token 优先当前工作区、无重名仍可跨区；
    `工作区名/笔记名` 限定语法可精确链接另一工作区的重名笔记；同工作区标题重名时 tooltip 提示
    「N 篇同名标题，建议用文件名区分」（`titleMatchCount`）。
  - **仍待做**：
    - **失效样式**：目标改名/删除时无「缺失」视觉（fileMentions 只分可点/惰性，无失效态），
      需评估 dsh 是否支持失效态或降级为「惰性 + 提示」。
    - **反链**：host 扫描各笔记内容，找出引用当前笔记的 `[[…]]` / `` `…` ``，编辑器旁展示
      「谁引用了它」。
  验收：`[[笔记名]]` 点击直达、同名歧义可解决、失效可见；反链列表准确。

- **3.4 快速访问**（中）：星标置顶 + 最近编辑列表（管理器顶部快捷区）；星标单独存
  （不入库，遵守 meta 缓存规则）。
  验收：常用笔记一步到达。

- **3.5 编辑体验**（中）：自动保存（防抖）、字数统计、编辑 / 预览切换快捷键
  （探索 dsh 快捷键注册扩展点；无扩展点则仅插件内监听）。
  验收：编辑不丢改动、字数可见。

- **3.6 图片支持**（中）：拖拽 / 粘贴图片存入笔记同目录（或 `.dsh-notes/assets/`），
  markdown 以相对路径引用并预览（MarkdownText 原生支持图片语法）。注意：Git 同步当前只
  同步 `.md`（「Only `.md` files sync」），图片入库需扩展同步范围，需一并评估。
  验收：截图可直接贴入并预览；若扩展同步则图片随笔记推送。

- **3.7 导出**（低）：单篇导出 md / HTML（浏览器下载）；全部导出打包 zip（需引入打包
  依赖，或逐篇下载）。
  验收：笔记可脱离插件带走。

**安全 / 平台约束**：搜索、反链走 host 只读遍历，不碰笔记外文件；互链 / 反链复用既有
name 解析与 @ 引用逻辑；新 UI 文案进 `md-notes` 字典（中英）；渲染安全由 MarkdownText
保证（不引入原始 HTML 透传）；动态样式只走官方 `[data-slot]` 锚点（口径见 §0「教训留存」），
无锚点的增强（如自定义标题锚点）标注「探索扩展点，受限则降级」。

**验收标准**：大笔记量下可秒级搜索定位；预览可按目录跳转；互链可点击直达、反链准确；
星标 / 最近让常用笔记一步到达；新功能文案双语一致。

## 4. 交互体验优化

**目标**：磨平日常使用中的摩擦点——本地改动与远端状态可见、长操作不阻塞界面、编辑不静默丢失。

**待做**（按优先级）：

- **4.1 编辑器脏状态提醒**（中）：🚧 部分落地——未保存时编辑器工具栏显示「未保存」pill
  （0.7.0）。剩余：切换笔记 / 关闭管理器前提示（或自动保存）——现状切换笔记直接丢弃未保存内容。
- **4.2 保存快捷键**（中）：Cmd/Ctrl+S 保存当前笔记（探索 dsh 快捷键注册扩展点；无则插件内监听）。
- （可按需扩展：保存成功定位、操作 loading 统一、多标签编辑等。）

**验收标准**：未推送改动在界面上清晰可见且关闭前有提醒；记入笔记不阻塞弹窗；未保存编辑
不静默丢失；保存可用快捷键触发。
