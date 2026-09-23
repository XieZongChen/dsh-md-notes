# 记忆能力评测（能否提升 dsh 问答效果）

> 目的：**用数据决定这个插件的定位**，而不是靠辩论或情绪。
> 背景与设计见 [memory.md](memory.md)。工具：`scripts/memory-eval.mjs`。

## 假设

- **H1**：让 agent 自己查笔记（`agentTools: 'write'`，含每会话一条发现通知）能让「答案只存在于
  笔记里」的问题**答对更多**。
- **H0**：答对率没有差别——那么它在「提升问答」这根轴上就是伪需求，应当降级为文档管理器
  （`agentTools: 'off'`）或归档，而不是继续加功能。

## 为什么这个实验能分辨

fixture 的工作区里，**代码与 README 不含任何被问事实**，事实只在 `.dsh-notes/` 里；而每条
事实都是**任意的、猜不出来的**（发布窗口是周二 14:00、测试库端口 55432、禁用 left-pad…）。
所以对照组（无工具）只有两种可能：**猜/编**，或**承认不知道**。两种都记为 miss；treatment
答对则只能来自真的查了笔记。

## 步骤

```sh
node scripts/memory-eval.mjs prepare            # 默认写到 ~/dsh-notes-eval-workspace
# 或：npm run memory-eval -- prepare
```

1. 把这个目录**注册成一个 dsh 工作区**。
2. 把 `answers/README.md` 里的 **CONTROL patch**（`agentTools: 'off'`）贴进 profile 补丁，
   **重启 dsh web**。
3. 在该工作区里**新开一个会话**，依次发 6 个问题（**不要用 `@`**），把助手回答原样存成
   `answers/control/1.txt` … `6.txt`。
4. 换成 **TREATMENT patch**（`agentTools: 'write'`），重启，重复一遍存到
   `answers/treatment/`。
5. ```sh
   node scripts/memory-eval.mjs score ~/dsh-notes-eval-workspace
   ```

## 判决线（**看数之前先定好，看到数之后不许改**）

| 结果 | 判定 | 行动 |
|---|---|---|
| treatment ≥ 5/6 且 delta ≥ +4 | `adopt` | 这条路线有效，继续投入（下一步：curation/provenance，见 memory.md §4） |
| delta ≤ +1 | `pseudo-need` | 它在「提升问答」上不成立：**停止加功能**，降级为文档管理器或归档 |
| 其它 | `inconclusive` | 读 transcript 再定：token 未命中可能是措辞差异而非答错 |

`score` 会直接打印判定。判定阈值写在 `scripts/memory-eval.mjs` 里（`scoreArms`），
`--self-test` 校验这套阈值本身。

## 还要记录的一件事：它**自己**去查了吗

delta 也可能来自「模型看到通知后更愿意说不知道」（更谨慎）而不是「真的查到了」。所以同时人肉看一遍
treatment 的 6 段回答，记录：

- 有几条**真的调用了** `note_search` / `note_read`（GUI 里能看到工具调用）；
- 有几条是**没查就答对**（那说明事实可猜，fixture 有问题，换一条事实重跑）；
- 有几条**查了却没查到**（工具/描述有问题，这才是要修的东西）。

这三项比总分更有指导性：**工具调用率低 = 发现机制不够；调用率高但没查到 = 工具本身要改。**

## 可选第三臂（想分离「读」与「写」的影响）

用 `agentTools: 'read'` 再跑一遍。预期与 `write` 几乎相同——`note_write` 不参与「答得更准」，
它影响的是**跨会话**效果（本次评测测不到，需要第二次会话复问同一事实）。若想测写入的长期收益，
在 treatment 会话里让模型记一条新事实，**再新开一个会话**问它是否记得。

## 已知局限（结论别超出这些）

- 6 题样本很小：只看**方向**，不要当成精确的准确率。
- 单一模型/单一语言（中文提问）。换模型可能改变工具调用倾向。
- fixture 是我们刚写的干净小库；真实笔记库更大、更杂、有陈旧内容，检索难度更高。
- token 命中会漏掉正确但措辞不同的回答——所以判决线给了 `inconclusive` 并让人读原文。
- 对照组也可能**编造**出正确答案（碰巧猜中）：这正是要看 transcript 而不是只看分数的原因。

## 结果

> 跑完把表贴在这里（含日期、dsh 与模型版本）。空着不填比填假的强。

| 日期 | 模型 | control | treatment | delta | 判定 | 工具调用条数 | 备注 |
|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |
