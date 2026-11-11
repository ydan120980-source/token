# A–G 组件修改与截图审核 · 2026-10-27

> 历史预览记录，以下实现与结果只对应当时预览。后续已按 `UI-MIG-M8-RULING-20261027.md` 删除 share / compact / tooltipPresentation / card 分支，撤回费用摘要和未使用的 SummarySection，并移除预览岛及专用源码。正式 M8 只以费用页前后图和 `UI-MIG-M8-20261027.md` 为交付依据。

所有者在看到 `UI-MIG-M8-INTERFACE-AUDIT-20261027.md` 后要求：“A到G修改后的完整截图给我”。本轮按该指令落实记录 A–G，提供实际组件的深浅色、两种尺寸完整预览，供视觉审核。

这是 A–G 修改及预览授权，不表示 Claude 已批准摘要文案或 M8 已验收。三节摘要以待定稿草案显示。费用页正式迁移尚未完成；本轮截图属于组件预览，不作为 M8 费用 after 图或未改页面像素门槛的替代证据。

范围限核对记录 A–G、对应 gallery/合成验证、构建产物和文档。没有扩大到 vendor、设计检查例外、后端/IPC/preload、真实数据、M6、M7、合 main、远程写入或打包。

## 实际结果

源码实现：SummarySection、ChartLegend 的 inline/donut/compact/share、BarChart 的 selected/ariaLabel/可伸展月份绘图区/底带/小金额尺度、LineChart 的末端读数和点标记、LineChart/StackBar 的 pill 模式、PaneGroup 20px 正文内边距、donut 中心切换、六个费用色映射和 Figure cost-hero。

独立预览在 `ui/src/dev/cost-ag-preview.tsx`，只通过显式挂载 `cost-ag-preview` 岛显示，不替换费用页。`scripts/m1/cost-ag-preview-ui-test.js` 使用隔离的合成 Electron 和只加载 tokens/React 资源的干净窗口；图中的金额、Agent 和缺口均为合成示例。

最终截图目录：`artifacts/ui-mig/M8/AG-preview/final/`。

- `1180x850-{light,dark}-full.png`、`1440x900-{light,dark}-full.png`：四张整页。
- 每组 A–G 七张分项，以及 D-keyboard-pill、E-half 两张交互状态；共 40 张 PNG。
- `results.json`：四组实际验证结果，renderer errors 均为 `[]`。
- `manifest.json`：各文件尺寸、哈希及构建产物哈希；当前为未提交预览。
- `../AG-preview-20261027.zip`：仅图片、结果与说明的下载包，不是产品或源码打包。

实际命令与结果：

| 命令 | 结果 / 日志 |
|---|---|
| `npm.cmd run build:ui` | 通过，`.cache/ag-build-third.log` |
| `npm.cmd run verify` | 通过，`fail 0`，`.cache/ag-verify.log` |
| `npm.cmd run lint`（最后两处测试脚本修订后） | 通过，`.cache/ag-final-lint.log`；产品构建字节在 verify 后未再改变 |
| `npm.cmd run audit:runtime` | 通过，`.cache/ag-runtime.log` |
| `node scripts/m1/ui-kit-gallery-ui-test.js` | 双主题通过，`.cache/ag-ui-kit-gallery-ui-test.log` |
| `node scripts/m1/ui-mkb-gallery-ui-test.js` | 双主题、键盘、动效和清理通过，`.cache/ag-ui-mkb-gallery-ui-test.log` |
| `node scripts/m1/ui-foundation-ui-test.js` | 复跑通过，`.cache/ag-foundation-second.log` |
| `COST_AG_EVIDENCE_DIR=artifacts/ui-mig/M8/AG-preview/final node scripts/m1/cost-ag-preview-ui-test.js` | 四组通过，`.cache/ag-preview-final.log`；表中 env 写法仅表示变量，Windows 实际由 PowerShell 设置 |

预览验证包括：三节摘要与跳转反馈；横向图例、份额列和至少一项保护；月份选择与 hover 分离、完整 aria-label、绘图区实际高度；真实 0/未知、小于 $1 的柱形尺度；末端读数在指向时隐藏；键盘胶囊、Escape 清理；两栏收起 inert 与恢复；半环；原费用输入色；60px/1.05/-1.5px/600 与未知不显示 0；off/reduced 和 full 后改目标回到终态。

## 首轮发现及修正

- 费用 `--input` 与 React 的表单 input 背景变量同名，最初把费用第一段画成灰色。现在仅将批准的 `--color-cost-input` 放入普通 `@theme`，在文档根解析已有费用蓝色；其余费用颜色仍随主题解析。没有增加颜色值或额外 token。
- endLabel 与原 detail series 标签最初叠在一起；新增末端文字时不再同时画原 series 标签。
- 预览驱动最初有动态筛选 locator、Motion opacity 的属性/样式读取和 SVG innerText 的定位问题，均修正为稳定键/实际样式/SVG 文本。原断言目的保留。
- foundation 首轮因新增预览岛而与固定注册列表不符；仅在该列表显式增加新岛后复跑通过，注册表仍按完全相等检查。
- D 的提示使用窗口级 portal，分项裁图会截掉伸入窗口边距的文字；交互状态现改为完整视口截图。正式交付的是 final 目录，不是首次失败图。

已查看最新的浅/深整页、D 键盘胶囊、E 半环截图。没有明显重叠、横向溢出或未知伪零。

## 停止点

本轮停在 A–G 截图审核；代码尚未提交。费用页正式 M8 迁移、insightsHost 拆分、摘要正式接入、费用 after 对照、未改页面的像素比较和 M8 全部 UI 验收均未完成。摘要内容/文案仍待 Claude 定稿。没有改 M6 旧工作区，没有开始 M7。
