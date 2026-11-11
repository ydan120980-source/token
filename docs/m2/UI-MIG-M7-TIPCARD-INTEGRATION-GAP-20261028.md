# M7 TipCard 接入缺口 · 2026-10-28

**状态：所有者已批准第3节限定接入，实施与验证中。**

## 1. 新规则与现有基线

所有者要求用量页的趋势卡、热力图和时段格提示保留旧版内容及交互，内容使用TipCard，依据`UI-HOVER-20261028.md`第5节。

已从所有者的工作区`token/.claude/worktrees/inspiring-williamson-63e094`读完该文件。它在`ui/shell-cost-ref`，提交`a7cb1e38c28236b82b84a5b5f1306106cb43e3b0`，尚未合入main。共享main仍为`d079ae5`；当前M7在`ui/mig-m7`，已提交到`8e34e61`，有未提交的Host/React页面工作。

该记录明确撤销M7的“不用悬停卡片、指针处最多一个小胶囊”；要求趋势卡含标题、最多6行、已定价估算和说明；热力图及星期时段提示照旧；悬停与键盘等价，一次只有一个共用提示层。动效继续采用当前标准库。此条优先于M7原开工文件中的旧悬停限制。

## 2. 可复现的承载缺口

所有者提交中的`TipCard` API为`{ title, aside?, rows?, note? }`，每行`{ key, label, value, tone?, hatched?, pointed? }`。它是内容组件，自己不创建提示外壳。

当前分支：

- `LineChart variant="trend"`的tooltip仍由`CursorReadout`承载，固定`h-6`、横排、胶囊；只为spark启用了共用窗口层。
- Heatmap使用共用窗口层，但当前main的该层仍是横排胶囊。Claude在a7cb1e3中已把这层改回竖排卡片。
- Claude分支的LineChart trend目前也仍调用CursorReadout；因此仅等待TipCard文件或简单更换tooltip内容，不能解决趋势卡承载问题。

未改产品文件的隔离合成probe直接导入所有者已提交的TipCard，接到本分支的真实LineChart/Heatmap；无CSP放宽、无真实来源、无后端或IPC修改。

命令：`node .cache/m7-tipcard-probe-ui.cjs`，工具记录总耗时6.566秒，exit1。浅/深色×trend/heatmap均无页面错误；四个读数行的top完全相同，外壳高度24，所有行被横向挤进胶囊。断言失败：`TipCard rows must stack vertically within the chart tooltip carrier`。

原始证据：`artifacts/ui-mig/M7/kit-audit/tipcard/results.json`与`light-trend.png`、`light-heatmap.png`、`dark-trend.png`、`dark-heatmap.png`。原版趋势卡：`artifacts/ui-gate/M7/before-scenes-1180x850/light-scene-trend-keyboard-readout.png`；完整原版两尺寸场景保留。

## 3. 申请的最小范围，尚未应用

1. **复用所有者已提交的内容组件**：只取a7cb1e3的`ui/src/kit/hover-card.tsx`及`ui/src/kit/index.ts`的两条导出；不合入整个Claude分支，不带入费用/概览/widgets的其它改动。
2. **共用卡片层**：在`ui/src/kit/charts/common.tsx`的默认窗口提示层采用a7cb1e3已经裁定的卡片排布、样式和上方不足时翻转；保留当前费用参考路径。仅增加内部`placement="plot"`，调用现有`geometry.positionTooltip`把卡片放在图内并按原版约束避让。无新的公共组件属性。
3. **趋势通道**：`ui/src/kit/charts/line-chart.tsx`仅让默认`variant="trend"`的tooltip走同一窗口层的plot通道，指针和键盘使用同一内容；复用refresh更新当前key，key失效/离开/失焦/Escape/卸载时清理。stack/detail原有CursorReadout和spark通道保持原有规则。没有页面名称判断或新的参考模式。
4. **回归**：`ui/src/dev/kit-gallery-mkb.tsx`及`scripts/m1/ui-mkb-gallery-ui-test.js`补趋势、多行热力图/星期格的卡片、图边/窗口边避让、焦点/指针、三种动效模式、打开时数据刷新和一次一张检查。构建产物及裁决/交付记录随验证更新。
5. 批准后在M7的UMD中原样提取旧tooltip的排序、最多6项、零/未知计数、费用及说明文案，页面只传TipCard。继续完成M7及所有原门槛。

不新增token、色值、字体、尺寸或motion档位，不改vendor、设计守卫、费用页源码、额度页源码、后端、preload、IPC或真实数据。以上限定修复尚未应用。

## 4. 停止依据

所有者当前直接要求“必须加入kit的直接问我并给我截图”；计划§9.4要求“影响kit、规范、vendor、theme、tokens、设计检查，或影响后面多页：停止全部工作并提问”。虽然TipCard本身已获所有者规则支持，默认LineChart的图内卡片通道仍需修改kit，故将本限定接入范围单独交裁决。

当前Host/页面WIP完整保留；旧M6及Claude工作区未修改。不合main、不推送、不打包。

署名：Codex

## 5. 所有者裁决

所有者在核对原版与故障诊断图、听取第3节限定范围后，于2026-10-28明确回复“批准吧”。据此批准第3节全部限定接入和必要回归，随后继续M7。诊断图只是失败证据，正式视觉交付使用真实用量页的同数据、同尺寸、同交互状态前后图。不得把该批准扩展到其它kit接口、token、页面参考模式或Claude分支的整分支合入。

## 6. 接入进度与新停止点

第3节的限定接入已应用于未提交工作，隔离probe通过（exit0，3.635秒），完整gallery仍失败。新故障是旧`motion.js`的全局cleanup直接隐藏React提示层；该文件不在本次清单中，已保存实际用量页截图及失败结果，见`UI-MIG-M7-TIPCARD-SCROLL-OWNERSHIP-GAP-20261028.md`。在所有者裁定该唯一文件补充前停止产品工作。不能把上述局部进度写成M7或完整组件门槛通过。
