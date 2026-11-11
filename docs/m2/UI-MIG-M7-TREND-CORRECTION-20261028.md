# M7 趋势图纠正：旧版信息组织与共享组件 · 2026-10-28

**状态：所有者已明确批准第3、4节两项限定补充，开始实施。完整M7尚未完成。**

## 1. 最新所有者要求与参考

所有者指出当前迁移的趋势图颜色单一、纵向图例留白过多、没有完整悬停卡片、没有Y轴介绍，要求改好，改不好就照旧版做；明确禁止重复费用迁移的维护问题。原话及附图是本次直接所有者指令，图二其它会话中的数字与结论只作为维护约束的说明，不当作本分支当前事实。

图一的趋势图是当前明确工作参考：输入蓝、输出绿、缓存读取紫、缓存写入黄、估算费用粉；Token在左轴，美元在右轴；图内完整提示卡；底部横向紧凑图例。沿用此前“motion用当前的标准库就行”。本记录不申请更换卡片、字体、尺寸或动效。

附件原图已原样保存在忽略的证据目录：

- `artifacts/ui-mig/M7/owner-trend-target/trend-reference.png`；
- `artifacts/ui-mig/M7/owner-trend-target/maintenance-boundary.png`。

现有真实基线同样展示上述信息组织：`artifacts/ui-gate/M7/before-scenes-1180x850/light-scene-trend-keyboard-readout.png`。本记录只做只读源码核对与裁决准备，没有恢复旧DOM renderer，也没有修改旧M6或Claude工作区。

## 2. 四个缺项与承载核对

| 缺项 | 当前源码原因 | 正确承载 | 是否需要新增接口 |
|---|---|---|---|
| 颜色单一 | `usage-model.js`把构成映射到当前C蓝阶category，模型全部ink:1 | 原版趋势色提为通用共享ChartTone，折线/图例/TipCard传同一个tone | 需要本记录§3的颜色映射；不得直接改现有category色 |
| 图例纵向、留白过多 | `pages/usage/trend.tsx`没有传variant，采用ChartLegend默认list | 直接传现有`variant="inline"`，布局容器居中；窄屏自然换行 | 不需要 |
| Y轴没有刻度和单位 | 没有传LineChart现有ticks，组件只计算了几何最大值 | UMD提供左右轴格式化标签，传`ticks.left/right`；页内显示Token/美元轴说明 | 不需要 |
| 提示只有日期 | 页面tooltip只返回readout.label，没有传已提取的完整内容 | 传既有TipCard；原排序/最多6项/费用/零与未知/说明来自UMD | TipCard接入已批准，无需重复申请；滚动隔离见§4 |

上面三项接线遗漏属于M7未完成工作，不能把它们写成组件能力限制或迁移不可避免的损失。图表上方重复铺开的分项读数应随完整卡片接入收拢，保留必要的当前点无障碍读数，不再占一行重复全部分类。当前无新页面设计交付或完整门槛通过结论。

## 3. 新申请：仅补通用的分类颜色映射

申请文件限定为：

- `design/desktop-reference/tokens.css`：只新增下表token，不改现有C蓝阶、category、Agent、费用、热力图或其它token；
- `ui/src/theme/index.css`：只增加同名Tailwind颜色映射；
- `ui/src/kit/charts/tones.ts`：只扩展ChartTone联合与fill/stroke/background查表，不增加页面条件、palette模式、Provider或绘图分支；
- 既有MK-b展示页/套件和纯UMD测试：增加颜色一致性与身份稳定性回归；正常构建更新生成物。

构成分类tone与token：

| ChartTone | token | 色值 |
|---|---|---|
| measure:input | --measure-input | #5998e0 |
| measure:output | --measure-output | #63ad95 |
| measure:cacheRead | --measure-cache-read | #9575df |
| measure:cacheWrite | --measure-cache-write | #d9ab59 |
| measure:estimate | --measure-estimate | #dd7b84 |

