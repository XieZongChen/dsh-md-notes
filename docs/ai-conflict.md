# AI 解决冲突功能设计（docs/ai-conflict.md）

> Git 同步遇到冲突时，把「纯文本二选一确认」升级为「AI 语义合并」：在冲突弹窗加
> 「AI 解决」按钮，插件在冲突工作区新建一个对话，把冲突笔记的**本地版 / 远端版 / 共同基线**
> 提交给模型分析合并；AI 无法确定的合并点向用户提问；完成后 AI 调用插件注册的
> `push_notes` 工具推送远端，推送前由 dsh 原生审批面板交用户确认。Git 同步模型见
> [git.md](git.md)，写锁见 [write-lock.md](write-lock.md)。

## 1. 背景与目标

现状（git.md §2）：插件是镜像同步，冲突 = 同一笔记本地与远端**内容不同**；现有解决手段是
二选一确认弹窗（用本地覆盖 / 用远端覆盖）——用户必须自己读两边内容、人肉合并，或放弃一方。

**目标**：让 AI 承担合并工作——不是替用户选边，而是**理解两侧改动意图后把内容融合**；
融合不了的交给用户裁决；推送远端这一不可逆动作始终经用户确认。

**非目标**：自动推送（推送必须过审批面板）；`gitSync` 真 merge 冲突的 AI 解决（见 §7 后续）。

## 2. 冲突模型与三方数据

两类冲突，三方内容（base = 上次同步态 / local = 工作区 / remote = 仓库）在**检测瞬间**都在
host 手里（gitPush/gitPull 在重置 clone 前读 base）——因此在检测点**当场落盘**为 sidecar：

```
<工作区>/.dsh-notes/.conflicts/
├── <name>.base.md          # 上次同步版
├── <name>.remote.md        # 远端版
└── <name>.local-deleted    # 空标记：该文件本地已删除（local 版缺失的冲突）
```

- local 版就是 `.dsh-notes/<name>` 本身（本地删除型冲突除外，用空标记表达）。
- `.conflicts/` 是**子目录**：同步只复制顶层 `.md`、列表只扫顶层——临时文件不进 Git、
  不出现在笔记列表；位于工作区内，AI 会话的沙箱可以直接读。
- 每次写盘前清空整个 `.conflicts/`（防上一次残留）。

## 3. 交互流

1. **入口**：push 被拦截的确认弹窗（`remote-changed`）与更新冲突提示（three-way 双改）增加
   「AI 解决」按钮 + 问号 icon；hover Tooltip：「将新建一个当前工作区的对话，把冲突笔记的
   本地版/远端版/共同基线提交给 AI 分析合并；无法确定的合并点会向你提问；完成后 AI 会
   请求推送，需你确认」。
2. **点击**：关闭确认弹窗与笔记管理器 overlay → `sessions.create({ workspaceId })`（绑定冲突
   工作区，会话落进侧栏该工作区分组）→ rename「解决笔记冲突」→ `session.prompt(冲突说明)` →
   `sessions.open(id)`（定位到新对话，用户全程可见 AI 干活）。
3. **AI 合并**：按 §4 方法论把合并结果写回 `.dsh-notes/<name>.md`；判断不了的用 `ask_user`
   向用户提问。
4. **推送**：AI 调用插件注册的 `push_notes` 工具 → dsh **原生审批面板**（输入框上方，
   headline 显示人话 reason）→ 用户「允许一次」→ host 执行 gitPush；遇 `remote-changed`
   （AI 合并后本地与远端仍不同属正常——base 未变）→ 工具内**二次审批**（「远端有不同版本，
   确认覆盖？」）→ 允许后 overwrite 推送；用户拒绝则 AI 说明情况并结束。
5. **收尾**：推送成功 → host 删除该工作区 `.conflicts/`；插件订阅会话 `running→false`，
   管理器开着时刷新列表 + flash 提示（兜底——用户没看着对话也能被发现）。

## 4. 合并方法论（写入 prompt 的三级分层）

### 第一级：语义融合（AI 自主）

- **三方差量分析**：先读 `.conflicts/<name>.base.md` 与本地版、远端版，分别归纳
  「本地相对 base 改了什么、意图是什么」「远端相对 base 改了什么、意图是什么」；
- 两侧各自**新增**：全部保留，按主题归入合理位置（允许重排章节）；
- 两侧对**同一处**的矛盾修改：语义调和——事实/状态类以更新的为准并括注来源，
  观点/清单类融合双方表述；
