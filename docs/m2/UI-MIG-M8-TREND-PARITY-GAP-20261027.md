# M8 费用走势实图接缝 · 2026-10-27

**状态：所有者 2026-10-27 已批准 §2 A / B 两组最小补充，要求记录后继续 M8。** 批准仅涵盖这两组，未授权其它 kit、色值、字号、尺寸或数据语义改动。以下保留修复前候选 `2589eef9f15d269ab8be8e480f6d6349004abc6e` 的证据；不把这些失败实图算作通过，也不自行批准其它费用视觉差异。M7 未开始。

## 1. 实图与源码证据

使用同一合成 fixture、`2026-10-26T11:51:00Z`、motion off、既有时间遮挡：

- 原图：`artifacts/ui-gate/M8/stable-main-a/1180x850/light-cost-page.png`，main `0ac94cf`，dirty false。
- 候选：`artifacts/ui-gate/M8/candidate-delivery/1180x850/light-cost-page.png`，`2589eef`，dirty false。
- 两种尺寸、两色的费用图对浏览入口：`artifacts/ui-gate/M8/review/index.html`，84 对完整原图及 SHA-256（18 个必拍场景，另加首屏本月 C 页）。
- 五个未改页面已在本候选上重新比较：两种尺寸各 20 对，差异像素均为 0，预算 0.002、色差阈值 24，无批准例外、无缺图。报告 `artifacts/ui-gate/M8/unchanged-delivery/<尺寸>/report/report.{json,md}`。

| 接缝 | main 的原规则 | 当前 kit 的规则与实际影响 |
|---|---|---|
| 堆叠面积的连续区间 | 原 `cost-stack.js` 的 geometry 先判断桶中是否至少有一个已计价值；堆叠面积按整桶总量的 runs 绘制。某 Agent 当桶没有自己的数值，仅在几何累积时不增加高度；业务值仍为 null，读数仍显示没有记录 / 未计入。整桶没有已计价值才断开。 | `line-chart.tsx` 对每条 series 单独以 `value !== null` 分 runs。候选蓝色顶线因此在某个 Agent 缺记录、但其它 Agent 有已计价值的桶处断开，而 main 在这些位置连续。 |
| 折线的缺口连接 | 原非堆叠折线按各自已知值分 runs，并对相邻已知 runs 画虚线桥；堆叠面积跨整桶缺口还保留渐变桥的旧绘制。 | 当前 bridges 只在中间所有 x 点都标为 missing 时生成；Agent 自己缺值但其它 Agent 有记录时，没有虚线桥。不是金额计算变化。 |
| 轴下 partial 刻线 | `cost.css:376`：`fill: var(--warn); opacity: .85`。形状为 2×5、rx1。 | `line-chart.tsx` 49 行用 `fill-muted-foreground`，实图由原警示色变为灰色；形状未变。违反最高裁决“配色不改”。 |
| 指针线 | `cost.css:377`：`stroke: var(--text); stroke-opacity: .3; stroke-dasharray: 3 3`。 | `line-chart.tsx` 的 cursor 用 `stroke-muted-foreground`、`3 4`，未表达原色和透明度。源码可证，尚未把该指针状态作为独立正式场景图；已有交互测试不等同配色一致。 |

原始旧脚本已在候选退役，上述旧源码可用 `git show 0ac94cf:design/desktop-reference/cost-stack.js` 核对。`cost-model.trendView()` 仍保留每个 Agent 的 null，金额计算、范围合计与各 Agent 读数没有通过补零绕过。本轮不申请修改这些数据语义。

## 2. 请求的两组最小补充

**A. 只校准 `LineChart variant="stack" palette="cost"` 的旧费用绘制：**

- stacked 面积按整桶是否有已计价值分 runs；某个 Agent 没有自己的值时，只在堆叠几何中不增加高度，保留其原业务 null、完整读数和图例文字。
- 折线仍按各 Agent 自身已知值分 runs，恢复原相邻 runs 的虚线桥；整桶未知仍是缺口，不生成金额 0。面积缺口桥按旧绘制恢复。
- 不改其它 palette / variant 的默认行为、不新增公共属性、不改系列顺序、坐标范围、数据动效、刷选或键盘语义。

**B. 补齐同一 cost/stack 绘制的原色映射：**

- 新增 `cost:warn → 原 --warn`、`cost:text → 原 --text` 两个命名映射，不新增或改变色值。
- partial 刻线使用原 warn / .85；cursor 使用原 text / .3 / 3 3，尺寸、位置和触发不变。
- 默认 palette 不变，其它页面不传 cost 不受影响。不改 vendor、设计检查、额度页、后端、preload 或 IPC。

可能涉及的文件仅为 `ui/src/kit/charts/line-chart.tsx`、必要的纯几何辅助 `geometry.ts`、`tones.ts`、`ui/src/theme/index.css`，以及对应 `tests/m1/chart-geometry.test.js`、真实 kit gallery / 费用回归、构建产物和本页记录。若需要此列表以外的 kit / token / 规范改动，重新停止提问。

批准后保留这次失败实图，补合成 SVG 回归覆盖“单个 Agent 无记录、整桶未知、非堆叠自身缺口”并验证 null / 金额不变，复跑受影响费用与共享门槛、同 fixture 三连跑和五页像素对照。现有 Windows Job 原断言的基线阻塞另见 `UI-MIG-M8-VERIFY-BLOCKER-20261027.md`，本申请不包含任何后端修复或门槛豁免。

## 3. 当时暂停的依据（现已明确批准）

计划 §9.4：**“影响 kit、规范、vendor、theme、tokens、设计检查，或影响后面多页：停止全部工作并提问。不得自己扩展 kit 接口、加设计例外或换写法。”**

上述两组在申请时不在原 A–G、COLOR / CHART / LIVE-READOUT / PIXEL-CLOCK 裁决的逐项列表内，不能用“继续 M8”推定新的 kit 修改授权，因此当时停止并申请这两组，随后得到所有者明确批准。其它字号、读数排列、图例位置等可见差异列入交付记录，仍交 Claude 看图审核，不自行批准。

## 4. 批准后的实施与独立验证

已按所有者明确批准实施 §2 A / B：费用 stack 专用纯几何函数保留原数组中的 null / 0，堆叠只按整桶未知断开；独立折线仍按 Agent 自身分段，恢复相邻 runs 的虚线桥和旧面积缺口桥。默认 palette 沿原路径，公共属性未增加。cost:warn / cost:text 仅映射原 --warn / --text，partial 和 cursor 沿旧绘制。

纯几何回归已通过，覆盖某 Agent 缺记录但其它 Agent 有金额、整桶未知、明确为零、独立折线缺口和输入数组不可变。真实 gallery 在深浅两色检查实际 SVG 连续区间、桥数量、默认 palette 不变，以及原颜色、透明度和虚线，通过日志 `.cache/m8-trend-gallery-third.log`、结果 `artifacts/ui-mig/M8/trend-fix/gallery/results.json`。

第一轮 gallery 发现 warn 声明在 body，普通 @theme 在文档根过早解析导致黑色；两个新映射改用既有 @theme inline，在实际绘制节点读取旧变量，原失败断言保留。第二轮测试 fixture 漏接受控 active，导致按 Home 后没有 cursor；补齐既有 active/onActiveChange 后完整通过，未修改产品焦点逻辑。失败日志 m8-trend-gallery-first / second 保留。其它门槛和最终截图仍以交付记录的实际结果为准。

批准后已重新通过：cost 同 fixture 三连跑、cost-smoke / layout / compact / composition / rebuild、workbench、budget-overview、renderer-lifecycle、cost-live-readout、render-performance，以及 foundation、kit / MK-b / M8 gallery 和 unpriced-guidance，结构化结果在 `artifacts/ui-mig/M8/trend-fix/`。最终三连跑 seed SHA-256：`7675ac3586b79b54adab6f12bef16b7a694992c6e2917de6b3fb69df9b832e45`。

最后串行 verify 仍只有干净 main 可复现的 Windows Job 原断言失败；lint、类型、bundle 精确重建及其它测试通过，runtime audit 通过。该后端问题不在本次批准中，未修改。最终候选图、五页像素比较和完整差异清单随后写入 `UI-MIG-M8-20261027.md`，保持 M8 后停止。
