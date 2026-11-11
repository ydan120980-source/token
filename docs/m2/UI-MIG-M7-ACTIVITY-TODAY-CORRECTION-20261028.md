# M7 活动与每日卡片：恢复旧版布局的限定补充 · 2026-10-28

**状态：所有者于2026-10-29明确批准两类限定补充，开始实施及完整M7验收。此前批准继续有效。**

## 1. 最新直接要求与图像

所有者明确要求：“当前Token 活动的设计和排版完全不如旧版,还有每日卡片,你只保留新版圆滑线条的隔离设计,其他的还是照搬旧版吧,记得不能不能发生Claude检查出来的问题”。

此要求收回之前在这两个区域自由混合新旧布局的设计选择：恢复旧版的信息组织、密度、列结构和交互；卡片采用当前共享kit的圆角/隔离，motion仍按此前明确选择的当前标准库。不将附图三中其它会话的数字作为当前分支事实，也不复制其中被批评的参考模式。

所有者原图已原样保存：

- `artifacts/ui-mig/M7/owner-activity-today-target/activity-reference.png`；
- `artifacts/ui-mig/M7/owner-activity-today-target/today-reference.png`；
- `artifacts/ui-mig/M7/owner-activity-today-target/maintenance-boundary.png`。

本分支真实页面现状已重新捕获：`node .cache/m7-activity-today-audit.cjs`，exit0、5.104秒，日志输出`{"captured":4,"errors":[]}`。1180×850、motion off、同一合成数据的浅深色活动/今日原图在`artifacts/ui-mig/M7/activity-today-audit/{light,dark}-{activity,today}.png`；另有results.json及同名log。它们是待纠正的实际页面，不是新设计交付。合成数据不等于所有者截图的真实数值，不能用数值分布差异冒充布局差异。

## 2. 恢复目标与现有能力

### Token 活动

- 日期范围在左，活跃/当前连续/最长连续/高峰三小时四项同行在右；标签和读数同行。
- 日历月份在格子下方，保留旧版空位、已记录零、未知、未来、选中/时段匹配与完整TipCard；不在年度日历左边额外铺一列星期。
- 圆点配色选择在左，低→高五级强度图例在右。
- 下方恢复“左侧星期×小时图、右侧三条事实”的排版；选中时段及日小时图继续占对应位置。窄屏在同一组件中自然排到上下，不复制第二套页面。
- 旧版“每天”“星期 × 小时 · 范围”等短标签按新直接要求恢复；必要旧操作说明按旧文字核对，不自行发明文案。

同行事实、两栏与窄屏布局可用现有Card、SectionHeader、ListRow、Value和普通布局容器完成。五级强度图例可复用下面fit-square能力下的一行只读Heatmap，不需要另造图形或颜色。

当前Heatmap没有下面两项能力：列标签永远在顶部；weekHour宽度至少为667、格子24×20。放进旧版左栏会产生内部横向滚动，且不是旧方格。仅在页面外面缩放或覆盖内部SVG样式，会把布局藏进专用路径，不能这样实现。

### 今日与选中日期卡片

- 标题、日期在左；Token/估算/记录/会话四项紧凑排在同一标题行右侧，移除单独一排大指标。
- 恢复“模型 / 占比 / 输出 / 缓存命中 / Token / 估算”的列头，Agent汇总与模型行的最后两列对齐。
- Agent名称旁保留会话入口与记录数；模型树形缩进、份额小条、精确金额上下界、未知状态和每日明细滚动继续保留。
- 用现有DataTable/ListRow/Badge/StackBar/Value/Figure/Reveal/ScrollArea组合；数据投影留在UMD。现有接口足够，此区域不申请新增kit API或专用CSS。

## 3. 申请A：Heatmap两项通用接口

仅修改`ui/src/kit/charts/heatmap.tsx`：

1. `colLabelsPosition?: "top" | "bottom"`，默认`"top"`。只调整既有列标签与格子原点的位置，保留现有标签区20px及字体/间距；底部仍使用原标签区，不增留白。
2. `sizing?: "default" | "fit-square"`，默认`"default"`。启用时以当前容器可用宽度、现有labelWidth与3px gap计算格宽，格高等于格宽；保留现有4px圆角、等级、颜色、选择和提示生命周期。隐藏时采用只保证合法正几何的派生下限，显示后由现有ResizeObserver测量；不写用量页宽度或断点判断。

