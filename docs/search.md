# 笔记搜索设计方案

> 目标：落实 [TODO.md](TODO.md) §3.1「笔记搜索」。**全工作区**全文搜索（标题 + 正文），
> 搜索框只做在笔记管理面板（`NotesManager`）里——`NotePicker`（记入笔记弹窗）与 `@`
> 引用候选菜单**不在本期范围**；命中可点击，打开笔记并**定位到命中行**。
> 布局沿用 [manager-redesign.md](manager-redesign.md) 顶部栏「搜索框 · 预留位」。

## 0. 实现状态

> ✅ **已实现（2026-09-06，未发布）**：契约 + host `searchNotes`（12 个域单测）、HTTP
> 分发（3 个分发单测）、顶部搜索框 / `useNoteSearch` / `SearchResults`、命中定位
> （located open + textarea 选中滚动，纯函数 13 个单测）。与原方案的两处落地差异：
> ① 命中行文本按**前缀**截断 160 字符（非中段截断——保证 `ranges` 与显示文本一致，
> 越界 ranges 直接丢弃）；② 标题命中若来自 H1 标题行，命中行即 L1（定位文首）；
> 文件名兜底标题（正文无命中）时无命中行、普通打开。预览态定位（§6.4）维持不做。
> 使用说明见 [usage.zh.md §2](usage.zh.md#搜索笔记)。

## 0. 结论先行

- **入口**：管理面板顶部栏（`managerHead`）加一个搜索框；输入即搜（防抖 250ms）。
- **范围**：跨**全部工作区**扫描 `.dsh-notes` 下的 `.md`（标题 + 正文），结果按工作区分组。
- **定位**：点命中 → 打开笔记、切到**编辑态**、滚动到命中行并**选中**命中 token
  （textarea 原生 selection 即高亮）。预览态定位 v1 不做（见 §6.4）。
- **不做**：索引（规模小每次现扫）、正则 / 通配符、分词（纯大小写不敏感子串）、
  面板外入口、历史记录。

## 1. 现状与约束

架构与硬约束见 [AGENTS.md](../AGENTS.md)，与本设计直接相关的：

- **单一 HTTP 通道**：前后端只经 `POST /plugins/md-notes` 说话，wire 类型单一来源
  `src/contract.ts`（`ApiContract` 一 method 一条），两侧 import、禁止复制。
- **dsh 无搜索能力**：`dsh-session-query` 是会话日志检索、`dsh-tools` 是 agent 工具
  注册设施，均无面向插件的文件/全文搜索服务；`ctx.get('workspaceRegistry')` 的工作区
  枚举 + 目录解析（`src/index.ts` 的 `resolveDir`）即搜索所需的全部平台信息。
  host 本就直接以 `node:fs/promises` 读写 `.dsh-notes`（`src/host/notes.ts`），沿用即可。
- **路由与栅栏**：不开新路由——现有单路由按 `{ method, ...args }` 分发，`handleApi`
  加 `search` 一项即可；`authorize` 栅栏对整条路由已生效。
- **安全边界**：搜索只读遍历各工作区 `.dsh-notes` 内的 `.md`（跳过 `meta.json`），
  不接收任何文件名参数（无 `sanitizeName` 暴露面）；query 做长度截断；纯子串匹配，
  不构造正则（无 ReDoS 面）。
- **i18n**：新 UI 文案只走 `features/locales/`（zh 源字典、en 同键映射），后端只回
  错误码 + 英文 detail。
- **编辑器现状**（定位机制的落点）：编辑态是原生 `textarea`
  （`notes-manager.module.css` 的 `.textarea`，`font: 13px/1.6` 等宽、行高固定）；
  预览态是 `MarkdownText`——**无 heading 锚点、无「源码行 ↔ 渲染节点」映射**
  （TODO 3.2 的同源约束），所以「精确到行」只在编辑态可实现。

## 2. 交互设计

```
┌──────────────────────────────────────────────────────────────────────┐
│ 顶部栏：icon 笔记管理器 ⚙    [ 🔍 搜索全部工作区… ]           ✕     │
├────────────────────────┬─────────────────────────────────────────────┤
│ query 为空 → 现有左栏   │  编辑器 / 预览（不变）                       │
│ (WorkspaceList)        │                                             │
│                        │                                             │
│ query 非空 → 搜索结果   │                                             │
│ ┌ 搜索结果 (N 篇) ────┐ │                                             │
│ │ 工作区 A · 3 篇      │ │                                             │
│ │  笔记标题      5 处  │ │  点笔记行 → 定位到第一个命中                 │
│ │   12  …foo <mark>bar</mark> baz… │  点命中行 → 定位到该行该 token   │
│ │   34  …<mark>bar</mark> qux…     │                                 │
│ │  标题命中的笔记  标题 │ │                                             │
│ │ 工作区 B · 1 篇      │ │                                             │
│ └─────────────────────┘ │                                             │
├────────────────────────┴─────────────────────────────────────────────┤
│ 底栏 Git 汇总行（不变）                                                 │
└──────────────────────────────────────────────────────────────────────┘
```

- **搜索框**：顶部栏标题区与关闭按钮之间（manager-redesign §4.1 预留位），
  `IconSearchOutline16` 前缀 + 原生 input；`Esc` 或 `✕` 清空并恢复列表；
  焦点快捷键（`/` 或 Cmd+K）暂不做——与 TODO 4.2 快捷键一样等 dsh 扩展点，避免自监听泛滥。
- **触发**：输入变化防抖 250ms 后发请求；用 `AbortController` 取消上一个未完成请求
  （`features/api.ts` 的 `api(method, args, signal?)` 已支持）；query trim 后为空不发请求。
- **结果区**：query 非空时**替换左栏**（编辑器区不动，已打开的笔记保持）：
  - 按工作区分组：组头 = 工作区名 + 命中笔记数；
  - 笔记行 = 标题 + 总命中数；仅标题命中的笔记标「标题命中」徽标、无行子项；
  - 命中行子项 = 行号 + 片段（token 用 `<mark>` 高亮，中段截断 ~160 字符）；
  - 超上限时组尾提示「仅显示前 N 篇，请收窄关键词」（`truncated`）；
  - 空态（无命中 / 搜索中 / 请求失败）各有文案。
- **点击行为**：
  - 点**笔记行**：打开该笔记并定位到第一个命中（标题命中则只打开、定位到文首）；
  - 点**命中行**：打开该笔记并定位到该行、选中该行上的第一个命中 token。
  - 语义与现有 `open()` 一致：切笔记直接丢弃未保存内容（TODO 4.1 落地前不单独处理）。
  - **「在侧栏查看」（dsh 0.1.5+）**：笔记行尾的 panel 图标把该笔记以绝对文件地址交给
    `ctx.sidebarRight.openResource`（右侧栏笔记查看器，docs/features.md §2.9）并关闭管理器
    （overlay 全屏，不关看不到侧栏）；Sidebar 服务缺失时按钮隐藏。地址由
    `NoteViewer/address.ts` 的 `noteFileAddress(workspaces, wsId, name)` 生成。

## 3. 契约设计（src/contract.ts）

`ApiContract` 新增一项（类型与 `NoteSummary` 等实体同样定义在 contract.ts）：

```ts
/** One matched line inside a note (all offsets are line-relative, 0-based). */
export interface SearchHit {
  /** 1-based source line number. */
  line: number
  /** The (EOL-normalized) line text, middle-truncated to ≤160 chars for display. */
  text: string
  /** Token occurrence ranges within `text` (client-side <mark> highlight). */
  ranges: Array<{ start: number; end: number }>
}

/** One note's search result. */
export interface NoteHits {
  workspaceId: string
  workspaceName: string
  name: string
  title: string
  /** At least one token matched the title (note surfaces even with no body hits). */
  titleMatch: boolean
  /** Total matched lines in the body (uncapped; rows returned are capped). */
  totalHits: number
  /** First N matched lines, source order. */
  hits: SearchHit[]
}

// ApiContract 内：
search: {
  req: { query: string }
  res: ApiResult<{ results: NoteHits[]; truncated: boolean }>
}
```

**匹配语义**（host 与 client 都不假设更多）：

- query 按空白切 token、去空；**空 token 集 → 空结果**（client 也不发请求）；
- 一篇笔记命中 = 全部 token（AND）都出现在「标题 + 正文」拼接串中，大小写不敏感、
  纯子串匹配（对中文/英文/混排一致，无分词无词干）；
- `hits` = 正文中**至少含一个 token** 的行（源码顺序），行内所有 token 出现位置进
  `ranges`；
- `titleMatch` 独立判定（token 全部出现在标题中），使改名后标题仍可搜到旧正文笔记、
  标题改后正文旧词不再淹没结果。

**上限**（防超大笔记库 / 超长行撑爆响应）：

- query 截断到 100 字符；
- 每笔记最多返回 5 个命中行（`totalHits` 记全量供「N 处」展示）；
- 响应最多 50 篇笔记（按工作区注册顺序、笔记 new→old 排序截断），`truncated: true`。

## 4. host 实现（src/host/notes.ts + src/index.ts 组装）

新增纯函数 `searchNotes(scopes, query)`（`notes.ts` 域层，与 `listNotes` 同层）：

- 入参 `scopes: Array<{ workspaceId, workspaceName, dir }>` 由 `src/index.ts` 组装——
  复用 `list` 已有的 registry 遍历 + `resolveDir`，逐工作区串行（与 git status 的
  串行化教训同因：并发扫描无收益、只占连接）；
- 每个工作区：`readdir` → 过滤 `.md`（跳过 `meta.json`）→ `readFile` →
  `\r\n`/`\r` 规范化为 `\n` → 逐行 `toLowerCase` 子串匹配；
- 标题取 `titleOf(content, fallback)`（现有函数），meta 缓存**不参与**搜索
  （正文才是事实来源；meta 只有 title/updatedAt）；
- 排序：笔记按 `updatedAt` 新→旧（readdir 后 stat 一次，成本可忽略）。

**HTTP**：`src/host/http.ts` 的 `handleApi` method 分发表加 `search`，无新路由、
无新错误码（读目录失败按现有 `io` 错误路径返回）。

**测试**（`src/host/notes.test.ts`）：

- 标题命中（无正文命中也返回、`titleMatch: true`、`hits: []`）；
- 正文命中、行内多 token 多次出现 → `ranges` 完整；
- 多 token AND 语义（少一个 token 即不命中）；
- 大小写不敏感、中文子串、CRLF 文件行号正确；
- 上限：5 行截断 + `totalHits` 全量、50 篇截断 + `truncated`；
- 空 / 纯空白 query → 空结果；空目录、缺目录不抛错。

## 5. client 实现（features/NotesManager）

保持「renderer lean」的既有分层：

- **`hooks/useNoteSearch.ts`**（新）：状态机 `idle | searching | done | error` +
  防抖（250ms）+ AbortController；入参 `query`，出参 `{ state, results, truncated }`。
  防抖与 abort 逻辑简单，不引库。
- **`components/SearchResults.tsx`**（新 leaf）：分组结果列表（§2 的结构），样式进
  新 `search.module.css`；`<mark>` 高亮用一个共享 class（明暗主题走 CSS 变量）。
  `WorkspaceList` 不改——左栏在两者间条件切换（`query ? <SearchResults/> : <WorkspaceList/>`），
  搜索态不卸载 `WorkspaceList` 的数据 hook，退出搜索即回原列表。
- **`NotesManager.tsx`**：顶部栏加搜索框（受控 input，本地 state：query 与焦点），
  编辑器区不动。
- 复用 `api('search', { query }, signal)`；`features/api.ts` 只需在 `ApiContract`
  上获得新方法类型，保持零运行时 import 不变。

## 6. 定位到命中行（核心机制）

### 6.1 open 扩展

`useNotesEditor.open` 加可选第三参：

```ts
open(name: string, wsId: string, loc?: { line: number; range?: { start: number; end: number } })
```

- `loc` 存在 → `setMode('edit')`（覆盖现在的 `setMode('preview')`），并在
  `readInto` 完成、`contentLoading` 置 false 后执行定位（内容就绪前 textarea 不存在）；
- 编辑器 textarea 需要 ref（现在没有）；`NotesManager.tsx` 的 textarea 从 hook 拿 ref。

### 6.2 定位算法（编辑态）

1. **client 重分行**：用**加载后的 content** 按 `\n` split 重算目标行行首偏移——
   不直接使用 host 的绝对偏移（host 行文本做了截断、EOL 已规范化，客户端重算把
   两端差异完全隔离，契约里 `ranges` 也因此是行内相对偏移）；
2. 绝对偏移 `abs = lineStart + range.start`；行号超界（笔记在搜索后被改短）→
   clamp 到最后一行、只定位不选中；
3. `textarea.setSelectionRange(abs, abs + len)` → **原生选中即高亮**，随后
   `focus()`（焦点进编辑器，用户可直接续改）；
4. 滚动：`.textarea` 是 `font: 13px/1.6` 等宽、行高固定 20.8px——
   `scrollTop = round((line - 1) × lineHeight) - clientHeight / 2`（行高从
   `getComputedStyle` 读，不硬编码 20.8），把命中行滚到视口中部；上方 padding
   （14px）计入偏移修正。

### 6.3 边界情况

- **笔记已删除 / 读失败**：走现有 read 错误路径（编辑器区显示错误，结果列表不特殊处理）；
- **内容与搜索时已不同**（他处保存过）：按 6.2-2 的 clamp 逻辑降级——行号还在就定位，
  不在就文首；不校验「行内容仍含 token」（搜索结果是快照语义，不追求强一致）；
- **dirty 切换**：与现状一致直接切换（TODO 4.1 的「切换前提醒/自动保存」落地后自然覆盖
  搜索点击这条路径，无需单独处理）；
- **写作锁**（docs/write-lock.md）：目标笔记正被记入时，现有 `writingThis` 逻辑会禁用
  编辑 tab——`loc` 定位对其退化为打开预览（`open` 里 `writing` 时保持 preview）。

### 6.4 预览态定位（v1 不做，留档）

`MarkdownText` 无源码行映射，DOM 文本游走（TreeWalker 找片段 → `scrollIntoView`）只能
best-effort（命中在链接/代码块内时文本可能被拆分）。v1 统一切编辑态定位——行号语义
只在编辑态成立；预览态定位与 TODO 3.2 TOC 共用「源码行 ↔ 渲染节点」的探索，
待 dsh 开放 heading 锚点后一并评估。

## 7. 文案（features/locales，zh 源 + en 映射）

| key | zh | en |
| --- | --- | --- |
| `search.placeholder` | 搜索全部工作区… | Search all workspaces… |
| `search.clear` | 清空搜索 | Clear search |
| `search.searching` | 搜索中… | Searching… |
| `search.noResults` | 没有匹配的笔记 | No matching notes |
| `search.error` | 搜索失败 | Search failed |
| `search.titleHit` | 标题命中 | Title match |
| `search.hits` | {count} 处命中 | {count} matches |
| `search.truncated` | 仅显示前 {count} 篇，请收窄关键词 | Showing first {count} notes only — narrow the query |

行号前缀（`L12`）不进字典（纯符号）。

## 8. 验收标准

对齐 TODO §3.1 并扩展定位要求：

1. 多工作区、多笔记下输入关键词，防抖后秒级返回按工作区分组的结果；标题与正文
   命中都在列；中英混排、大小写不敏感；
2. 命中片段中的关键词高亮（明暗主题一致）；仅标题命中的笔记带徽标；
3. 点命中行：笔记打开为**编辑态**、视口滚到该行、命中 token 处于选中态；点笔记行
   定位到第一个命中；
4. `Esc` / 清空按钮恢复原工作区列表；搜索期间编辑器与底栏 Git 区不受影响；
5. 空查询不发请求；请求被防抖/abort 合并，快速输入不闪烁旧结果；
6. 截断上限生效时有提示文案；zh/en 文案齐全（类型强制）；
7. 手动冒烟：[smoke-test.md](smoke-test.md) 补「搜索」一节。

## 9. 风险与后续

- **性能**：每请求现扫全部工作区。个人笔记量级（百篇 / 数 MB）毫秒级；若未来卡顿，
  在 host 加「启动扫描 + `fs.watch` 失效的内存索引」即可，**契约形状不变**，平滑升级。
- **后续扩展**（均不在本期）：预览态定位（§6.4，与 3.2 TOC 共用机制）；命中行定位
  能力反哺 3.2 的标题跳转；`NotePicker` 过滤复用搜索接口（明确排除在用户规划外）。
