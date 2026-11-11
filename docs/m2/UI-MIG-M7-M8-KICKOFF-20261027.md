# M8、M7 开工指令（交 Codex） · 2026-10-27

**状态**：Claude 写。所有者 2026-10-27 决定 M8（费用）、M7（用量）仍由 Codex 实现，并当日更正：**先 M8 后 M7**，迁移目标不再是逐像素还原旧版，而是统一到模板库、模板库没有的照费用页（`UI-UNIFY-COST-REFERENCE-20261027.md`）。本记录替代 `UI-MIGRATION-PLAN-20261025.md` 第 9 节和 `UI-MIG-M4-M8-RULINGS-20261025.md` 第 1、6 节中关于 M7、M8 的开始条件、顺序、分支和交付方式；与本记录冲突时以本记录为准，其余裁决照旧。

## 1. 先确认的事实

| 项 | 现状 |
|---|---|
| M4 来源、M5 会话 | 渲染层审核未通过（版式与旧版不一致，见 Claude 2026-10-26 审核）。提交留在 `ui/mig-m4-m8`，**没有合入 main，也不要带进新分支**。main 上这两页仍是旧版渲染。重做尚未安排。 |
| M6 额度 | 由 Claude 接手，已合入，是**过渡版本**：数据层沿用你提取的 `quota-model.js` / `quota-host.js` 和 `tests/m1/quota-models.test.js`；页面在 `ui/src/pages/quota/`，账号卡片保留旧渲染（`quota-card-grid.js`）。额度页**不是**版式参照，也不要改它。**你停止 M6**：`token-worktrees/ui-mig-m4-m8` 里未提交的 M6 改动不要提交、不要合入，也不要删除，留给所有者处理。 |
| MK-a、MK-b、两个动效修复 | 已由 Claude 原样移入 main，kit 不需要再搬。 |
| 外框 | 新外框（圆角面板、摘要弹出卡）已在 main。费用、用量页套在面板里，几何以 `UI-LAYOUT-SPEC-20261027.md` 为准。 |
| 数据动效 | `ui/src/design/motion.ts` 的数据档已改为费用页的值（入场 0.8s、变化 0.5s、错开 0.04s 上限 0.4s、`data.follow`）。kit 图表跟着变，不要在页面里另写数值。 |

## 2. 开始条件

本地 main 同时包含下面几项才开始实现；缺任何一项只读文档、不写代码：
- `scripts/m1/ui-pixel-gate.js`（逐像素对照工具）；
- `docs/m2/UI-UNIFY-COST-REFERENCE-20261027.md`、`docs/m2/UI-LAYOUT-SPEC-20261027.md`、`docs/m2/UI-LAYOUT-GATE-20261027.md`；
- `design/desktop-reference/quota-card-grid.js`、`docs/m2/UI-QUOTA-PAGE-20261027.md` 和本记录（说明 `ui/quota-shell` 已合入）。

## 3. 分支

- 从当时的本地 main 新建 `ui/mig-m7-m8`，worktree 放在 `token-worktrees/ui-mig-m7-m8`。node_modules 用 junction 的，删 worktree 前先删 junction。
- 不从 `ui/mig-m4-m8` cherry-pick 任何提交（包括 `609d948 Windows-job`）。
- 提交以 `M8:`、`M7:` 开头，两页不混在一个提交里。不合 main、不推送、不打包。

## 4. 必读（按顺序）

