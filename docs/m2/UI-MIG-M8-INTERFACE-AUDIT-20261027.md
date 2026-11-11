# M8 实施前接口核对与裁决申请 · 2026-10-27

**历史申请记录。后续有效裁决为 `UI-MIG-M8-RULING-20261027.md`（效力高于本文）及已批准的 COLOR / CHART / LIVE-READOUT / PIXEL-CLOCK 补充；最终状态见 `UI-MIG-M8-20261027.md`。本申请中的 share、compact、tooltipPresentation、card 提示分支已删除，费用摘要及未使用的 SummarySection 按最高裁决 §4 撤回，A–G 独立预览岛不进入提交。**

以下保留实施前裁决申请原文；其中“未实施”“未修改”等描述属于首次停止点，不代表当前状态。

基线为本地 main `0ac94cf2f8599188d03e0405ce55a00824c57ae2`；新分支 `ui/mig-m7-m8` 从该提交建立。没有挑取旧分支提交。M6 由 Claude 负责，旧工作区未改动。

本记录仅申请下列 A–G 的具体补充；不是对其它 kit、主题、token、vendor 或设计检查修改的授权。产品代码、依赖、主进程和 preload 尚未修改。

## 1. 已完成的准备与依据

- 开工指令 §2 的全部开始条件满足；`ui/quota-shell` 已是 main 祖先，main 干净。
- M8 的 F1–F40、数据与耦合清单已对照当前文件定位。盘点引用的六个主要费用脚本及 `insights-ui.js` 在 `4f77437..0ac94cf` 没有内容差异；外框、额度接口、kit、挂载和规范已经改变，不能沿用旧分支实现。
- main 上的 `cost-ui-test.js` 首轮失败：第 156 行 `keyboard can scroll the full cache list`。记录 `.cache/m8-baseline-cost-ui.log`；未修改或放宽该断言。
- `M8-scenes.json` 的 18 个 before 场景已在旧 DOM 上跑通。main 的两种尺寸、两种主题、六页首屏/整页及费用场景已经拍摄：`artifacts/ui-gate/M8/before/{1180x850,1440x900}/`。两份 manifest 的 `dirty=false`、head 均为 `0ac94cf`、renderer errors 均为 `[]`。这是基线采集结果，不是候选比较通过。
- 当前 CodeGraph 工具不可用，以定向源码和已有测试核对。Browser 插件不可用，使用项目现有 Playwright/Electron，全部为隔离的合成 home/usage/quota。

## 2. 请求裁决的最小接口和实现范围

### A. SummarySection API 与摘要草案

开工指令 §5 明确授权新增这一组件，但要求 **API 先交 Claude**。

```ts
SummarySection({
  title: string,
  actions?: ReactNode,
  children: ReactNode,
})
```

建议放在 `ui/src/kit/summary-section.tsx`，从 kit 导出。只封装既定的标题行、`border-b border-border`、`py-5` 和内容间距；标题沿已有摘要的 `text-subtitle font-semibold`，actions 放标题同行。不开放自定义颜色、尺寸、className 或 style。用生成的标题 id 标记 section；数据、文案和跳转由页面提供。**额度摘要不改为该组件。**

费用摘要草案共三节，最终内容和文案需 Claude 定稿：

| 节标题草案 | 只读内容 | 已有功能的跳转 |
|---|---|---|
| 本月至今 | 当前 Agent 范围的本月至今估算上下界、推算整月上下界；不足 7 个有用量日沿用“暂不推算”和原解释。不受费用所选日期范围影响，沿首屏 C。 | “查看本月”：定位首屏本月页，不改变日期筛选。 |
| 范围内花得最多的 Agent | 当前日期范围内，沿原 composition 的已计价下界排序，最多三项，各自金额与部分标记；不新增跨 Agent 合计。全未知时说明“未计入”，不排序成金额 0。 | Agent 行应用已有 Agent 筛选并定位分析；“查看费用构成”定位花在哪。 |
| 未计入 | 沿原计价覆盖投影列出现有缺口数量/原因；未知、未定价、部分覆盖保持原语义；没有缺口时沿原“全部已计价”说明。 | “查看计价覆盖”：定位原核对区。 |