五个值均逐字来自`d079ae5:design/desktop-reference/preview.js`的fields与cost selected项，不从截图估色，不重新设计浅深色调色板。旧实现两种主题使用相同五值；此处照旧。名称表示度量类别，不表示页面或好坏。

模型模式也应能区分系列，申请同时提取原`modelColor`的固定10色：`model:0`至`model:9`，token为`--model-0`至`--model-9`，依次为：

`#5d8dcc, #599981, #c18b53, #bd796a, #9172b2, #57a2b4, #af8e41, #888fac, #a1778f, #72964a`。

顺序与值均逐字来自同一基线`modelColor`。现有31倍hash在UMD中提取，模型身份始终映射同色，不按当前排序重新分配。总量仍用现有ink，其他合并项用现有muted；Agent配色保持现有规则。只移植旧图的分类辨识能力，不改变金额、Token或未知的计算语义。

需要独立分类色的原因：当前category蓝阶也供其它页面/小组件使用，直接覆盖它会改变未迁移页面；Agent色只标识Agent，不能借其名字给输入/输出上色。新增共享的语义颜色可直接通过所有现有kit图表和TipCard的tone使用，没有用量页专用绘制方式。

## 4. 合并此前唯一待决项：滚动归属

`UI-MIG-M7-TIPCARD-SCROLL-OWNERSHIP-GAP-20261028.md`第3节仍待批准：只把`motion.js`的旧cleanup对`[data-ui-portal]`内节点的直接隐藏排除，由React层管理生命周期。它与当前颜色申请合为一次明确的范围裁决，避免遗漏其中一项。旧DOM提示、当前费用参考路径、scroll/resize/visibility监听和动效参数保持原逻辑。

本记录不把所有者对视觉质量的纠正解释为静默批准任何范围外文件。上述四个产品文件的补丁均尚未应用；此前获准的TipCard及页面WIP完整保留。

## 5. 维护与验收约束

- 页面仅传数据、tone、ticks、TipCard内容与现有inline图例；不写`usage-reference.css`或同类专用样式，不新增UsageReferenceProvider，不借用CostReferenceProvider，不在kit中识别用量页、路由、aria-label或父容器来选择绘制方式。
- 新颜色只是同一套组件的共享查表项。页面不硬编码颜色、字体、尺寸或motion；不改vendor、guard、allow-list、后端、preload或IPC。
- 实际用量页核对浅深色、1180×850及1440×900、构成/总量/模型、Token/费用、每日/均值/累计；系列、图例和提示行颜色一致；左右轴标签可见且表示真实刻度；图例紧凑横排，控件/文字/图形无裁切。
- 完整TipCard内容按旧版排序、合计、费用、零/未知和缺口说明；指针与键盘等价；保持焦点刷新不换节点/焦点/位置、不重播入场；滚动、离开、Escape、点移除、跨图归属和卸载有真实回归。
- motion使用当前标准库的full/reduced/off与data档。图像验收使用实际页面、同数据/尺寸/交互的旧版与候选图，不以隔离诊断图作为视觉交付。
- 五个未改页面仍跑原两尺寸像素门槛；保留原预算、阈值、图对和遮挡。执行M7原定全部套件、verify/runtime与冒烟，记录真实结果，再停止交Claude审核。不合main、不推送、不打包、不读真实来源。

## 6. 当前停止依据

计划§0.3.4要求范围外文件先说明；§9.4要求影响kit/theme/token时停止全部工作并提问。所有者也明确要求必须加入kit的直接提问并附截图。现有原版截图及所有者图一已足以说明目标与缺口，申请仅为第3、4节的明确接口/文件范围；没有另行请求设计选择或放宽门槛。

署名：Codex

## 7. 所有者裁决

所有者于2026-10-28明确选择：“批准这两项，按旧版目标修好并继续 M7（推荐）”。授权第3节共享15色查表与第4节motion.js隔离，以及限定回归；已有inline图例、ticks和TipCard直接接入。继续完整M7后停止交Claude审核；不新增参考模式、页面分支、专用CSS，也不扩大其它边界。
