# M8 截图色彩配置不稳定与限定申请 · 2026-10-28

**状态：所有者 2026-10-28 已明确批准“上述截图准备修正，继续 M8”，修正独立提交19b3f74。sRGB复验和M8最终门槛已执行，结果见 §5 及 [最终交付](UI-MIG-M8-20261028.md)。以下d0a5ff5的失败与申请原文保留，不作为最新代码状态。M7未开始，交付后停止等待Claude。**

## 1. 实际结果

最新代码为 `ui/mig-m7-m8` 的 `d0a5ff5`。main 仍为 `0ac94cf2f8599188d03e0405ce55a00824c57ae2`，只读确认其工作树干净；没有操作受保护的 M6 工作区。

费用页同一份合成数据连跑三次通过，账本 SHA-256 均为 `033d1973fe6ae438fa3f4fafd05d6b7b70ac13fd622f4dccca57b1a654bd7162`，各次 renderer errors 为空、账本未改。实际命令：

```powershell
$env:COST_REPEAT='3'
$env:COST_EVIDENCE_DIR='artifacts/ui-mig/M8/reference-final/cost-v3'
node scripts/m1/cost-ui-test.js
```

日志为 `.cache/m8-reference-cost-triple-final-v3.log`，结构化结果为 `artifacts/ui-mig/M8/reference-final/cost-v3/repeat-results.json`。

随后完整 1180×850 图组捕获成功（62张 PNG），比较未通过：

```text
node scripts/m1/ui-pixel-gate.js compare artifacts/ui-gate/M8/reference-main-final/1180x850 artifacts/ui-gate/M8/reference-final-v3/1180x850 artifacts/ui-gate/M8/reference-final-v3/report-1180x850 --budget 0.002
62 pairs, 2 over budget 0.002
  dark-scene-cost-subscriptions.png 0.222% box [289,125,1067,802]
  dark-sources-page.png 0.784% box [290,181,1104,2063]
```

项目展开两色均为零差异。流程在比较失败后停止；该流程后续的 1440×900、最终 UI 套件批次及串行全量 verify 没有执行，不能称通过。此前运行结果和失败证据保留，不能替代本轮最后代码的完整验收。

## 2. PNG 原始证据

原图解析只读取 PNG 元数据和像素，没有改写、重编码或变换任何图像。完整路径、SHA-256、ICC 哈希、固定色块计数在 `artifacts/ui-gate/M8/reference-color-instability/profiles.json`。

| 图组 / 图片 | 内嵌 ICC 字节 | 固定遮挡色块原始 RGB | 像素数 |
|---|---:|---|---:|
| reference-main-20261028 / dark-sources-page | 0 | 255,0,255 | 16326 |
| reference-main-final / dark-sources-page | 536 | 228,69,246 | 16326 |
| reference-final-v2 / dark-sources-page | 536 | 228,69,246 | 16326 |
| reference-final-v3 / dark-sources-page | 0 | 255,0,255 | 16326 |
| reference-final-v3 / light-sources-page | 536 | 228,69,246 | 16326 |

带 ICC 的上述图均使用同一哈希 `85bc010ef338…`。工具中既有遮挡色仍是 `#ff00ff`，产品颜色值、比较算法、预算、通道阈值和遮挡范围均未修改；同一轮不同 Electron 窗口输出了不同的截图色彩配置。单纯重拍干净 main 没有消除不稳定。

补充诊断将既有、不带 ICC 的旧 main 原图与本轮不带 ICC 的两张候选原图逐字节复制到 `reference-color-instability/{before-raw,after-raw}`，使用同一个比较工具和门槛：

```text
node scripts/m1/ui-pixel-gate.js compare artifacts/ui-gate/M8/reference-color-instability/before-raw artifacts/ui-gate/M8/reference-color-instability/after-raw artifacts/ui-gate/M8/reference-color-instability/report --budget 0.002
2 pairs, 0 over budget 0.002
```

| 图 | 差异 |
|---|---:|
| dark-sources-page.png | 0.000% |
| dark-scene-cost-subscriptions.png | 0.061% |

这支持截图色彩配置是本轮超标的原因，不能把这个局部诊断拼接成最终图组，也不代替两尺寸完整重拍。没有选择性替换正式基线或正式候选图片。

## 3. 最小补充申请

只修改 **`scripts/m1/ui-pixel-gate.js` 的 capture 准备路径**：

1. 两侧 Electron 启动参数同样增加固定 `--force-color-profile=srgb`。
2. 在捕获 manifest 中记录这一固定参数，供审核复现；不增加按页面、主题或图片选择配置的接口。

不改产品源码、token、CSS 颜色、OS 显示设置、比较实现、统计日期、合成数值、状态、文案、几何、场景、遮挡或图片数量。不做截图后色彩转换，不删除失败证据，不增加 approved 差异，不改变 `budget=0.002`、`tolerance=24`。

批准后先对干净 main 做相同场景的重复捕获，检查配置稳定且 main 对 main 原样通过；再从 main 和当前候选完整重拍两尺寸全部124对，五个未改页面40对仍要求零差异。通过后继续剩余 UI 套件、串行 verify、runtime audit 和最终交付记录。若仍不稳定，保留原始失败并报告，不放宽门槛。

## 4. 为什么停下来

这次申请改变共用验收工具的启动准备，超出此前只固定来源检查时间和临时文件 mtime 的批准范围，并影响多页。按迁移计划 §0.3.4 的“必须动范围外的文件时，停下来说明原因”和 §9.4 的“影响后面多页：停止全部工作并提问”，当时停止全部工作并提出本申请。所有者随后明确批准 §3 的修改，现恢复 M8。不是新的 UI 设计、kit 接口、颜色或业务行为授权。

## 5. 批准后的实际结果

准备修正仅增加固定sRGB参数及manifest字段；没有改比较代码、0.002/24、遮挡、场景、产品颜色或OS设置。干净main自比较46对全部通过原门槛，92张PNG的输出profile一致；保留的非零差异均在y<40的顶栏焦点文字，不称全部原始像素相等。证据 `reference-srgb-self/report/`、`stability.json`。

最终候选7167d3f与干净main的两尺寸124对全部通过，费用84对最大差异0.091%。五个未改页面40对均通过原门槛，其中38对为0；1180深色设置页top/page两图分别有427/348个顶栏焦点文字差异，范围y16–26，页面正文为0。§3提出的额外“整图40对全零”目标未实现，完整原报告保留并明确交审，未选择性重拍换取全零，未新增遮挡、approved例外或固定焦点的工具改动。

最终完整原图、报告及SHA-256索引见 `artifacts/ui-gate/M8/reference-srgb-{main,candidate-v3,review}/` 和 `reference-srgb-report-v3-<尺寸>/`；最新命令、原报告全文、15个UI套件、业务三连跑、motion及verify/runtime结果全部在最终交付记录。本申请前的ICC失败原图不转换、不覆盖、不删除。
