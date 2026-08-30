# dsh ↔ 插件版本适配对照表（Compatibility Matrix）

> 本文档是中英双语版本（bilingual）：表格为唯一数据源，行/单元格同时给出中文与英文。
> 维护方式见文末「如何更新本表」；每次 dsh 兼容性校验后由
> `.agents/skills/dsh-compat-check/` 流程更新。

**背景 / Background**：dsh 仍处于快速原型迭代阶段，**不做向下兼容**（no backward
compatibility）——固定 dsh 版本只适配固定插件版本。升级 dsh 或插件后必须重新校验
（`dsh 兼容性校验`），并把已验证组合记入下表。

---

## 一、主表：插件版本 → dsh 版本（Main table: plugin → dsh）

> 最新在前（newest first）。每一行 = 一次「已验证」的适配组合。
> 「验证日期」为该组合最后一次验证的日期（取自对应兼容性校验提交）。

| 插件版本<br>Plugin version | dsh 版本<br>dsh version | 验证日期<br>Verified on | 备注<br>Notes |
|---|---|---|---|
| `0.9.0` | `0.1.2-alpha.1` | 2026-08-29 | 当前最新 / Current latest |
| `0.8.0` | `0.1.2-alpha.1` | 2026-08-29 | 0.8.0 亦在 `0.1.1-rc.2` 验证过（2026-08-25）<br>0.8.0 also verified on `0.1.1-rc.2` (2026-08-25) |
| `0.7.1` | `0.1.1-rc.2` | 2026-08-25 | — |
| `0.6.0` | `0.1.1-rc.2` | 2026-08-22 | 0.6.0 亦在 `0.1.0-rc.8` 验证过（2026-08-20）<br>0.6.0 also verified on `0.1.0-rc.8` (2026-08-20) |
| `0.6.0` | `0.1.0-rc.8` | 2026-08-20 | — |
| `0.5.0` | `0.1.0-rc.7` | 2026-08-19 | — |
| `0.4.0` | `0.1.0-rc.7` | 2026-08-18 | — |
| `0.3.0` | `0.1.0-rc.7` | 2026-08-17 | 插件依赖的契约自 `0.1.0-rc.5` 起未变<br>plugin contracts unchanged since `0.1.0-rc.5` |

---

## 二、反查表：dsh 版本 → 已验证插件版本（Reverse table: dsh → plugin）

> 升级 dsh 前先查此表：找到目标 dsh 版本对应列出的插件版本，从中选**最新**的已验证版本；
> 若目标 dsh 版本不在表中，说明该 dsh 尚未校验过，需先跑 `dsh 兼容性校验`。

| dsh 版本<br>dsh version | 已验证插件版本（新→旧）<br>Verified plugin versions (newest → oldest) | 最近验证<br>Last verified |
|---|---|---|
| `0.1.2-alpha.1` | `0.9.0`、`0.8.0` | 2026-08-29 |
| `0.1.1-rc.2` | `0.8.0`、`0.7.1`、`0.6.0` | 2026-08-25 |
| `0.1.0-rc.8` | `0.6.0` | 2026-08-20 |
| `0.1.0-rc.7` | `0.5.0`、`0.4.0`、`0.3.0` | 2026-08-19 |

---

## 三、适配原则（Principles）

- **固定组合（pin）**：插件不绑定具体 mainline commit；需要固定 dsh + 插件组合时，
  安装时固定插件版本即可——`dsh plugin --profile web add dsh-md-notes@<版本>`。
  运行时依赖（`@deepseek-ai/*`、`react`）以可选 peer 依赖声明，从 dsh 安装中解析。
- **只记已验证（verified only）**：表中只记录**已通过兼容性校验**的组合。dsh 发版后
  尚未适配/未验证的版本**不写入表格**，而是以兼容 todo 记录在
  [docs/TODO.md](TODO.md) 顶部（`## dsh 兼容性（…）`），适配并通过冒烟后再入表。
- **版本对应（version coupling）**：dsh 不做向下兼容 ⇒ 不要用「旧插件 + 新 dsh」或
  「新插件 + 旧 dsh」的任意组合；先查本表，再固定安装。

## 四、如何更新本表（How to update）

每次 dsh 兼容性校验（无影响分支）后：

1. 主表顶部追加一行：`<插件版本> | <dsh 版本> | <验证日期> | <备注（中英）>`；
2. 同步更新反查表（目标 dsh 版本行的插件版本列表）；
3. 更新 README（`README.zh.md` / `README.md`）兼容性章节——只保留**最新三个插件版本**
   的对应表格；
4. 完整流程见 `.agents/skills/dsh-compat-check/SKILL.md`。