M7的年度日历、星期小时使用底部标签；星期小时和只读五级图例使用fit-square。其它调用默认行为不变。新增回归检查窄栏下无无意横向溢出、方格、标签在底部且不重叠、未知/未来/选中、焦点/指针及三模式。

## 4. 申请B：通用SwatchGroup与原4色映射

新增`ui/src/kit/swatch-group.tsx`，在index.ts导出：

`SwatchGroup({ value, onChange, items: { value, label, tone: ChartTone }[], "aria-label" })`。

它是通用颜色单选控件：radio语义、名称/原生title、方向键/Home/End、同一Tab入口和IME保护；采用现有36px控件命中区域。色点保留旧16px，选中外环按旧polish.css的2px环及3.5px间隙几何计算；motion使用现有fast/off规则，不移植旧220ms值。不识别页面、路由、aria-label文字或父容器，不创建参考模式。

原4色没有现有ChartTone，申请在已批准同类文件`tokens.css`、`theme/index.css`和`charts/tones.ts`再增加4项共享映射：

| tone | token | 值 | 原始依据 |
|---|---|---|---|
| palette:orange | --palette-orange | #d9824a | d079ae5:index.html heatColor option data-swatch |
| palette:blue | --palette-blue | #5f81bd | 同上 |
| palette:green | --palette-green | #5f9672 | 同上 |
| palette:mono | --palette-mono | #8a9099 | 同上 |

这些值只标识四个配色选择，与已批准15色、现有C蓝阶、Agent色及实际heat0–4不互相覆盖。浅深色照旧使用同4个色点。实际格子的配色仍由现有Host规则决定，不重写色阶。

对应现有MK-b展示页与套件补单选、键盘、IME、可见/可读名称、色点/环几何、两主题和三模式检查；正常构建更新生成物。除此之外不新增公共控件参数。

## 5. 范围、验收与维护约束

新增共享范围仅为第3、4节：Heatmap、新SwatchGroup及index导出、4色的token/theme/tone映射、既有gallery/套件和正常生成物。M7页面/数据类型/纯计算/测试/记录继续在原范围内改。

严格不新增UsageReferenceProvider、用量专用参考CSS、页面识别分支或旧renderer挂载；不把费用参考代码复制/扩展到M7。页面只组合共享kit，不写hover、inline style或颜色字面量。新共享组件只根据公开props工作，当前默认调用保持原样。不改vendor、guard/allow-list、后端、preload、IPC、真实数据或其它五页产品代码。

完成后提供实际页面的两尺寸、深浅色、同数据同状态对照，包含默认活动、点日、点时段、每日明细与今日表格；检查紧凑同行和两栏、列对齐、方格、月份、强度和色点选择，以及完整提示/键盘/滚动。原套件、五个未改页面的像素门槛、断言逐条映射和最终Claude审核不变；不以当前中间图或局部通过代替M7交付。

## 6. 当前验证事实

之前已完成：实际趋势两尺寸/两主题/指针键盘滚动检查；TipCard gallery和foundation；usage、agent-recovery、statistics-worker；修正时钟准备后的activity及模板usage-smoke。证据在`artifacts/ui-mig/M7/`的对应logs/runs.json。

仍未完成：全量verify/runtime、其余页面套件、最终像素比较与断言映射。最近typecheck暴露新增份额条的tone字符串推断问题，尚待补类型；layout仍保留活动块在1250×1000时top987.612低于原1000门槛的失败，及测试读取SVGRect.toJSON不受支持的问题。均未放宽门槛或记为通过。当前新布局尚未实施，不能据旧中间图声称交审完成。

## 7. 停止依据

所有者保留的要求是“必须加入kit的直接问我并给我截图”；计划§9.4要求影响kit/theme/token时停止全部工作并提问。此前只批准了Heatmap读数刷新、TipCard承载、共享15色和motion隔离，未批准本记录的新接口/控件/4色。因此只读核对并保存现状后停止，等待这份限定补充的明确答复。

