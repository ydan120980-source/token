# MK-b 剩余接口只读核对 · 2026-10-26

## 范围和结论

分支 `ui/mig-m4-m8`，HEAD `783d4cb`。所有者批准 Timeline 文案通道后，授权继续；本次按先前提议先只读核对剩余接口。效力仍为统一裁决 > M3 > 计划。CodeGraph 不可用，采用当前源码、反向引用、五页盘点和裁决逐项核对；没有子代理。

**发现以下五组必需的接口补充，均尚未实施。** 它们影响 kit 和后续多页，依统一裁决 §1 / 计划 §9.4 停止全部产品工作，汇总提问。已经批准的 ChartLegend、StepChart 和 Timeline 补充不构成这五组的授权。

本次只新增授权/核对记录；未修改组件、页面、测试、vendor、token、theme 或生成物，未运行 build / verify / UI。已有未提交的 MK-b 初版保持原状，仍未导出或进入产品。此前局部类型、guard、几何测试不作为本次验收，也不代表 MK-b 完成。

## A. Gauge 的整月推算区间缺少一个端点

原 §4.3 为 `gauge.projection: number | null`。当前旧 `cost-hero.js:34–36` 明确使用 `arc(c.projection.lower, c.projection.upper)` 绘制虚线区间，最大值也使用推算 upper。`cost-page.js:171–172` 原样传入 `current.projection`。一个数字无法同时保留两个独立端点，画成从 0 或已消费下界到该数都会改变旧几何。

最小提案：把该字段改成下面的区间类型，其余 gauge 字段不变：

```ts
projection: { lower: number | null; upper: number | null } | null;
```

M8 直接提供旧 UMD 的两端；任一端未知就不画该虚线段，不推测端点、不从 0 起画。已消费的 lower/upper 仍独立按原裁决绘制。新组件尚无产品消费者，不需新增兼容业务转换。

## B. 现有浮动读数和游标胶囊缺少内容槽

| 组件 | 旧源码证据 | 现接口缺口 | 最小提案 |
|---|---|---|---|
| `BarChart` | `preview.js:365–366,479–486,996–1000`：近 30 天柱的 accessible label 是简写加“查看明细”，浮动提示另含日期/星期、完整 Token；`insights.js:138–145,160–164`：小时柱提示另含区间、Token/无用量和主要 Agent 占比。 | 只有 label 和图上方 readout；不能用上方读数代替原窗口内浮层，也不能由 kit 重写完整值和占比。 | 新增 `tooltip?: (key: string) => ReactNode`。 |
| `Heatmap` | `preview.js:479–486` 日历提示和 `insights.js:127–136` 周×小时提示分为说明、主数、单位、活跃天数；cell 的 label 是另一份无障碍文字。 | 只有 label 字符串；仅显示 label 会丢提示中的原内容或层次。 | 新增 `tooltip?: (key: string) => ReactNode`，未提供则沿用 label。 |
| `StackBar` | `cost-chart-ui.js:37–55` 的明细构成微条，提示显示全部已计价分类、完整金额与份额，并点亮指向分类。 | 只有各段 label 和 active 通道，没有整个提示的内容槽；native title 无法表达多行完整构成和指向项。 | 新增 `tooltip?: (key: string \| null) => ReactNode`；null 为微条内尚无具体段的读数。 |
| `LineChart` | `cost-stack.js:92–105` 的游标小胶囊含日期/累计说明和总金额；`cost-chart-ui.js:45–55` 的行内 spark 提示含日期/Token；`:64–68` 和 `cost.css:726` 的详情读数在图右上。 | 原 §4.5 的 tooltip 明确“仅 trend”；仅 readout 上方槽不能代替图内胶囊、微图上方浮层或右上角详情读数。 | 保持现有 `tooltip?: (index: number) => ReactNode` 签名，允许用于 stack/detail/spark。 |

所有内容由旧 UMD 投影、页面组合既有 Figure/Value 和文字后传入；组件不舍入金额、换算 Token 或从未知补零。原生 title 继续保留。

位置和触发方式不新增设计：

- Bar 的 strip/hours 与 Heatmap 共用原类用途的窗口内提示层，照 `detail-interactions.js:125–140` 的避让几何；其它 Bar 档位未提供 tooltip 时不增加浮层。
- StackBar 的微条和 LineChart 的 spark 读数照 `cost-chart-ui.js:52–54` 在微图上方、按窗口避让；没传 tooltip 的条不增加浮层。
- LineChart trend 继续原图内避让；stack 在图的顶部留白内放旧日期/总额胶囊；detail 在原右上角位置放读数，并在激活时隐藏终点标签。variant 决定位置，不添加可自选位置属性。
- pointer/focus 使用同一完整读数，`aria-describedby` 关联对应层；离开/失焦/Escape 清除，保持原针/固定/选区语义。文字层次依规范字号映射，沿用现有 token 和 `spring.fast`，不增加颜色、尺寸档、文案或动效。
- LineChart 的 `x[].label` 可继续提供点的完整可访问名称；独立 `ticks.x` 提供坐标轴短日期，tooltip 提供可见胶囊/读数，无需再加 ariaLabel 或业务格式化字段。

## C. 额度 Card 整体点击缺少入口

