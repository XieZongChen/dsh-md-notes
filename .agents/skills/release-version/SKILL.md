---
name: release-version
description: 发版。用户说"发版"、"发布新版本"、"要发版"时触发——执行 changelog 检查补足（需用户确认）、版本号替换（package.json 与 CHANGELOG）、build 检验、提交并 push，最后让用户手动执行 npm publish。版本号缺失时先询问用户。
---

# 发版（Release）

dsh-md-notes 的发版流程。**最后一步（npm publish）由用户手动执行**，本 skill 负责发布前的一切：changelog 检查、版本号替换、构建校验、提交与推送。

## 流程总览

1. 确认版本号（缺失则询问用户）
2. 检查 CHANGELOG 是否有 `## NEXT_VERSION` 块并补足（补足后需用户确认）
3. 替换版本号（package.json + CHANGELOG 的 NEXT_VERSION）
4. build 检验
5. 提交 + push
6. 让用户手动执行 `npm publish`

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

2. 按照 CHANGELOG 记录规则（Added / Breaking / Fixed 分类；同版本内新功能的 fix 不记；
   Fixed 只记历史版本修复），**生成一个完整的 `NEXT_VERSION` 版本草稿**（中文版）。
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
- 分类遵循记录规则：新功能 → **Added**；破坏式变更 → **Breaking**；
  对历史版本已有功能的修复 → **Fixed**；同版本内新功能的 fix **不记**。
- **条目不写操作介绍**：每条 = 功能名/一句话 + 使用文档锚点链接（如
  `docs/usage.md#4-referencing-notes-in-a-conversation`，链接精确到标题）。
  操作用法只存在于使用文档；若文档缺失该功能，**先补进文档**
  （`docs/usage.md` / `docs/usage.zh.md` 两份），再在 CHANGELOG 引用。

## 3. 版本号替换

### 3.1 CHANGELOG

```sh
npm run changelog:release -- <版本号>
```

该脚本把 `## NEXT_VERSION` 改名为 `## [<版本号>] - <本地日期>`（中英两份），
**不会**新增 NEXT_VERSION。

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

## 6. 交给用户手动发布

推送到 main 后，**告知用户手动执行发布**（本 skill 不代替执行）：

```sh
npm publish
```

并提醒：
- `prepublishOnly` 会自动再跑一次 `npm run build`
- 发布后若维护 GitHub Releases，可参考 `.release-notes/` 或 CHANGELOG 生成双语 release notes
- 发布成功后可打 git tag：`git tag v<版本号> && git push origin v<版本号>`

## 注意事项

- **版本号一致性**：package.json 与 CHANGELOG 必须一致（脚本 + 手动两步都改）。
- **NEXT_VERSION 不新增**：发版只把 NEXT_VERSION 改名；新的 NEXT_VERSION 等下次有改动时按需创建。
- **确认前置**：changelog 的补足/修改内容**先以中文版草稿交用户确认，确认后才写入文件**（写入时中英两份都要写，英文按中文合理化翻译）。
- **CHANGELOG 不写操作介绍**：功能条目 = 功能名/一句话 + 使用文档锚点链接（精确到标题）；
  操作用法只存在于使用文档（缺失先补文档再引用）。
- **用户确认点**：① 版本号（若缺失）② changelog 草稿（补充/修改）③ 发布由用户手动执行。
