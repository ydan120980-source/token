# M8 A–G 裁决 · 2026-10-27

Claude 对 `UI-MIG-M8-INTERFACE-AUDIT-20261027.md` 的 A–G 和 `UI-MIG-M8-AG-PREVIEW-20261027.md` 的预览截图做出裁决。所有者 2026-10-27 已确认“按裁决继续 M8”。本记录的效力高于申请记录；申请里写了但本记录未批准的部分，一律不做。

## 0. 原则

- 统一规则不变：模板库（kit）有的组件直接用；kit 没有的，照费用页现状（`UI-UNIFY-COST-REFERENCE-20261027.md`）。**费用页现状里没有的内容，不借迁移加进来。**
- A–G 的预览是拆散的组件样本，不能当审核依据。**审核只看费用页的前后对照图**：组件放回页面，用和 main 相同的场景拍。
- 配色不在 M8 内改动。所有者 2026-10-27 决定另开一项“配色”，由 Claude 出方案，所有者定稿后再执行。M8 按现有 `--series-*` 和费用类型色迁移。

## 1. 裁决

| 项 | 裁决 | 要求 |
|---|---|---|
| A `SummarySection` | **批准，有修改** | API 保持 `title / actions / children`。最后一节不画底线（`last:border-b-0`），和额度摘要一致。跳转按钮放在标题行的 `actions` 里，用 `Button variant="ghost" size="compact"`，和额度摘要的“定位下一张”相同。**不用**标题下方居中的灰色文字链接。去掉“API 等价估算”胶囊。文案见第 2 节。 |
| B `ChartLegend` | **部分批准** | 批准 `variant: "inline" \| "donut"`。**驳回 `share` 和 `compact`**：费用页现有的环图图例只有名称和金额，没有份额列。把这两项代码和对应的测试一起删掉。 |
| C `BarChart` | **批准** | 批准 `selected`、`groups[].ariaLabel`、月份图按剩余高度伸展（最低 160）、指向时的底带，以及 pair/days 小金额的比例和明确为 0 时的基线。只按申请的范围校准。 |
| D `LineChart` / `StackBar` | **部分批准** | 批准 `endLabel`。**驳回 `tooltipPresentation` 选项**：规范已不要悬停卡片，所以共享提示层只保留胶囊这一种样式，删掉 card 分支（`common.tsx` 中 `rounded-xl p-3 shadow-surface-3`）。`LineChart` trend 用的 `ChartTooltip` 浮卡，以及 heatmap 的提示，都改成胶囊或顶部 `CursorReadout`。核对结果：当前没有哪个页面用到这些提示（`ui/src/pages` 里没有 `tooltip=`），未改页面的像素不受影响。kit gallery 要随之更新。 |
| E `PaneGroup` / `RingChart` | **批准** | 正文内边距改为 `p-5`；donut 中心的读数切换用 `spring.fast`，淡入并上移 4px。 |
| F 费用颜色映射 | **批准** | 六个 `cost:*` tone 只做命名映射，不改颜色值。`--input` 和表单变量同名的处理方式（申请记录里的首轮修正）保留，并在 M8 记录里写明。 |
| G `Figure cost-hero` | **批准** | 60px，行高 1.05，字距 -1.5px，字重 600；字重从原来的 700 改为 600，列入差异清单。 |

## 2. 费用摘要（`cost-summary`）定稿

三节，读同一份 `costHost` 数据；统计口径和费用页正文一致。

**本月至今**，actions：`查看本月`（定位首屏的本月页，不改日期筛选）
- 主数字：`Figure size="md"`，显示本月至今的下界；有上界时，后面跟“– $9.28”，样式同费用页首屏。
- 第二行（caption）：`推算整月 $10.67 – $11.07`。有用量的日子不足 7 天时，改为 `用量不足 7 天，暂不推算整月`。
- 第三行（caption，muted）：`按公开价估算，不是账单`。
- 不受所选日期范围影响；Agent 筛选会影响。

**花得最多**，actions：`查看构成`（定位“花在哪”）
- 第一行（caption，muted）：所选日期范围的标签，与首屏一致（例如 `8/24 – 10/26`）。
- 最多三行，每行是 Agent 图标、名称和金额，按已计价下界排序；部分计价的金额带“+”，与费用明细一致。点击一行就套用这个 Agent 的筛选，并定位到分析区。
- 没有任何已计价金额时，只显示 `所选范围内没有已计价的用量`，不排序，也不显示 $0。

**未计入**，actions：`查看覆盖`（定位“计价覆盖”）
- 第一行（body）：`426.4K Token 未计入 · 已计入 98.5%`，数字取计价覆盖投影。
- 下面最多两行原因（caption），沿用覆盖区原有的原因文案（例如 `来源没有报告完整字段`）。
- 没有缺口时，整节只显示 `全部已计价`，不显示 actions。

未知值一律显示“未知”或“未计入”，不显示 $0。

## 3. 其余照开工指令

基线、门槛、逐断言映射、`cost-ui` 用同一 fixture 连续通过三次、未改的五个页面过像素门槛、费用页出前后对照和差异清单、写记录 `UI-MIG-M8-<date>.md` 后停下等审核，这些都不变。A–G 预览岛 `cost-ag-preview` 和 `ui/src/dev/cost-ag-preview.tsx` 只是审核用的临时文件，**不进入 M8 提交**；`ui-foundation` 的登记列表也恢复原样。

## 4. 更正（2026-10-27 稍后，所有者决定）

所有者把摘要栏改成一个可以自定义的小组件侧栏：它不绑定页面，内容由用户自己挑选、排序，并设置颜色和背景。设计稿见 `ui/design-palette-summary` 分支上的 `design/proposals/20261027/sidebar.html` 和 `docs/m2/UI-PALETTE-QUOTA-SUMMARY-PROPOSAL-20261027.md`，由 Claude 实现。因此：

- **M8 不再交付费用摘要**：撤回第 2 节，不登记 `data-summary-views`，也不写 `cost-summary` 岛。`SummarySection` 如果还没有被页面用到，就不要放进 M8 的提交。
- **配色值在 M8 内不改。** 所有者已选定新配色（方案 C），由 Claude 在 M8 合入后统一修改 token 的值。M8 继续只用 token 名称做映射（`cost:*` 等），不写死颜色值；这样以后换值时，费用页会自动跟着变。
- 第 1 节其余裁决，以及 `UI-MIG-M8-COLOR-GAP-20261027.md`、`UI-MIG-M8-CHART-GAP-20261027.md` 中已批准的补充，全部不变。

## 5. 删除说明性小字（所有者 2026-10-27，所有页面）

费用页按同一规则处理：删除页面副标题、分区说明、提示语、免责说明和解释性段落，例如“API 等价估算 · 按公开价目，不是账单”这类句子和各区块下的说明行。保留标题、数值、状态、空状态、错误提示，以及“未知 / 未计入”这类标签。删掉的内容列进 M8 记录的差异清单。其他页面由 Claude 在 `ui/design-palette-summary` 上处理，见 `UI-PALETTE-QUOTA-SUMMARY-PROPOSAL-20261027.md` 第 3 节。