署名：Codex

## 8. 所有者裁决

2026-10-29，所有者针对本记录第3、4节的明确申请回复“批准”。据此实施Heatmap两项通用接口、SwatchGroup及原四色映射，再按旧版目标重排活动和每日卡片、继续完成M7。批准不扩展到参考模式、专用CSS、页面判断、其它共享接口或其它五页；原门槛、断言映射及最终Claude审核继续保留。

## 9. 2026-10-29 同类补充的持续授权

所有者明确指示：“接下来类似的批准不用问我了，保证不发生Claude之前检查出来的问题导致还要重迁移和对标旧版设计就行”。据此，本次 M7 内为恢复既有布局、信息和交互而必需的同类共享组件、接口、token 补充，可记录后直接实施和验证，无须逐项重复申请。边界仍是可复用的通用能力；不新增用量页参考模式、专用样式表或按页面识别切换的 kit 分支。不扩大后端、IPC、vendor、设计检查、真实数据及其它五页范围。

本轮另行记录两项同类复用：DataTable 将 vendor 已有的 compact 档透传（默认保持 default），用于六列紧凑表格；把 ListRow 内原有树形 SVG 提取为 TreeBranch 并由 ListRow 复用，用于模型名称列。几何与默认输出保持原值，无 vendor 修改。首屏概览容器保留一屏的最小布局；活动区使用普通网格和共享组件重排，不以空白占位节点凑测试。

真实截图发现通用 TableCell 的 normal 可变字重会覆盖子元素 font-semibold，因此 DataTable 增加可选 rowEmphasis(row)。只在显式强调行的单元格使用库里现成的 semibold 字重和 foreground；默认不变，不修改 vendor。用于 Agent 汇总行与其模型子行的既有层级，数值和表格列仍共享。

键盘核对补充：旧日历的左/右按列移动 7 天，上/下按行移动 1 天；不能为了适应 kit 默认的日期顺序导航，把原键盘断言改成另一方向键。因此 Heatmap 新增通用 navigation?: chronological | grid（默认 chronological，保留其它调用方）；用量日历显式选 grid，并恢复原 ArrowLeft→前 7 天断言。遵守本节持续授权，不增加页面识别分支或 vendor 修改。

导航兼容修复（合成实测）：polish 保存 scrollY=500，后退调用 scrollTo(500) 时页面高度仅 850、React 用量根尚未出现，目标被旧 scrollTo 夹到 0；提交完成后高度已 3117，但没有再次恢复。原失败 JSON 位于 artifacts/ui-mig/M7/polish-history-diagnostic-r2。window-shell 仅在回到本次迁移的 usage 路由时，将已有 scrollTo 调用延到下一帧；离开页面取消待恢复帧并核对当前路由，其它路由仍原时序。保留原差值 <2 的断言，测试等待实际滚动启动后再读终态。不迁移 M9，不改滚动曲线、参数、其它页或 vendor。

同一轮 detail 验证补充：用量 locate 沿用 M3 的浏览器原生 smooth，但原生滚动没有纳入旧 uiDetail 的取消监听；真实滚轮输入后仍会继续向明细移动。仅在用量页面自己的 locate 生命周期内跟踪正在定位，遇到滚轮、触摸、指针按下、页面滚动键或离开页面时取消待执行帧并在当前坐标停止；scrollend 清理状态，卸载移除监听。当前标准库和原生 smooth 参数不变，不给其它页面增加监听语义。合成测试以真实 wheel 到达时的坐标为准，检验后续未继续前进且终态稳定，不把滚轮本身的正常位移当成失败。

最后的原样核对修正：旧 swatch 的 16px 圆点、伪元素 inset -3.5px、向外 2px box-shadow，等价 SVG 环的中心半径为 12.5（外半径13.5），不是初版换算的11.5。已按原值纠正并补几何断言，不增加颜色/token。S4 的未知传播同时覆盖模型占比、最近30天提示和时段/小时读数：未知总量不转成0%或“无用量”，有已知部分则保留原部分标记；计数与 streak/peak 仍由原 insights-math 计算，后端与原始记录未修改。
