# M7 热力图打开读数刷新缺口 · 2026-10-28

**状态：所有者已明确批准第3节三个文件的最小修复，修复与组件门槛通过。** 原失败与停工依据保留在下文；批准答复为“批准上述最小修复，记录后继续M7”。允许Heatmap复用既有refresh、配gallery焦点/指针/key移除回归；其它接口、颜色、token、common、vendor、guard、后端和IPC范围不扩展。

## 1. 实测结果

使用当前未修改的 `ui/src/kit/charts/heatmap.tsx`、现有UiProviders和已提交CSS，另行打包一个仅供本地诊断的最小React入口。通过ui-smoke启动独立合成home / usage / quota，再打开sandbox、contextIsolation的本地测试窗口；没有改产品CSP、读真实数据或查询账号。

每个模式先聚焦同一个格，读数为2 Token；保持焦点和key，把props中的值/完整label/tooltip改为6 Token；等待标签确认更新和两个真实动画帧，再移除这个key。

| 模式 | 更新后的格aria-label | 打开的胶囊 | 胶囊节点相同 | 焦点保留 | 删除格后anchor连接 | 删除格后胶囊数 |
|---|---|---|---|---|---|---:|
| calendar | 6 Token | **2 Token（旧值）** | true | true | false | **1** |
| weekHour | 6 Token | **2 Token（旧值）** | true | true | false | **1** |

实际命令：`node .cache/m7-heatmap-probe-ui.cjs`。整个命令exit 1、30.493秒、1465字节日志；其中results.json的0.472秒仅是两个变体的浏览器观测阶段，不能冒充命令总时长。失败断言保留：`Heatmap must refresh its open confirmed readout and clear a removed key`。没有pageerror。不是通过记录。

证据：

- `artifacts/ui-mig/M7/kit-audit/heatmap/results.json`
- `artifacts/ui-mig/M7/kit-audit/heatmap/{calendar,weekHour}-{before,refreshed}.png`
- `artifacts/ui-gate/M7/heatmap-probe.log`、`heatmap-probe-run.json`
- 临时入口/驱动：`.cache/m7-heatmap-probe.tsx`、`.cache/m7-heatmap-probe-ui.cjs`；不进入产品或提交。

## 2. 当前源码原因与M7需要

Heatmap只在pointer/focus的show中取得 `tooltip(key)` / cell.label；当前props变化时没有刷新已打开的共享提示。`common.tsx`的共享层保留打开时的ReactNode，已经提供 `refresh(resolve, exists)`，由StackBar、BarChart及LineChart相关路径使用；Heatmap尚未调用它。移除当前key时，Heatmap本身仍挂载，且不存在的格没有后续pointer/focus事件来清理旧提示。

M7的日历、周×小时必须在保存数据刷新、小时数据到达和筛选变化后继续显示已确认数据，且键盘焦点读数与单元格值一致。仅在页面替换图key或重挂组件会丢失原焦点/状态、重播动效；用pointermove强行触发也不能解决静止键盘焦点。不能以这些方式绕过kit缺口。

## 3. 申请的最小范围，尚未应用

1. 仅在 `ui/src/kit/charts/heatmap.tsx` 内复用现有共享层refresh：cells / tooltip变化后，用当前key重新取得当前tooltip或label；key不存在或变为不可交互时清理。
2. 保持原提示节点、焦点、锚点、位置、显示状态和进入次数，不重播入场；不增加公共属性、token、颜色、尺寸、文案、动效或M7专用参考分支。
3. `ui/src/dev/kit-gallery-mkb.tsx` 与 `scripts/m1/ui-mkb-gallery-ui-test.js` 补两变体的真实焦点/指针刷新及key移除断言。保留本次失败条件，验证reduced/off与现有交互。没有理由修改common、其它图表、vendor或guard。
4. 批准后构建、verify、foundation、MK-b gallery，恢复M7接口核对、必拍场景与页面迁移；五个未改页面仍过原像素门槛。

## 4. 停止依据

`UI-MIG-M7-KICKOFF-20261028.md` §4要求“需要扩展 kit、新增 token 或设计检查例外时，按计划 9.4 停下来提问”。计划§9.4原文：“影响 kit、规范、vendor、theme、tokens、设计检查，或影响后面多页：停止全部工作并提问。”本申请只修既有Heatmap内部生命周期，也影响kit，因此需该限定范围裁决；现有M8对StackBar/BarChart/LineChart的授权不包含Heatmap。

署名：Codex

## 5. 获批实施与实际复跑

Heatmap新增只依赖cells / tooltip的layout effect，调用现有refresh；key不存在或disabled时清理。展示页新增两个独立合成夹具，calendar使用tooltip回调，weekHour覆盖label回退。真实画廊回归覆盖两主题×两变体×full / reduced / off×focus / pointer：2→6读数更新，原提示节点、焦点、left/top和data-enter-count保持，打开胶囊不再淡入，移除/禁用key均清理。没有修改公共API或common。

`build:ui`及相关测试脚本ESLint通过；生成物只有agent-ui.js变化，CSS及许可证未变。串行命令/完整结果在 `artifacts/ui-mig/M7/heatmap-fix-gates/runs.json`：

| 命令 | exit | 总秒数 | 日志字节 | 实际结果 |
|---|---:|---:|---:|---|
| `node .cache/m7-heatmap-probe-ui.cjs`（输出到heatmap-fix-gates/probe） | 0 | 11.561 | 856 | 两种原失败场景均为6 Token，key移除后tooltipCount=0；节点及焦点保留 |
| `node scripts/m1/ui-mkb-gallery-ui-test.js` | 0 | 59.159 | 735 | 新旧图表、键盘/指针、三种模式、两主题通过 |
| `node scripts/m1/ui-foundation-ui-test.js` | 0 | 9.731 | 287 | foundation通过；按新规则不设10秒门槛 |
| `npm.cmd run verify` | 0 | 44.326 | 61768 | lint / typecheck / build一致性及单元测试fail 0 |
| `npm.cmd run audit:runtime` | 0 | 0.396 | 182 | runtime PASS |

所有日志非空且有结果输出。原失败证据未覆盖；没有真实来源、账号、打包或远程操作。该裁决已解决，继续M7接口复核和必拍场景，尚不代表M7页面完成。
