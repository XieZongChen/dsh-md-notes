# 性能排查手册（docs/debug.md）

> 保存/操作变慢时的排查工具与已知结论速查。先跑探针拿数据，再按解读表定位；
> 避免从头重查已经排除过的项（见 §3 排查记录）。

## 1. 浏览器探针：插件请求时序

在 dsh 页面 **DevTools Console** 粘贴以下一行并回车，然后**点一次保存**（或复现慢的操作），
再输入 `__t` 回车查看记录：

```js
(() => { const of = window.fetch; window.__t = []; window.fetch = (...a) => { const s = performance.now(); return of(...a).then(r => { if (String(a[0]).includes('md-notes')) window.__t.push({ start: Math.round(s), dur: Math.round(performance.now()-s), url: String(a[0]).slice(0,60) }); return r; }); }; console.log('probe armed — 现在点一次保存，然后输入 __t 回车'); })()
```

记录含每次插件请求的：`start`（发出时刻，`performance.now()` 毫秒）、`dur`（总耗时）、`url`。

> 探针武装后只在本页面生效，刷新页面即失效；只记录 `md-notes` 路由的请求。

### 结果解读

| 现象 | 结论 | 下一步 |
|---|---|---|
| `write` 请求 `dur` 只有几毫秒，但 `start` 比点击时刻晚了很多 | 请求被**浏览器侧延迟发出**（不是网络/服务端） | 打开 DevTools **Network** 面板复现一次，看同期**挂着的其他请求**是什么（连接池 6 条被谁占满）；再检查 Console 是否有长任务（卡顿期间页面滚动/输入是否也卡 = 主线程阻塞） |
| `write` 请求 `dur` 达到秒级 | **服务端慢** | 看 dsh web 终端日志；用 §2 的服务端基准逐项对时 |
| 请求瞬间发出且很快，但界面仍显示保存中 | 客户端状态问题 | 反馈给插件仓库（附 `__t` 输出） |

注意：用自动化工具点击测得的「点击→请求」延迟可能是**工具自身延迟**的伪影；人工点击 +
本探针的结果才是准的。

## 2. 服务端基准单测（可直接复制）

```sh
# 1) write handler 全链路（应为个位数毫秒）
node --input-type=module -e "/* 见 git.integration.test.ts / http.test.ts，或直接跑 npm test */"
# 2) 真实 clone 的 gitStatus（3 工作区合计应在 ~1.5s 内；单独 fetch ~1.3s）
time git -C ~/.dsh/md-notes-repos/<hash> ls-remote origin HEAD
# 3) npm registry（checkUpdate 的目标）
time curl -s -o /dev/null https://registry.npmjs.org/dsh-md-notes/latest
```

## 3. 排查记录：2026-09-05「保存 10+ 秒」

现象：dsh web 启动后一段时间内保存笔记 10+ 秒，之后自愈。**已排除**（全部实测）：

| 项 | 结论 |
|---|---|
| 远端 git（github.com/XieZongChen/dsh-md-notes-test） | `ls-remote` 1.3s，无挂起 git 进程 |
| 服务端 write handler（真实笔记内容） | 4ms |
| gitStatus ×3 工作区（真实 clone + 真实笔记目录） | 合计 1.4s |
| 真实 clone gitPull（保守模式） | 1.4s，无错误 |
| dsh web 进程 | 空闲 CPU 0.3%，事件循环未被饿死 |
| 浏览器连接池（空闲时） | 仅 2 条 ESTABLISHED，未占满 |
| settings / workspaceRegistry 查表 | 均为内存操作 |
| node fetch → npmjs | 1.3s，DNS 10ms |
| 隔离实例（同源码插件 + 全新环境）页面内点击保存 | 请求 1ms 内发出 |

**顺带发现并修复的真问题**：v0.11.0「首次同步基线」升级路径缺陷——存量 clone 在标记机制
上线前已存在、无 `.git/dsh-md-notes-synced.json`，导致每次打开笔记的自动拉取走全量首同步
流程（fetch + checkout 重置 + 全量三向 + 冲突横幅）、每次推送被 `remote-changed` 全量拦截，
直到某次 pull/push 成功写入标记才自愈（与「启动后慢、过一阵好」的观感吻合）。当日已通过
一次真实 pull 补上标记。**遗留 TODO**：插件 apply 时对「clone 早于进程存在且无标记」的
存量 clone 播种标记（coding-standards §12 #19）。

根因最终未定（复现窗口消失）：下次复现时先跑 §1 探针，按解读表走。
