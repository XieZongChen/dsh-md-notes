---
name: release-version
description: 发版。用户说"发版"、"发布新版本"、"要发版"时触发——执行 changelog 检查补足（需用户确认）、版本号替换（package.json 与 CHANGELOG）、build 检验、提交并 push、打 tag（详情含双语变动，先英文再中文）并推送，最后让用户手动执行 npm publish。版本号缺失时先询问用户。
---

# 发版（Release）

dsh-md-notes 的发版流程。**最后一步（npm publish）由用户手动执行**，本 skill 负责发布前的一切：changelog 检查、版本号替换、构建校验、提交与推送。

## 流程总览

1. 确认版本号（缺失则询问用户）
2. 检查 CHANGELOG 是否有 `## NEXT_VERSION` 块并补足（补足后需用户确认）
3. 替换版本号（package.json + CHANGELOG 的 NEXT_VERSION）
4. build 检验
5. 提交 + push
6. 打 tag（annotated tag，详情 = 该版本双语变动，先英文再中文）+ push tag
7. 让用户手动执行 `npm publish`

## 1. 确认版本号

- 从用户的指令提取版本号（如「发版 0.4.0」→ `0.4.0`）。
- **没有版本号**：用 `ask_user_question` 询问用户，格式如 `0.x.y`。
- 校验格式：`/^\d+\.\d+\.\d+/`。

## 2. CHANGELOG 检查与补足（先确认后写入）

先检查两份 CHANGELOG 是否都有 `## NEXT_VERSION` 块：

```sh
grep -n "^## NEXT_VERSION" CHANGELOG.md CHANGELOG.zh.md
```

分两种情况处理。两种情况**都以中文版为准生成草稿**，交给用户确认；用户确认（无补充或修改）之后，才把内容写入 CHANGELOG 文件（中英均写入，英文需按中文合理化翻译）。

### 2.1 情况 A：NEXT_VERSION 完全缺失

说明上个版本到现在一直忘了写 changelog。此时：

1. 用 git 收集自上一个版本 tag 以来的所有提交：

   ```sh
   git log --oneline <上个版本tag>..HEAD
   ```

2. 按照 CHANGELOG 记录规则（分类固定为 **Breaking → Added → Fixed** 顺序；新功能 → **Added**；
   破坏式变更 → **Breaking**；对历史版本已有功能的修复 → **Fixed**；同版本内新功能的 fix 不记；
   记录时若该改动归属的分类不存在则**添加分类**，若某分类下没有任何记录则**删除分类**），
   **生成一个完整的 `NEXT_VERSION` 版本草稿**（中文版）。
3. 把草稿交给用户确认（**不写入文件**）——用 `ask_user_question` 或直接展示，询问：
   > 检测到 NEXT_VERSION 缺失，我按 CHANGELOG 规则整理了自上个版本以来的改动草稿，
   > 请确认是否有补充或修改：
   > （展示中文草稿）
4. 用户确认（没有补充或修改）后，才把该内容写入 CHANGELOG.md 和 CHANGELOG.zh.md
   （中文写入 zh，英文按中文翻译后写入 en，均放在顶部 `## NEXT_VERSION` 块下）。

### 2.2 情况 B：NEXT_VERSION 已存在

说明部分改动已记录。此时：

1. 用 git 收集自上一个版本 tag 以来的所有提交：

   ```sh
   git log --oneline <上个版本tag>..HEAD
   ```

2. 按照 CHANGELOG 记录规则，与现有 `NEXT_VERSION` 块下已写的内容**比对**：
   - 找出已写内容中**缺失的改动**（补足）；
   - 找出已写内容中**与提交不符的**（修正，如把同版本内 fix 误记为 Fixed 的移出）；
   - 保持已正确记录的内容不变。
3. 形成**修改/补足后的 NEXT_VERSION 草稿**（中文版），交给用户确认（**不写入文件**）：
   > 我比对了自上个版本以来的改动与现有 NEXT_VERSION，做了以下补足/修正，
   > 请确认是否有补充或修改：
   > （展示中文草稿，必要时列出与现有内容的差异点）
4. 用户确认（没有补充或修改）后，才把最终内容写入 CHANGELOG.md 和 CHANGELOG.zh.md
   （中文写入 zh，英文按中文翻译后写入 en）。

### 2.3 收集改动的归类要点

- 用 `git log --oneline <上个版本tag>..HEAD` 看提交，对照 CHANGELOG 现有内容找出
  **尚未记录**的功能性改动（非文档/重构/构建）。
- 分类遵循记录规则：固定为 **Breaking → Added → Fixed** 顺序；新功能 → **Added**；
  破坏式变更 → **Breaking**；对历史版本已有功能的修复 → **Fixed**；同版本内新功能的 fix **不记**；
  记录时若该改动归属的分类不存在则**添加分类**，若某分类下没有任何记录则**删除分类**。