- **删除**对撞：双方都删 → 保持删除；一方删一方留 → 以留方为准（不臆测恢复）；
- 纯格式差异：以本地版习惯为准。

### 第二级：问用户（`ask_user` 工具，dsh 原生问答卡片）

无法靠内容语义判断的实质性取舍**不擅自选边**（同一段结论被改成两种不同说法且无法判定
权威版本、删除与大幅改写对撞、涉及只有用户知道的外部事实）：把该冲突块的本地/远端摘录 +
2~3 个候选合并方案（各带一句后果说明）通过 `ask_user` **一次性**提问（同一文件的多个疑点
合并成一次），按用户答复合并。提问语言跟随界面语言。

### 第三级：收尾与推送

- 逐文件一行汇报：`<文件名>：<本地改动摘要> ⊕ <远端改动摘要> → <合并要点>`（用户可核查）；
- 全部完成后调用 `push_notes`（参数含 workspaceId）；
- 用户拒绝推送 → 总结冲突解决结果并结束（此时 `.conflicts/` **保留**，供用户手动比对）。
- 全程不得改动 `.conflicts/` 目录与其他文件。

## 5. push_notes 工具与原生审批

- 注册：host 半 `inject` 加 `'tools'`，`ctx.tools.register(defineTool({ name: 'push_notes', ... }))`
  （官方扩展点，`docs/user/develop/basic/tool.md`）；parameters：`workspaceId`(required)、
  `message`(optional commit message)；output 为 lossless JSON `{ ok, code?, error? }`。
- 审批：execute 内 `ctx.approval.request({ agent, toolName, reason })` → web 端 ui-approval
  自动在输入框上方渲染确认面板（headline = reason，按钮「拒绝 / 允许一次」）；`allowed-once`
  才继续。**没有 always-allow**——每次推送都要确认，这是有意的（推送 = 改远端）。
- 两级审批：第一级「推送笔记到远端」；push 返回 `remote-changed` 时第二级「远端有不同版本，
  确认覆盖？」→ overwrite 推送。拒绝 → 工具 throw（AI 收到 isError 结果）。
- 清理：推送成功后 host 删除该工作区 `.conflicts/`。
- 作用域：全局注册（所有会话可见），靠 description 约束用途 + 审批限流；per-agent 注册
  留后续。

## 6. 临时文件生命周期

| 时机 | 动作 |
|---|---|
| 冲突检测（gitPush/gitPull） | 清空并写入 `.conflicts/`（base/remote sidecar + local-deleted 标记） |
| AI 会话期间 | AI 只读；合并结果写回原笔记文件 |
| 推送成功（push_notes） | host 删除该工作区 `.conflicts/` |
| 用户拒绝推送 | 保留（供手动比对） |
| 下一次任何冲突写盘 | 先清空（残留兜底） |

## 7. 失败与边界

- **会话创建失败**（`SessionCreateError`）：按钮流程中止，界面显示错误 + 建议手动解决；
- **用户拒绝推送**：AI 总结结束，`.conflicts/` 保留，用户可手动推送（正常推送流程仍会
  走覆盖确认）；
- **gitSync 卡死修复（随本功能一并落地）**：`gitSync`（「合并远端并重试」）真 merge 失败时
  clone 此前会**永久卡在 MERGING**（无清理，后续 checkout 全部失败）——现在 merge 失败且
  存在 `MERGE_HEAD` 时自动 `git merge --abort`，clone 恢复可用；
- **AI 产出质量兜底**：合并结果在本地，推送前审批面板 + 推送后 Git 卡片可核对；用户不满意
  可继续在会话里要求 AI 调整（会话仍在）。

## 8. 后续（不在第一期）

- `gitSync` 真 merge 冲突（clone 内 `:1/:2/:3` 三方）的 AI 解决：AI 会话沙箱在工作区、
  改不到 DSH_HOME 下的 clone，需 host API 中转读写与 `git commit` 收尾；
- per-agent 工具作用域（仅在冲突会话注册 push_notes）；
- 冲突可视化 diff 面板（CodeMirror merge，原 TODO §2 方案）与本功能并存。

## 9. 验收标准

- push 拦截与更新冲突两处入口均可发起 AI 解决；新会话绑定冲突工作区并自动开始；
- AI 合并质量：两侧独立新增均保留、矛盾修改有语义调和、无法判断处出现 `ask_user` 问询
  且按答复落地；
- 推送必经原生审批面板；拒绝推送时远端不变、`.conflicts/` 保留；
- 推送成功后 `.conflicts/` 消失；gitSync 合并冲突后 Git 卡片不再永久报错。