1. `UI-UNIFY-COST-REFERENCE-20261027.md`：迁移目标、依据的优先顺序、向费用页对齐的具体项、摘要栏。**与下面各文件冲突时以它为准。**
2. `UI-SPEC-20261025.md`：颜色、文字、控件、动效、数据显示、悬停和读数（第 7 节已按更正改写）。
3. `UI-LAYOUT-SPEC-20261027.md`：外框和页面几何，摘要栏的接入方式（第 1 节）。
4. `UI-LAYOUT-GATE-20261027.md`：两种用途——本步不改的页面逐像素通过；迁移的页面只出前后对照图交审。
5. `UI-MIG-M4-M8-RULINGS-20261025.md`：G1–G5、G6 第三条起、第 5 节 M7、M8 部分（Q3 的 chip 改为 Agent 图标条），以及 MK-b 的补充裁决（`UI-MIG-MK-b-SUPPLEMENT-RULING-20261026.md`、`UI-MIG-CHARTLEGEND-RULING-20261026.md`、`UI-MIG-STEPCHART-RULING-20261026.md`）。
6. `UI-MIG-M8-INVENTORY-20261025.md`、`UI-MIG-M7-INVENTORY-20261025.md`：行号基于 `4f77437`，开始前按当时的 main 逐条复核，变化的写进页面记录。
7. 写法示范：`ui/src/pages/settings/`（M3）。Host 在旧侧（`window.<page>Host`），页面注册 `window.<page>Ui`，纯计算提成 UMD 并配测试。`ui/src/pages/quota/` 只看接口写法（Host、岛、Sheet），不参照它的版式。

## 5. 外观要求

**M8 费用**（参照页先进 kit）：
- 图表、读数和图例、大数字滚动、首屏翻页、两栏展开收起、Agent 图标筛选、日期范围层：外观和动效保持现状。用 kit 图表重做时，把 kit 图表调到与费用页一致；kit 图表的改动按计划 9.4 先列出 API 和理由交 Claude，批准后再改。
- 控件（按钮、分段、下拉、菜单、开关、输入、Sheet、表格、徽标、横幅）换成 kit 后按 kit 的样子，不再调回旧样子。
- 所有与旧版不同的地方逐项列进页面记录，附前后对照图。

**M7 用量**（M8 审核通过后）：
- 按 `UI-UNIFY-COST-REFERENCE-20261027.md` 第 1、3 节统一：图表照已调准的 kit 图表，Agent 筛选用图标条。
- 悬停照搬旧版（所有者 2026-10-28 更正，`UI-HOVER-20261028.md` 第 5 节）：趋势卡片、热力图提示和时段格提示原样带过来，卡片内容用 kit `TipCard`。原来写的“不用悬停卡片，指针处最多一个小胶囊”作废。
- 不要求与旧版一致；差异同样逐项列出交审。

**摘要栏**（每页随迁移交付，`UI-UNIFY-COST-REFERENCE-20261027.md` 第 5 节）：
- 视图名加进 `#summaryPanel` 的 `data-summary-views`，在 `#summaryPanel` 里加岛 `<div data-island-host="cost-summary">`（M7 为 `usage-summary`），只在该页是当前视图时渲染；
- 内容按第 5 节表格的草案，每页 2–4 节，只读加跳转；最终内容和文案交 Claude 定；
- 摘要栏没有固定时，页面正文已有这些信息，不另加内联副本；
- 节的外形（标题行、`border-b`、`py-5`）新建为 kit 组件 `SummarySection`（本记录授权的唯一 kit 新增，API 先交 Claude）；额度页的摘要不改。

## 6. 因 M4、M5 未合入而调整的裁决

- **`insights-ui.js`（G1）**：原定 M4 把它改成 Host。现在由 M8 做：
  - 改成唯一的 `window.insightsHost`，含 `get()`、`insights-change`、`attention/acknowledge/restore/openAttention`、`notices(page)`、`budget.save/remove`、`projects.load/export`；一份 `general/version/busy` 不拆。
  - 只移走费用页的预算和项目渲染。来源页“需要处理”、解析能力和会话提示仍是旧页面，它们现在的渲染代码保留、输出不变，改由 Host 的数据驱动。
  - 来源、会话两页在逐像素门槛里必须原样通过。做不到就按计划 9.4 停止提问，不要为此改这两页。
