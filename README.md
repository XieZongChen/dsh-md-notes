<p align="center">
  <img src="assets/dsh-md-notes.png" width="96" alt="dsh-md-notes" />
</p>

<h1 align="center">dsh-md-notes</h1>

<p align="center">
  DSH 第三方插件（bundle）：<b>MD 笔记管理</b>
  <br />
  <a href="docs/features.md">功能设计</a> · <a href="docs/architecture.md">架构设计</a> · <a href="CHANGELOG.md">变更记录</a>
</p>

---

## 功能

- **侧边栏笔记入口** → 笔记管理界面（列表 + 编辑/预览）
- **回答操作栏**（复制按钮旁）→ 把该段对话记入指定笔记
- 笔记以普通 `.md` 文件存储，可直接在文件系统编辑

## 安装

前置：已安装 `dsh` CLI，目标 profile 为 `web`。

```sh
# 从插件工程目录的上一级执行（或使用绝对路径）
dsh plugin --profile web add /Users/xiezongchen/space/deepseek/dsh-work/dsh-md-notes
```

然后**重启 dsh web**（bundle 层与 client 包元数据在进程内缓存，必须重启才生效）。

卸载：

```sh
dsh plugin --profile web remove dsh-md-notes
```

## 使用

1. **打开笔记管理**：点击侧边栏底部（设置上方）的笔记入口。
   - 左侧：笔记列表（标题 + 更新时间）；顶部输入标题后点「新建」（留空自动用"未命名笔记 日期"）；
   - 右侧：选中笔记后，在 **编辑 / 预览** 两个 Tab 间切换，点「保存」写入；列表项 🗑 删除。
2. **记入笔记**：在某条回答下方的操作行点笔记图标，弹窗里选择目标笔记（或现场新建），
   点「写入笔记」——该回答及对应的用户提问会被追加到笔记末尾（带时间戳分段）。

笔记文件存放在本机配置的目录（当前为 `dsh-work/.dsh-notes/`），随时可以直接用任意编辑器打开修改。

## 维护

```sh
npm install --legacy-peer-deps   # 首次或依赖变化后
npm run link-deps                # 链接 deepseek-harness checkout 类型（改代码前）
npm run build                    # 构建 lib/index.js + lib/client.js
```

改完代码、构建成功后，重启 dsh web 生效。

常用脚本：

| 命令 | 作用 |
|---|---|
| `npm run build` | 完整构建（tsc host → tsc client → tsdown） |
| `npm run typecheck` | 仅类型检查（两个 program） |
| `npm run link-deps` | 重链 `@deepseek-ai/*` 类型到 checkout |
| `npm run bundle` | 仅构建 client bundle |

配置说明（笔记目录、API 路由）与实现细节见 [docs/architecture.md](docs/architecture.md)。