读同一份 `costHost` 数据；无摘要停靠时不增加正文副本。仅 cost 视图登记 `data-summary-views` 并渲染 `cost-summary`；不更改其它页面的按钮和摘要。

### B. ChartLegend 保留费用图例的两种排列

现状：`ui/src/kit/charts/legend.tsx` 只有纵向、整行宽、36px/body 的列表。费用趋势和按月是横向换行图例，按月为 28px；donut 是名称、金额、份额的 36px 行，窄面板份额移到中心。证据：`cost.css` 的 `.cost-trend-legend`、`.cost-donut-legend/.cost-donut-row`、`.cost-bars-legend/.cost-bars-chip`，以及基线 `*-scene-cost-composition.png`。

请求补充：

```ts
variant?: "list" | "inline" | "donut"; // 默认 list，现有默认行为不变
compact?: boolean;                    // 默认 false；donut 窄面板隐藏份额列
// items[]：
share?: ReactNode;                     // 默认无；donut 的独立份额列
```

`inline` 按现有费用横向图例排列、28px 行；`donut` 沿费用列表的 36px 行和列对齐，note 继续承载金额、share 承载已格式化份额。compact 与 RingChart 的 donutCompact 使用同一旧断点判断，份额完整读数仍在中心和 aria-label 中。默认 list、active、disabled、minVisible 和“至少一个已计价正值项”保护不变；不压暗其它图表项。

### C. BarChart 的月份选择、完整读数和现有几何校准

旧 `cost-bars.js` 的 `model.selected` 独立于 hover：选中月份的 x 轴文字和按钮 `aria-pressed` 保留；没有选中时初始 Tab 入口在最后一个月。旧月标签是短文本，但按钮的 `m.aria` 包含完整月份与金额。现 kit 只有 active，且直接把 `group.label` 同时用于轴和 aria-label。

请求补充：

```ts
selected?: string | null; // 默认 null，仅 months；与 active 分开
// groups[]：
ariaLabel?: string;       // 未提供则回退 label
```

并仅校准现有费用档位：

- `height="months"` 像旧 `cost-bars.js:36,52–58` 一样按正文剩余空间测绘，最低 160，而非永远固定 160；保留 408px 面板、轴边距和取整刻度。
- 恢复月份的指向底带，跟随使用已有 `data.follow`；选中月的样式、完整读数、再次点击清筛选和键盘保留。
- pair/days 的 peak 分母和明确 0 的基线按旧 `cost-hero.js`，不再一律把峰值抬到 1。原本小于 $1 的数据在当前 kit 中会画矮；days 的明确 0 原来是 8px 基线，而当前通用分支先返回 1px。金额未知仍保持 null，不造 0。
- 其它 columns/strip/hours 档位不变。

### D. 明细趋势的末端标签与微图小胶囊

旧 `cost-chart-ui.js` 的详情图显示最后一个已报告点的完整格式化文字，以及 1.3/3.5px 的普通点/末端点；读指向点时隐藏末端文字避免重叠。kit LineChart 没有接收该字符串的接口。另有 `LineChart.spark` 与 `StackBar` 的共享 tooltip 固定为 `rounded-xl p-3` 浮卡，不符合新的“小胶囊、不用悬停卡片”。

请求补充：

```ts
// LineChart：
endLabel?: string; // 默认不显示，仅 detail，旧 UMD 提供字符串
tooltipPresentation?: "card" | "pill"; // 默认 card
// StackBar：
tooltipPresentation?: "card" | "pill"; // 默认 card
```

endLabel 启用时，沿旧图的末端定位、已报告点标记和指向隐藏规则；无已知点不生成标签。pill 使用同一共享提示层的窗口避让，显示原 UMD 的完整读数，采用紧凑胶囊，放在图外边距，不盖曲线；同一时刻最多一个。默认 card 和其他变体不变。stack 的现有顶部 CursorReadout 保持原样，不需要改 API。键盘、Escape、aria-describedby、滚动/失焦清理保留。