- **条目不写操作介绍**：每条 = 功能名/一句话 + 使用文档锚点链接（如
  `docs/usage.md#4-referencing-notes-in-a-conversation`，链接精确到标题）。
  操作用法只存在于使用文档；若文档缺失该功能，**先补进文档**
  （`docs/usage.md` / `docs/usage.zh.md` 两份），再在 CHANGELOG 引用。

## 3. 版本号替换

### 3.1 CHANGELOG

```sh
npm run changelog:release -- <版本号>
```

该脚本只把 `## NEXT_VERSION` 标题行改名为 `## [<版本号>] - <本地日期>`（中英两份），
**保留**其下的分类标题（如 `### Added`），**不会**新增 NEXT_VERSION。

验证：

```sh
grep -n "^## \[" CHANGELOG.md CHANGELOG.zh.md | head -3
```

### 3.2 package.json

```sh
# 把 "version" 改为目标版本号
python3 - <<'EOF'
import json, io
p = 'package.json'
d = json.load(io.open(p, encoding='utf-8'))
d['version'] = '<版本号>'
io.open(p, 'w', encoding='utf-8').write(json.dumps(d, indent=2, ensure_ascii=False) + '\n')
EOF
```

验证：`grep '"version"' package.json`

## 4. build 检验

```sh
npm run build
```

必须成功（exit 0）。若有类型错误或构建失败，修复后再继续。

## 5. 提交 + push

```sh
git add package.json CHANGELOG.md CHANGELOG.zh.md
git commit -m "chore: 发布 v<版本号> — CHANGELOG 定版、package.json 版本号更新"
git push
```

## 6. 打 tag（含双语变动详情）

提交 + push 之后，**打 annotated tag 并推送**。tag 详情写入本次版本的变动摘要，
**格式为：先英文、再中文**（内容来自刚定版的 CHANGELOG）。

1. 从两份 CHANGELOG 提取本次版本的块内容（`## [<版本号>]` 到下一个 `## [` 之前）：

   ```sh
   # 英文块（CHANGELOG.md）
   awk '/^## \[<版本号>\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md
   # 中文块（CHANGELOG.zh.md）
   awk '/^## \[<版本号>\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.zh.md
   ```

2. 组装 tag message：首行 `v<版本号>`，空行后放**英文块**，再空行、`---` 分隔线、
   空行后放**中文块**（分类标题如 `### Added` / `### Fixed` 保留，使用文档链接可保留）。

3. 创建并推送 tag（用 `-a` annotated tag 承载多行详情；`-F` 从文件读入，避免引号转义问题）：

   ```sh
   # 把组装好的内容写入临时文件 /tmp/tag-msg-<版本号>.txt，然后：
   git tag -a v<版本号> -F /tmp/tag-msg-<版本号>.txt
   git push origin v<版本号>
   ```

   tag 指向当前 HEAD（即刚提交的发版 commit）。若 tag 已存在（如重复发版），
   先确认目标后删除重建：`git tag -d v<版本号> && git push origin :v<版本号>`。

4. 验证：

   ```sh
   git tag -l "v<版本号>" && git show v<版本号> --no-patch
   git ls-remote --tags origin | grep "v<版本号>"
   ```

## 7. 交给用户手动发布

推送到 main 并打好 tag 后，**告知用户手动执行发布**（本 skill 不代替执行）：

```sh
npm publish
```

并提醒：
- `prepublishOnly` 会自动再跑一次 `npm run build`
- tag 已由流程打好并推送（`v<版本号>`，含双语变动详情）；发布成功后可基于该 tag
  维护 GitHub Releases（参考 `.release-notes/` 或 CHANGELOG 生成双语 release notes）

## 注意事项

- **版本号一致性**：package.json 与 CHANGELOG 必须一致（脚本 + 手动两步都改）。
- **NEXT_VERSION 不新增**：发版只把 NEXT_VERSION 改名；新的 NEXT_VERSION 等下次有改动时按需创建。
- **确认前置**：changelog 的补足/修改内容**先以中文版草稿交用户确认，确认后才写入文件**（写入时中英两份都要写，英文按中文合理化翻译）。
- **CHANGELOG 不写操作介绍**：功能条目 = 功能名/一句话 + 使用文档锚点链接（精确到标题）；
  操作用法只存在于使用文档（缺失先补文档再引用）。
- **用户确认点**：① 版本号（若缺失）② changelog 草稿（补充/修改）③ 发布由用户手动执行。
- **tag 在流程内打**：提交 + push 后立即打 annotated tag 并推送（详情先英文再中文，
  取自 CHANGELOG 该版本块）；不需要用户等 publish 完成再手动打。tag 打在发版 commit 上。