当前 `quota-cards.js:787–791` 的 act 明确：点卡片非按钮区域会打开账号详情；选中文字和 input/a/summary 不触发，拖动拾取后的 click 由排序逻辑抑制。卡片内仍有刷新、详情等独立按钮。`ui/src/kit/surfaces.tsx` 的 Card 没有 onClick。

提案仅新增 `Card.onClick?: () => void`，默认不启用。保持 Card 外观和容器语义；只对非交互区域、未选中文字的点击回调。已有详情 Button 保持键盘入口，不能把整个含按钮 Card 变成嵌套 button。Sortable 仍拥有拖动后的点击抑制，不把新动作混入 onReorder 或在页面查 DOM。

## D. PaneGroup 标题旁的旧切换控件缺少槽

`index.html:95` 的“花在哪”标题、费用构成/订阅对照分段、放大按钮位于同一标题行。`cost.css:561–574` 在收起时隐藏标题行里的分段；`:686–693` 窄屏上下排列时恢复。原 §4.9 panes 只有 key/title/node，node 是内容；把分段移到 node 会改变原位置，把它塞进 string title 也不符合类型。

提案在每个 pane 上只加 `actions?: ReactNode`：放在标题右侧、既有收起/放大按钮之前，收起时随内容隐藏且不可交互，窄屏照旧显示。两栏等高、56px 窄条、408px 旧主体基准和容器 760px 断点均能从当前 `tokens.css:216–217` / `cost.css:558–574,686–693` 得到，不需新 theme/helper/token 或任意布局参数。旧标题和切换文案不变。

## E. DateRangePopover 缺少可见触发文字和记录点数据

`preview.js:775–776` 分别提供旧按钮的可见范围文字、完整 title 和“趋势时间范围：…”可访问名称。可见文字可能是“累计”“最近 N 天”或短日期区间，并不等于 preset 的“跟随页面”或完整 aria-label。原 §4.9 没有可见触发文字字段。

此外 `date-range.js:15,29–33` 从旧 `usageCalendar.recorded` 给日期画记录点、加“有用量记录”说明；内部 RangeCalendar 虽有 marks，外层 DateRangePopover 没有传入通道。kit 不得自行读 window.usageCalendar。

仅补充：

```ts
triggerLabel?: string; // 未提供沿用既有 preset label / aria-label，不编造范围文案
marks?: string[];      // 原样传给内部 RangeCalendar
```

M7 总是提供旧 UMD 的可见范围文字和已记录日期；完整 aria-label 仍走既有属性。旧 title 可按 G6 放在页面包裹元素上由触发按钮继承，无需再加一个 kit title 属性。onApply/onReset、独立范围状态、校验和焦点规则不变。

## 其余接口逐项结论

| 项 | 本次核对结论 |
|---|---|
| `RingChart` concentric/donut、`BarChart` months | 除 A/B 外，已列数据、tone、尺寸、center/readout 和受控状态能表达旧模式；隐藏/布局和最大值留旧 UMD。 |
| `ChartLegend` | 采用已批准的五字段补充；未发现还需新字段。 |
| `Timeline` | 采用本次已批准的 marker label / aria-valuetext；leading/value 可表达旧名称、静默行说明和右侧读数；stale/耗尽分别用已列 state/tone，不另加业务格式化。 |
| `StepChart` | 已批准的 ticks/axis 和起点语义足够表达旧输入；区段/菱形共用 active、完整 label，未发现还需新接口。 |
| `Carousel` | 已列 slides/index/onIndexChange 能表达三页/两页、首入一次、可见性和手势；页面把图内区域标记为 data-carousel-ignore。 |
| `Sortable` | 已列 items/onReorder 能表达原排序；过滤/隐藏位置合并由旧 UMD 完成，组件保留拾取/取消/键盘/点击抑制。 |
| `Reveal` | trigger/content/aria-label 能表达 G6 指定上下界；没有额外内容或定位接口缺口。 |
| `Ticket` | 核实 `quota-cards.js:248–251` 的旧票据是带 title 的 div，本身没有独立点击动作；点击属于外层 Card。title/figure/caption 可承载旧可见内容，G6 页面包裹元素可保留整项 title，**无需新增 Ticket onClick**。弯口/背景照最高裁决。 |
| `PaneGroup` | 只发现 D；旧几何和容器断点有直接来源，不申请新布局参数。 |
| `RangeCalendar` | 原 value/min/max/onChange/commit/marks 足够；`preview.js:12,874,1097` 保证传入 min 为 coverageStart 或 today，**不需要为 date-range.js 的防御性 fallback 扩展 nullable min**。M8 单日第二次点击的语义依 commit 原裁决。 |
| `DateRangePopover` | 只发现 E；原 title 走 G6，两个“恢复跟随”动作都沿旧回调，不需新回调。 |
| `Sheet` placement/dismissDrag | 原列扩展加已批准 scrollable 能表达方向/尺寸/固定 footer/拖动关闭；实现限 kit，不修改 vendor。 |
| `EdgeTrigger` | 原 side/label/onOpen 足够；24px 热区和 spring.fast 均有明确裁决。 |
| `ListRow` level | 原 level 加已批准 multiline 足够；中性树线沿旧几何，不需新颜色/接口。 |

以上为当前源码与接口的静态核对结论，不是渲染验收，也不承诺尚未运行的 gallery / 页面门槛已经通过。五组补充获明确裁决后，才继续 MK-b 实施和验证；再依序 M6 → M7 → M8，全部完成才写统一交付并停给 Claude。

署名：Codex