### E. 两个已有组件的定点校准，无新 API

- `PaneGroup` 正文内边距 `p-6` 改为旧两栏的 `p-5`（`cost.css:569`）。保留 56px 收起宽、408px 正文高、760px 窄屏规则和 flex-grow/slow 动效。标题栏控件仍用 kit 外观。
- 只给 `RingChart` 的 donut 中心加已规定的读数切换：active 变化时淡入、上移 4px、`spring.fast`，圆/半环切换的中心位置平滑跟随旧行为。当前弧段的 R108、pad、半环 cy120/height133 已与旧源码核对一致，**不申请修改这些几何**；concentric/gauge/mini/coverage 不改。

### F. 费用图形已有颜色的语义映射

旧费用类型和明细趋势不使用用量 category 色：`cost-page.js` 的 KINDS 使用 `--input/--output/--read/--write`；详情/行内趋势使用 `--cost-chart-color`。现 ChartTone 只有 usage category 和 accent 等，无法准确传入这些已经存在的 token。特别是 accent 在深色是灰色，不能替代原明细趋势的绿色。

请求仅添加以下静态映射，不改变任何既有颜色值：

| ChartTone 新值 | theme 映射（同时提供 fill/stroke/bg 语义类） |
|---|---|
| `cost:input` | `--color-cost-input: var(--input)` |
| `cost:output` | `--color-cost-output: var(--output)` |
| `cost:read` | `--color-cost-read: var(--read)` |
| `cost:write` | `--color-cost-write: var(--write)` |
| `cost:line` | `--color-cost-line: var(--cost-chart-color)` |
| `cost:track` | `--color-cost-track: var(--fill)` |

track 只供费用图形沿原底轨/底带使用；不改变额度图的默认颜色。Agent 构成仍使用已有 `series:*`，用量 category 映射不改。范围限 `ui/src/kit/charts/tones.ts`、`ui/src/theme/index.css` 及费用图形对此映射的调用，不增调色板。

### G. Figure 的费用首屏档位

旧费用主数字为已有 `--text-cost-hero`（60px），`cost.css:347` 为 1.05 行高、-1.5px 字距；Figure 最大档 xl 为 52px。直接用 xl 会改变本次要求保持的首屏主读数。

请求新增：

```ts
Figure.size: "xl" | "lg" | "md" | "sm" | "cost-hero";
```

cost-hero 复用已有 60px token，只把旧样式的 1.05 和 -1.5px 提成 `--ff-cost-figure-leading`、`--ff-cost-figure-tracking` 两条命名 token，再在 theme 中映射费用 figure 类；不在页面写数字或 style。字重保持规范的 semibold（旧 700 → 600 列入差异），其它 Figure 档位和滚动算法不变。

## 3. 批准后的实现、验证与边界

- 上述 API、变体或行为每项加 kit gallery 示例与断言：深浅色、键盘、未知/0、off/reduced 终态、完整原始读数；带动效的项验证中途改目标与清理。
- 纯业务投影仍按 G4：原样提取 UMD，旧页面先调用并证明输出，再交给 React；不在组件重做金额格式化、聚合或定价。
- 先保存裁决，才开始产品实现。其它缺口仍按 §9.4 停止，不把本记录当作自由扩展许可。
- M8 的全部页面门槛、逐断言映射和同 fixture 连续三次 cost-ui 验收不减少。未改五页使用同一基线和预算比较；不加遮挡、不删图对。费用出完整前后图和差异清单。
- 不修改 vendor、设计检查、allow 文件、后端、IPC/preload、依赖；不合 main、不推送、不打包、不读真实来源/账号/配置。
- M8 提交和交付完成即停止，等待 Claude 审核后再做 M7。

## 4. 实际停止点

只新增本申请、M8 进度记录和场景配置；产品源码仍与基线一致。未构建候选，未运行候选 verify/runtime/foundation/smoke，未做 before/after 比较，未提交 M8。
