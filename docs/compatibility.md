# dsh ↔ Plugin Version Compatibility Matrix

> [中文](compatibility.zh.md) · English

dsh is still in rapid prototype iteration and provides **no backward compatibility** — a
fixed dsh version only matches fixed plugin versions. After upgrading dsh or the plugin you
must re-run the compatibility check (`dsh 兼容性校验`) and record the verified combination
in the tables below.

---

## 1. Main table: plugin version → dsh version

> Newest first. Each row = one **verified** combination.
> "Verified on" is the date of the last verification for that combination (taken from the
> corresponding compatibility-check commit).

| Plugin version | dsh version | Verified on | Notes |
|---|---|---|---|
| `0.10.0` | `0.1.2-alpha.5` | 2026-09-02 | Current latest |
| `0.10.0` | `0.1.2-alpha.4` | 2026-09-02 | — |
| `0.10.0` | `0.1.2-alpha.3` | 2026-09-01 | — |
| `0.10.0` | `0.1.2-alpha.2` | 2026-09-01 | 0.10.0 adapted alpha.2 (`settingsNamespace` migration) |
| `0.9.0` | `0.1.2-alpha.1` | 2026-08-29 | — |
| `0.8.0` | `0.1.2-alpha.1` | 2026-08-29 | 0.8.0 was also verified on `0.1.1-rc.2` (2026-08-25) |
| `0.7.1` | `0.1.1-rc.2` | 2026-08-25 | — |
| `0.6.0` | `0.1.1-rc.2` | 2026-08-22 | 0.6.0 was also verified on `0.1.0-rc.8` (2026-08-20) |
| `0.6.0` | `0.1.0-rc.8` | 2026-08-20 | — |
| `0.5.0` | `0.1.0-rc.7` | 2026-08-19 | — |
| `0.4.0` | `0.1.0-rc.7` | 2026-08-18 | — |
| `0.3.0` | `0.1.0-rc.7` | 2026-08-17 | Plugin contracts unchanged since `0.1.0-rc.5` |

## 2. Reverse table: dsh version → verified plugin versions

> Check this table before upgrading dsh: find the target dsh version and pick the **newest**
> verified plugin version listed for it. If the target dsh version is not listed, it has not
> been checked yet — run the compatibility check first.

| dsh version | Verified plugin versions (newest → oldest) | Last verified |
|---|---|---|
| `0.1.2-alpha.5` | `0.10.0` | 2026-09-02 |
| `0.1.2-alpha.4` | `0.10.0` | 2026-09-02 |
| `0.1.2-alpha.3` | `0.10.0` | 2026-09-01 |
| `0.1.2-alpha.2` | `0.10.0` | 2026-09-01 |
| `0.1.2-alpha.1` | `0.9.0`, `0.8.0` | 2026-08-29 |
| `0.1.1-rc.2` | `0.8.0`, `0.7.1`, `0.6.0` | 2026-08-25 |
| `0.1.0-rc.8` | `0.6.0` | 2026-08-20 |
| `0.1.0-rc.7` | `0.5.0`, `0.4.0`, `0.3.0` | 2026-08-19 |

## 3. Principles

- **Pin the combination**: the plugin is not bound to a specific mainline commit; to pin a
  fixed dsh + plugin combo, pin the plugin version at install time —
  `dsh plugin --profile web add dsh-md-notes@<version>`. Runtime dependencies
  (`@deepseek-ai/*`, `react`) are declared as optional peer dependencies and resolve from the
  dsh installation.
- **Verified only**: the tables record only combinations that **passed the compatibility
  check**. dsh versions that are not yet adapted/verified are **not** written into the
  tables — they are tracked as compatibility TODOs at the top of
  [docs/TODO.md](TODO.md) (`## dsh 兼容性（…）`) and enter the tables only after the
  adaptation passes smoke tests.
- **Version coupling**: dsh has no backward compatibility — don't use arbitrary
  "old plugin + new dsh" or "new plugin + old dsh" combos; check the tables first, then pin.

## 4. How to update

After every compatibility check (no-impact branch):

1. Append a row at the top of the main table:
   `<plugin version> | <dsh version> | <verified date> | <notes>`;
2. Update the reverse-table row of the target dsh version (plugin version list);
3. Update the README compatibility section ([README.md](../README.md)) — keep only the
   **latest three plugin versions** table;
4. Full procedure: `.agents/skills/dsh-compat-check/SKILL.md`.
