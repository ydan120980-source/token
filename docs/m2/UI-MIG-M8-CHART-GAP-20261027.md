# M8 实页接入后的图表接缝 · 2026-10-27

状态：所有者 2026-10-27 已批准 §1 四组最小补充，并要求记录后继续 M8。批准仅涵盖表中接口、命名映射和旧绘制校准；其余范围与门槛不变。

最高依据仍为 `UI-MIG-M8-RULING-20261027.md`。所有者已批准 `UI-MIG-M8-COLOR-GAP-20261027.md` 三项补充；本文不扩大该项批准。

## 1. 源码证据与最小申请

| 接缝 | 原费用页 / 当前 kit 的差别 | 请求 |
|---|---|---|
| 首屏 A 的 Agent 构成条 | `cost.css:750–752`：每段独立圆头、段间 3px；`StackBar` 当前把所有段画在同一个圆头 clip 内，段内是相邻矩形。现有属性没有段间距或逐段圆头。 | 新增 `StackBar.variant?: "continuous" \| "cost-hero"`，默认 continuous 保持现状；cost-hero 仅用在费用首屏，按原比例分配扣掉 3px 间隙后的宽度，每段独立 `rx=height/2`。没有已计价金额不生成金额段，未计入仍只作说明，不造金额 0。 |
| 首屏 C 的每天四态与今天 | `cost.css:790–795`：有价格是 series-codex；无记录是 fill-strong 的实心短柱；未来是 hairline 边框；今天仍用原 series 色并加外圈。当前 `BarChart height="days"` 将无记录画成虚线空心、将今天的填色强制改成 accent、没有今天外圈。 | 只校准 days 档位的绘制，沿旧四态和今天外圈；今天使用 caller 传入的 tone，未计价保留原 warn 边框，未来 hairline 边框，无记录 fill-strong；其它档位和数值/尺寸不变。这里没有设计新颜色。 |
| 图表底轨和坐标色 | 环图 / 仪表的旧底轨是 fill，推算是 fill-strong；当前 kit 有部分 stroke-hover / stroke-active（深色由 fluid 改了值）。明细图坐标分别是 cost-chart-grid / cost-chart-caption；当前 LineChart 用 border / muted-foreground。A–G F 只映射曲线颜色，没有映射这两个坐标色。 | 增加 `cost:grid → --cost-chart-grid`、`cost:caption → --cost-chart-caption`、`cost:hairline → --hairline`、`cost:muted → --muted` 的命名映射（后者在文档根解析，避免 React 的同名语义变量覆盖），不增加或修改原色值。LineChart 新增 `palette?: "default" \| "cost"`，默认不变；cost 的 stack 坐标用原 hairline/muted，detail 用原 cost-chart-grid/cost-chart-caption。spark 没有坐标，不新增坐标。 |
| 底轨接口的适用范围 | 已批准的 RingChart.trackTone 本轮只允许用在 mini；当前 donut/gauge 尚未接收该值，gauge 推算底色也不能单独传入。 | 将已批准的 trackTone 的适用范围扩展到 donut/gauge，并增加 `projectionTone?: ChartTone`（不传保持现状）。费用 donut/gauge 传 cost:track；gauge 的推算传 cost:track-strong。其它页面不传，行为不变。 |

所有改动均限上述绘制和命名映射；不新增任意样式入口、颜色字面量、token 色值、设计检查例外，不修改 vendor，不改额度页。批准后同步原 kit gallery 和测试。

## 2. 已有实页证据与实际状态

- `artifacts/ui-mig/M8/first/{light,dark}-{top,page}.png` 是 React 费用页的首轮实际渲染；有合成数据，无渲染错误。它们未冻结为基线相同日期，也未通过最终交互和几何验收，不能当作正式前后对照。
- 已接入 cost / cost-summary 两个岛，摘要按最高裁决 §2 定稿文案；预览岛已从源码与注册移走。
- 原额度摘要没有按路由返回空内容，首轮实页显示了它的说明。已在岛注册处加活动路由包装，保留额度页面/摘要源码和输出；尚未重建验证此修正。
- 已写 `costHost`、`insightsHost` 及类型，费用 React 页、范围 Sheet、详情、项目/预算和纯 cost-model。insights-ui 只移走费用 DOM，来源与会话旧渲染保留。
- G4 旧页面先调用提取模块的合成验证通过：首屏 `$22.28`、环图 4 项、月份 3 项、走势 64 桶，无渲染错误。日志 `.cache/m8-old-first-final.log`。首轮断言误读滚动数字的 textContent，改为公开 aria-label 后验证；错误日志保留。
- 首轮 build 通过；后续 typecheck 通过。lint 找到提取模块的 unused remember，已修正。新增纯计算测试中，六项通过，一项按数组首项取九月的测试假设错误（列表从八月开始）；尚未修正复跑，不称全通过。
- 尚未完成 gallery、逐断言映射、全部 UI 套件、cost-ui 同 fixture 三连跑、五页像素比较、正式费用前后对照、差异清单及交付提交。
- 当前仍无完成提交。不合 main、不推送、不打包，不使用子代理、真实来源或账号；旧 M6 工作区保持原样。

## 3. 暂停的原因

第一轮接口核对漏掉了以上实页绘制差别。直接保留 kit 当前绘制会改变费用页既有图形和颜色；直接改 kit 又超出 A–G 和第一次补充的逐项授权。

计划 §9.4：**“影响 kit、规范、vendor、theme、tokens、设计检查，或影响后面多页：停止全部工作并提问。不得自己扩展 kit 接口、加设计例外或换写法。”** 因此停在此处，请所有者 / Claude 批准或改写上述最小接口后再继续。
