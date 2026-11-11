# M8 像素门槛的来源时间不确定性 · 2026-10-27

状态：所有者 2026-10-27 已批准 §2 最小时间固定，要求记录后继续 M8。只修改 capture 准备逻辑；预算、色差阈值、遮挡和产品页面不因本问题改变。M8 功能实现已提交 `70e017efd19e54f39d954033f3408edd312623ab`；M7 未开始。以下原失败证据保留。

## 1. 已执行的对照

所有截图使用既有 `ui-pixel-gate.js`、同一合成 fixture、既有冻结时刻 `2026-10-26T11:51:00.000Z`、motion off、light/dark；没有读取真实来源或账号。

| 对照 | 结果 | 原始证据 |
|---|---|---|
| 原始干净 main `0ac94cf` → 候选 `70e017e`，1180×850，五个未改页面 | 20 对中来源页两张整页图超 0.002；light 0.368%，dark 0.395%；其余 18 对通过 | `artifacts/ui-gate/M8/diff/1180x850/report.json` 与 `report.md` |
| 同上，1440×900 | 20 对全部通过 | `artifacts/ui-gate/M8/diff/1440x900/report.json` 与 `report.md` |
| 同一个干净 main `0ac94cf` 的来源页复拍 → 原始 main 来源页 | 4 对中同样两张整页图超标；light 0.396%，dark 0.402% | `artifacts/ui-gate/M8/baseline-selfcheck/1180x850/report/report.json` |
| 该次 main 来源页复拍 → 候选来源页 | 4 对全部通过 | `artifacts/ui-gate/M8/baseline-repeat/1180x850/candidate-report/report.json` |
| 完整重拍 main 基线后再比较候选，1180×850 | 仍有来源页两张略超标；light 0.268%，dark 0.227%；其余 18 对通过 | `artifacts/ui-gate/M8/diff-final/1180x850/report.json` |

原始基线、复拍基线、候选截图、复制索引和每次失败报告均保留，未删除任何图对，也没有只选通过的一次作为最终验收。复制的未改页面 PNG 均做过 SHA-256 一致性核对。

原始差异像素为 light 10052、dark 10795；诊断中均位于时间遮挡及其后相邻文字的行内范围，范围为 x619–909、y184–2063。这项诊断没有修改图片或参与 pass 判定。结合 main 对 main 自身也失败，说明当前门槛存在与 M8 页面迁移无关的时间不确定性。

工具本身在头部注释已说明主进程的文件检查/修改时间未冻结，使用既有文字遮挡处理。当前真实时间文字宽度及后续文字位置会变化，原有遮挡未使整页图稳定。尚未改动或独立确认具体时间字段的完整白名单，因此不把推断写成产品回归已修复。

## 2. 最小申请

允许仅在合成像素截图的 capture 准备阶段，固定来源检查的展示时间元数据及合成 fixture 生成的文件 mtime，使用工具已经存在的 `FIXED_TIME`：

1. 先核对并记录具体时间字段白名单，只处理来源/文件检查时间；不改变用量记录日期、数值、价格、状态、文本或几何。
2. 优先沿工具现有 Electron/IPC 合成注入方式处理展示时间；文件时间只作用于工具创建的临时 fixture home。不得读取或修改真实来源。
3. 不修改产品 renderer、后端、preload、IPC 合同、vendor、theme、token 或设计检查规则；不更改 0.002 预算、24 色差阈值、已有遮挡或图对集合。
4. 先证明同一个干净 main 的两次完整捕获稳定，再重拍 main 与候选的两种尺寸并比较；保留上述全部原失败证据。
5. 测试准备逻辑的修正单独以 `M8:` 提交，记录对基线的影响；不是允许任何页面视觉差异或放宽验收。

批准后的字段白名单：`usage:sources` 返回的 `SourceDiscoveryV1.checkedAt`（只复制返回对象该字段，不改主进程缓存）；临时 fixture home 内常规文件的 mtime。`sources[].latest`、`sources[].paths[].latest` 由原发现逻辑读取固定 mtime 自然得出，不覆盖其它发现结果。`statuses[].lastSuccess` 已由原 fixture 的冻结时钟生成，不覆盖。保留未知时间 null。

源码依据：`src/m1/discovery.js` 的 describe 用 `fs.statSync(file).mtimeMs` 计算 latest；discover 返回 checkedAt；`design/desktop-reference/sources-ui.js` 的 sourceLine/render 分别显示 latest、lastSuccess 和 checkedAt。IPC 的 `usage:sources` 直接返回 SourceDiscoveryV1，不使用额度接口的 `{ok,state}` 包装。

## 3. 其余状态

实现提交 `70e017e` 时已通过：原失败的 live capsule 生命周期及真实费用页合成重估回归、verify fail 0、runtime audit、费用同一 fixture 三连跑，以及开工指令的所有费用专项与受影响共享 gallery / foundation / smoke。三连跑 seed SHA-256 为 `0cb9a6e336a1a769e10b547d25e9659f8b718874b66b63d10d8c60918ac8d0f8`。这是历史结果，最终状态以交付记录为准。

正式费用前后截图已捕获两种尺寸，各包含两色的 top/page 和 18 个场景。完整断言映射已写入 `UI-MIG-M8-ASSERTION-MAP-20261027.md`。尚未完成：稳定的五页最终像素门槛、费用对照浏览入口与完整差异清单、最终交付记录收尾。不能称 M8 已完成或 Claude 已审核通过。

原 M6 工作区未操作；未合 main、推送、打包或进行真实账号验收。

## 4. 批准后的独立验证

`ui-pixel-clock.js` 只由捕获工具导入。临时目录必须是系统 temp 的直接子目录且名称以 `ui-pixel-gate-` 开头，home 必须为其直接子目录；遇到链接立即拒绝。两条单元测试通过，覆盖文件字节和统计账本不变、目录限制、仅复制 checkedAt、保留 null 及其它 IPC handler。

第一次固定时间后的 main 自对照已经消除来源页差异，但暴露 `cost-project-expanded` 场景展开及滚动尚未结束，前后约差 10px。保留 `frozen-main-a`、`frozen-main-b`、`frozen-self` 原始证据；只在该场景的 before/after 两侧均使用既有 DSL 的 1000ms 等待，分别等待分区切换、展开和滚动结束。没有增加遮挡、删图或改比较逻辑。

随后重新完成同一个干净 main `0ac94cf` 的两次完整捕获：

| 尺寸 | 完整图对 | 最大差异比例 | 缺失 / 超标 | 报告 |
|---|---:|---:|---|---|
| 1180×850 | 60 | 0 | 0 / 0 | `artifacts/ui-gate/M8/stable-self/1180x850/report.json`、`report.md` |
| 1440×900 | 60 | 0 | 0 / 0 | `artifacts/ui-gate/M8/stable-self/1440x900/report.json`、`report.md` |

两次捕获目录分别为 `stable-main-a/<尺寸>`、`stable-main-b/<尺寸>`，每份 manifest 均记录 head `0ac94cf`、dirty false、固定时刻以及 18 个合成文件 mtime。预算仍为 0.002，色差阈值仍为 24；原始比较函数和日期遮挡函数未改。这证明修正后的完整基线可重复，候选仍须单独完成最终对照。

本次复跑 `verify` 遇到原 Windows Job 文件锁断言失败；同一个干净 main 在无 UI 并行时独立运行 `node --test tests/m1/windows-job.test.js` 也复现 `selected.exe` 在 reaped 后仍不可写。主分支原日志 `.cache/m8-main-windows-job.log` 保留；未修改任何后端文件或断言，也不把该项记录为通过。
