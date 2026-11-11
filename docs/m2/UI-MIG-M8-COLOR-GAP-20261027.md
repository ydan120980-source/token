# M8 首屏微图的原色接缝 · 2026-10-27

状态：所有者 2026-10-27 已批准下文三项最小补充并要求记录后继续 M8。授权仅涵盖这三项，原色值、其余接口和门槛不变。

依据：`UI-MIG-M8-RULING-20261027.md` 高于 A–G 申请，§0 要求配色不在 M8 改动，§1 F 仅批准六个 `cost:*` tone。新的裁决已读取并作为当前依据；旧申请不再是待批准状态。

## 已确认缺口

| 原费用页 | kit 当前能力 | 直接迁移的影响 |
|---|---|---|
| `cost.css:776`，首屏缓存命中小环的已知部分为 `--good-text`；浅色 `#18733a`、深色 `#7fcf9c`（tokens.css） | ChartTone 没有对应 tone；六个已批准的 cost tone 也不含它。fluid success 为浅色 `#22c55e` / 深色 `#86efac`，不是原色。 | 用已有近似色会改变配色。 |
| `cost.css:775`，小环底轨为 `--fill-strong`；`cost.css:771`，双柱的前期柱也是 `--fill-strong` | `cost:track` 对应 `--fill`，没有 `--fill-strong` 的 ChartTone。RingChart mini 的底轨固定为 `stroke-hover`，不能通过 rings[].tone 指定。 | 仅增加一个命名别名仍无法把小环底轨传入。 |
| `cost.css:775–776`，小环线宽 5；旧 `cost-hero.js` r=13、画布 36×36 | `ring-chart.tsx` 的 mini r=13 / 36×36，但线宽固定为 3。 | 原小环粗细无法保持。 |

这些是源码核对结论，尚未把新的费用页实际渲染出来，不能称作候选截图差异或像素检查结果。

## 请求的最小补充

1. ChartTone 增加 `cost:hit` → 原 `--good-text`、`cost:track-strong` → 原 `--fill-strong`。只在 theme 做命名映射，不增加或修改任何颜色值，不修改 tokens.css 的配色。
2. RingChart 增加 `trackTone?: ChartTone`，不传时保持当前底轨；本次只在费用首屏 mini 传 `cost:track-strong`。已知部分通过现有 rings[].tone 传 `cost:hit`。
3. 仅把 RingChart mini 的固定线宽从 3 改为旧费用页的 5；画布、半径、读数、动效和其它 size 均不改。双柱前期柱通过已有 bars[].tone 传 `cost:track-strong`。

批准后在原 kit gallery 补示例与断言，继续实际费用页迁移。其它图形接口和几何不在此申请内。

## 本次工作状态

- 当前分支仍是 `ui/mig-m7-m8`，起点 `0ac94cf`。main 仍干净，开始条件齐全。M6 旧工作区未操作。
- 已部分收口 A–G 源码：移除 ChartLegend share/compact，移除 tooltipPresentation 与共享提示层 card / LineChart ChartTooltip，trend 使用 CursorReadout；SummarySection 增加 last:border-b-0。
- 已移除 cost-ag-preview 的注册；临时页面及专用截图脚本移到忽略目录 `.cache/retired-ag-preview/`，不进提交；foundation 登记列表已去掉预览岛。
- 已开始旧侧纯计算提取：新增 cost-model.js，让旧 cost-page.js 先调用抽出的投影。尚未完成对等验证、S8 修正或 React 接入，不视为完成的增量。
- 尚未完成 A–G 的原 gallery 补充与本轮验证；生成 bundle 尚未重建，不能把上一轮预览结果当作本轮结果。
- 新 costHost / insightsHost / cost-summary / 费用页尚未接入。cost-ui 同 fixture 三连跑、五页像素比较、费用 after 对照及差异清单均未执行。
- 本次没有提交、合 main、远程写入、打包，也没有读取真实来源、账号或凭据。
