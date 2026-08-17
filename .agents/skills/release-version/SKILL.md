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

## 2. CHANGELOG 检查与补足（需用户确认）

### 2.1 检查 NEXT_VERSION 是否存在

```sh
grep -n "^## NEXT_VERSION" CHANGELOG.md CHANGELOG.zh.md
```

- 若两份都存在且块内有内容 → 跳到第 3 步。
- 若不存在 → **不要自动添加**：先收集「自上次发版以来的未记录改动」，
  与用户确认哪些应记入 changelog，再创建 `## NEXT_VERSION` 块并写入。

### 2.2 收集未记录改动

用 git 查看自上一个版本 tag 以来的提交，归类为 Added / Breaking / Fixed：

```sh
git log --oneline <上个版本tag>..HEAD
```

对照 CHANGELOG 现有内容，找出**尚未记录**的功能性改动（非文档/重构）。

### 2.3 写入并请用户确认

在 `## NEXT_VERSION` 块下按 `### Added` / `### Breaking` / `### Fixed` 归类写入
（遵守 CHANGELOG 记录规则：同版本内新功能的 fix 不记；Fixed 只记历史版本修复）。
写入后**必须请用户确认**内容无误再继续——例如：
> CHANGELOG 已补足 NEXT_VERSION，请确认以下改动记录是否正确：…

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
- **用户确认点**：① 版本号（若缺失）② changelog 补足内容 ③ 发布由用户手动执行。
