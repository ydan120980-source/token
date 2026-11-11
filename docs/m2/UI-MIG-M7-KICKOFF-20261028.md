# M7（用量页）开工指令（交 Codex） · 2026-10-28

**状态**：Claude 写。M8 已审核通过并合入 main（`b594692`）。所有者 2026-10-28 要求：Claude 的界面改动完成后，由 Codex 做 M7。本文件补充并部分取代 `UI-MIG-M7-M8-KICKOFF-20261027.md`。那份文件里没被下面改动的条款（第 3、4、6、7、8、9 节）照旧有效。

## 1. 开始条件

- 从**合入 `ui/design-palette-summary` 之后的本地 main** 新开分支 `ui/mig-m7`。合入提交以 main 当时的记录为准。
- 先读：
  - `UI-PALETTE-QUOTA-SUMMARY-PROPOSAL-20261027.md` 第 1、2 节和实施进度；
  - `UI-WIDGETS-20261028.md`；
  - `UI-HOME-20261028.md`；
  - 本文件。
- 这些是现在的设计系统：C 配色、Apple 式卡片、小组件栏、不放说明性小字。

## 2. 与 2026-10-27 开工指令不同的地方

**所有者补充（2026-10-28，开工后）**：以旧用量页的布局和主要功能UI为对标，尽量还原；motion用当前标准库。确需加入kit的能力，先给截图直接请所有者裁决。不得引入用量页参考模式、专用参考样式或kit页面判断。完整原话与执行口径见`UI-MIG-M7-OWNER-RULING-20261028.md`；下表冲突处以该补充为准。

**随后补充**：所有者允许Codex检索Apple设计思路，在M7内结合新版外观与旧版功能布局；并明确趋势提示卡、热力图和时段格提示按其分支`ui/shell-cost-ref`的`UI-HOVER-20261028.md`第5节保留旧版，内容用`TipCard`。该记录a7cb1e3尚未合入main，已在所有者工作区读完；优先于此前“不用悬停卡片/指针处最多胶囊”的要求。限定接入缺口及截图见`UI-MIG-M7-TIPCARD-INTEGRATION-GAP-20261028.md`。

| 项 | 现在的要求 |
|---|---|
| 外观标准 | 统一到 kit 和现在的 token，**不做 1:1 还原**。费用页的参考模式（`CostReferenceProvider`、`cost-reference.css`、kit 里的参考分支）只属于费用页，M7 不能使用，也不能新增同类分支。不能按 `aria-label` 文案选择样式。 |
| 卡片和底色 | 页面是浅灰面板，卡片用 kit `Card`：白底、`shadow-card` 柔和阴影、圆角 16，不加细线。不在页面里另写背景色或边框。 |
| 颜色 | Agent 用 `agent:<id>`，Token 类型用蓝阶 `category:*`（已是 C 配色），走势线用墨色。颜色只表示是哪个 Agent，不表示好坏。 |
| 说明文字 | 不放副标题、分区说明、行说明、提示语和免责说明；保留标题、数值、状态、空状态、错误，以及防止数据填错的必要提示。旧页面上的“点一天看它的 24 小时”这类提示不要搬过来。 |
| 摘要栏 | **取消**。不做 `usage-summary` 岛，也不新增 `SummarySection`。所有页面共用一个小组件栏。 |
| 小组件栏 | 窗口宽 ≥ 1360 时停靠在右侧，页面变窄。用量页要在两种状态下排版都正常：停靠时按 1440 检查，不停靠时按 1180 检查。 |
| 图表 | 用 kit 的默认图表：`LineChart`、`BarChart`、`Heatmap`。趋势、热力图、时段格的旧提示按`UI-HOVER-20261028.md`第5节保留，内容用TipCard，窗口共用一层并有键盘等价。motion用当前标准库及data档。 |
| 旧依赖 | 迁完后检索 Chart.js（`assets/vendor/chart.umd.min.js`）和 `date-range.js`。没有使用者就删除，同时核对 `audit:runtime`、`package.json` `build.files` 和 `serve.js` 白名单。 |

## 3. 门槛

- **所有者补充（2026-10-28）**：日志验收改为“日志非空且有结果输出”，原“不足10秒不算通过”的耗时规则作废。通过仍须真实执行、退出码0且断言成立；保留实际命令、退出码、耗时和结果，不补sleep或制造负载。
- 基线从开工时的 main 拍：1180×850 和 1440×900，浅色和深色，全部页面。
- 未改的页面（概览、费用、会话、来源、设置）必须原样通过像素门槛。用量页只出前后对照图，差异逐项写进页面记录。
- 套件（源码模式，合成数据，独立的 usage/quota 目录）：
  - 用量相关：`usage`、`activity`、`agent-recovery`、`statistics-worker`、`layout`、`detail`、`style-alignment`，以及 `visual`、`motion`、`render-performance`、`widgets`、`polish`；
  - 全量：`npm run verify`、`npm run audit:runtime`，以及按模板写的用量页冒烟测试。
- 已知与 M7 无关的失败：`interaction-reliability` 的费用部分（旧选择器）、`quota-identity`（main 上同样失败）。已另开任务，记录里照实写“未修改”。

## 4. 写法和停止点

- 一个 JSX 元素一行，一行不超过约 140 字符；页面只组合 kit 组件。
- 需要扩展 kit、新增 token 或设计检查例外时，按计划 9.4 停下来提问。
- 写 `docs/m2/UI-MIG-M7-<日期>.md` 后停止，等 Claude 审核。不合 main、不推送、不打包，不读真实来源或账号。
