# 贡献指南（Contributing）

> 中文 · [English](CONTRIBUTING.md)

欢迎为 **dsh-md-notes** 贡献代码、文档或建议。设计文档见 [docs/](docs/)。

## 开发环境

- **Node.js** 与 npm（项目用 npm 脚本构建）。
- **deepseek-harness checkout**：类型链接（`npm run link-deps`）指向本机
  `deepseek-harness` 仓库的构建产物；默认路径为脚本目录上两级目录下的
  `deepseek-harness`，可用环境变量 `DSH_CHECKOUT` 覆盖。

## 快速开始

```sh
npm install --legacy-peer-deps   # 首次或依赖变化后（跳过 @deepseek-ai/* peer 解析）
npm run link-deps                # 链接 deepseek-harness checkout 的类型（改代码前）
npm run build                    # 构建 lib/index.js + lib/client.js
```

改完代码、构建成功后，**重启 dsh web** 生效（bundle 层与 client 包元数据缓存在进程内）。

## 常用脚本

| 命令 | 作用 |
|---|---|
| `npm run build` | 完整构建（tsc host → tsc client → tsdown） |
| `npm run typecheck` | 仅类型检查（两个 program） |
| `npm run link-deps` | 重链 `@deepseek-ai/*` 类型到 checkout |
| `npm run bundle` | 仅构建 client bundle |

## 代码约定

- **双 tsc program**：host（`src/`，排除 `src/client`）与 client（`src/client/`）
  分开编译，避免 `Context.sessions` 类型冲突。
- **i18n**：所有 UI 文案走 `src/client/features/locales/`（`zh.ts` 为源字典、
  `en.ts` 映射类型强制同键）；host 不返回面向用户的本地化文案（返回错误码 + 英文 detail）。
- **HMR 安全**：副作用（路由注册、slot 注册、`@` source 注册、事件监听）包在
  `ctx.effect(..., label)` 内，卸载自动清理。
- **渲染安全**：笔记预览用 dsh 的 `MarkdownText`（XSS 安全内置），不引入原始 HTML 透传；
  不注入影响核心 composer 的全局样式。
- **CHANGELOG**：用户可见功能改动记录在 `CHANGELOG.md` / `CHANGELOG.zh.md`
  （未发布内容放 `## NEXT_VERSION`；规则见文件头部）。
- **文档同步**：功能改动同步更新 `docs/` 与 `README.md` / `README.zh.md`
  （用户可见功能在 `docs/usage.md` / `docs/usage.zh.md` 有操作说明）。

## 提交与 PR

1. 先开 **issue** 讨论方案，再实现。
2. 在分支上完成改动：代码 + 测试（如有）+ 文档 + CHANGELOG。
3. 提交信息用中文描述改动（参考 `git log` 历史风格）。
4. 提 PR 并关联 issue；CI（如有）通过后等待 review。

## 设计文档

[docs/features.md](docs/features.md)（功能）· [docs/architecture.md](docs/architecture.md)
（架构）· [docs/context.md](docs/context.md)（@ 引用与注入）· [docs/TODO.md](docs/TODO.md)（路线规划）