- **额度接口（G1）**：费用页现在读 `window.quotaUi.state()`、`window.providerQuotaUi.state()/codex()`，这几个兼容名由额度页 React 注册。M8 改为直接读 `window.quotaHost`（类型见 `ui/src/data/quota-host.ts`）；`quotaUi.openSource(agent)` 保留，费用页继续用它跳到额度页定位。兼容名在 M8 之后是否删除由 Claude 决定，M8 不删。
- **`ui-carousel.js`**：额度页已不再使用，只剩 `cost-hero.js`。M8 迁完费用首屏、全局检索无使用者后，删除文件、`index.html` 引用和 `serve.js` 白名单项。
- **Chart.js**：M7 改用 kit LineChart；检索无其他使用后删除 `assets/vendor/chart.umd.min.js` 和引用，并核对 `audit:runtime` 与 `package.json` `build.files`。
- **`date-range.js`**：M7 后检索，无使用者就删除。

## 7. 每页门槛

照 `UI-LAYOUT-GATE-20261027.md` 第 2 节，补充：
- **基线**：开始实现前拍 `artifacts/ui-gate/M8/before`：从 main 的干净检出，两种尺寸 `1180x850`、`1440x900`，浅色和深色，全部页面。M7 的基线从**已提交 M8 的分支**拍，不从 main 拍。
- **场景**：先写 `docs/m2/ui-gate/M8-scenes.json`（M7 同理），覆盖门槛第 4 节全部场景，`before` 用旧 DOM，`after` 用新 DOM；先在旧版上跑通 `before`，再开始实现。
- **比较**：
  - 本步不改的页面（M8 时是用量、额度、会话、来源、设置）：必须通过；不得调大预算、增加遮挡或删除图对。外框共有的标题栏按钮变化（该页登记摘要栏后才出现）只在本步迁移的页面上出现。
  - 本步迁移的页面：只出前后对照图，差异逐项写进页面记录，不需要 `approved.json`。
- **UI 套件**（源码模式，合成 fixture，独立的 usage/quota 目录，绝不跑 `validate:local`）：
  - M8：`cost`、`cost-layout`、`cost-compact`、`cost-composition`、`cost-rebuild`、`budget-overview`、`renderer-lifecycle`、`workbench`、`render-performance` 的费用部分。测试映射先写明 `cost-ui-test` 在基线上的结果。
  - M7：`usage`、`activity`、`agent-recovery`、`statistics-worker`、`layout`、`detail`、`style-alignment`，以及 `visual`、`motion`、`render-performance` 的用量部分。
  - 两页都跑：`npm run verify`（fail 0）、`npm run audit:runtime`、页面冒烟。
- **断言映射**：盘点里的每条旧断言逐条对应到新断言。外观按统一规则改变的断言改写为新外观的断言并注明条款；删一条要写理由并引用裁决条款。

## 8. 写法

- 排版照 `ui/src/pages/settings/`：一个 JSX 元素一行，一行不超过约 140 字符。上次审核退回的原因之一是页面代码压成单行（最长约 5900 字符），无法审核。
- 只用 kit 组件和 `UI-SPEC` 的 token；需要 kit 扩展、新 token 或设计检查例外时，按计划 9.4 停止提问，不改共用样式来迁就。
- 未知、没有记录、未定价照 G2；不把未知填成 0；`--agent-*` / `--series-*` 只标识 Agent。
- 统一引出的新文案（例如摘要栏）列出来交 Claude 审（G5）。

## 9. 交付和停止点

- **M8 完成后停止**，写 `docs/m2/UI-MIG-M8-<日期>.md`：提交号、基线和候选的提交号、未改页面的 `report.md` 原文、迁移页面的差异清单和对照图目录、套件结果（实际运行的命令和输出）、断言映射、待决问题。等 Claude 审核通过后再开始 M7。
- M7 完成后同样写 `docs/m2/UI-MIG-M7-<日期>.md` 并停止。
- 记录里只写实际跑过的结果。没有 `report.json` 支撑的“通过”不算通过，未跑的套件写“未执行”。
- 不读真实来源、账号、认证或配置文件；不使用子代理；不做 GitHub 写操作。
